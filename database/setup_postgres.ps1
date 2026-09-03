param(
    [string]$AdminHost = "127.0.0.1",
    [int]$AdminPort = 5432,
    [string]$AdminUser = "postgres",
    [string]$AdminDatabase = "postgres",
    [string]$DatabaseName = "genmove",
    [string]$DatabaseUser = "genmove",
    [Parameter(Mandatory = $true)][string]$AdminPassword,
    [Parameter(Mandatory = $true)][string]$DatabasePassword
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $PSScriptRoot "schema.sql"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    throw "psql was not found. Install PostgreSQL client tools and add its bin folder to PATH."
}
if ($DatabaseName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or
    $DatabaseUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw "DatabaseName and DatabaseUser may contain only letters, numbers, and underscores."
}

$escapedPassword = $DatabasePassword.Replace("'", "''")
$env:PGPASSWORD = $AdminPassword
$roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '$DatabaseUser') THEN
    CREATE ROLE $DatabaseUser LOGIN PASSWORD '$escapedPassword';
  ELSE
    ALTER ROLE $DatabaseUser WITH LOGIN PASSWORD '$escapedPassword';
  END IF;
END
`$`$;
"@
& psql -h $AdminHost -p $AdminPort -U $AdminUser -d $AdminDatabase -v ON_ERROR_STOP=1 -c $roleSql
if ($LASTEXITCODE -ne 0) { throw "Unable to create the GenMove PostgreSQL role." }

$exists = & psql -h $AdminHost -p $AdminPort -U $AdminUser -d $AdminDatabase -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
if ($exists.Trim() -ne "1") {
    & psql -h $AdminHost -p $AdminPort -U $AdminUser -d $AdminDatabase -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DatabaseName OWNER $DatabaseUser;"
    if ($LASTEXITCODE -ne 0) { throw "Unable to create the GenMove PostgreSQL database." }
}

$env:PGPASSWORD = $DatabasePassword
& psql -h $AdminHost -p $AdminPort -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $schemaPath
if ($LASTEXITCODE -ne 0) { throw "Unable to apply the GenMove PostgreSQL schema." }

$envPath = Join-Path $projectRoot ".env"
$dotenvPassword = $DatabasePassword.Replace('\', '\\').Replace('"', '\"')
@"
PG_HOST=$AdminHost
PG_PORT=$AdminPort
PG_DATABASE=$DatabaseName
PG_USER=$DatabaseUser
PG_PASSWORD="$dotenvPassword"
PG_CONNECT_TIMEOUT=10
SAP_VALIDATOR_PORT=5050
"@ | Set-Content -Path $envPath -Encoding UTF8

Write-Host "PostgreSQL is ready and $envPath has been created."
Write-Host "Start GenMove with: python dashboard\app.py"
