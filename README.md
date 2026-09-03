# GenMove 1.0

GenMove is a governed SAP migration validation application. It compares source and target files, reports field- and row-level mismatches, applies approved transformation rules, and stores users, validation history, recommendations, rules, and audit events in PostgreSQL.

## What you run

- `dashboard/` — the Flask web application for login, file management, validation, transformation rules, reports, and database inspection.
- `sap_validator/` — an optional standalone desktop validator. PostgreSQL is not required for the desktop tool.

## Requirements

Install these before continuing:

- Python 3.10 or newer
- PostgreSQL server 14 or newer
- PostgreSQL command-line client (`psql`)

The PostgreSQL server may be installed locally or hosted on another machine. Docker is not required.

---

## macOS or Linux setup

### 1. Open the project

```bash
cd /path/to/GenMove-V1
```

For the current Mac project location:

```bash
cd /Users/dheeraj_macmini/Documents/Dheeraj/GenMove-V1
```

### 2. Create the Python environment

```bash
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Keep the virtual environment activated whenever you run GenMove.

### 3. Start PostgreSQL

Start the PostgreSQL service using your normal installation method. For example, with Homebrew:

```bash
brew services start postgresql@16
```

Confirm that PostgreSQL is reachable:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres
```

Enter the PostgreSQL administrator password when prompted. Type `\q` to leave the PostgreSQL prompt.

### 4. Create the GenMove database

Set the administrator password and choose a password for the GenMove account:

```bash
export PG_ADMIN_PASSWORD="your-postgres-admin-password"
export GENMOVE_DB_PASSWORD="choose-a-strong-genmove-password"
bash database/setup_postgres.sh
```

The setup script:

1. Creates or updates the `genmove` PostgreSQL role.
2. Creates the `genmove` database if it does not exist.
3. Creates all GenMove tables from `database/schema.sql`.
4. Grants the required table and sequence permissions.
5. Writes the connection settings to `.env` in the project root.

For PostgreSQL on another host or port:

```bash
export PG_ADMIN_HOST="database.example.com"
export PG_ADMIN_PORT="5432"
export PG_ADMIN_USER="postgres"
export PG_ADMIN_PASSWORD="your-postgres-admin-password"
export GENMOVE_DB_NAME="genmove"
export GENMOVE_DB_USER="genmove"
export GENMOVE_DB_PASSWORD="choose-a-strong-genmove-password"
bash database/setup_postgres.sh
```

### 5. Start GenMove

```bash
source venv/bin/activate
./run.sh
```

If the script is not executable, run:

```bash
chmod +x run.sh
./run.sh
```

You can also start the application directly:

```bash
python dashboard/app.py
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050), create an account, and sign in.

---

## Windows setup

Run the following commands in PowerShell.

### 1. Open the project

```powershell
cd C:\path\to\GenMove-V1
```

### 2. Create the Python environment

```powershell
py -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell prevents environment activation, allow scripts for only the current terminal and try again:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\venv\Scripts\Activate.ps1
```

### 3. Start PostgreSQL

Open Windows Services and confirm that the PostgreSQL service is running. Also confirm that the PostgreSQL `bin` directory is on `PATH`:

```powershell
psql --version
```

### 4. Create the GenMove database

```powershell
.\database\setup_postgres.ps1 `
  -AdminPassword "your-postgres-admin-password" `
  -DatabasePassword "choose-a-strong-genmove-password"
```

For a remote or non-default PostgreSQL server:

```powershell
.\database\setup_postgres.ps1 `
  -AdminHost "database.example.com" `
  -AdminPort 5432 `
  -AdminUser "postgres" `
  -AdminPassword "your-postgres-admin-password" `
  -DatabaseName "genmove" `
  -DatabaseUser "genmove" `
  -DatabasePassword "choose-a-strong-genmove-password"
```

This creates the database, tables, application user, permissions, and project `.env` file.

### 5. Start GenMove

```powershell
.\venv\Scripts\Activate.ps1
.\run.bat
```

Or start it directly:

```powershell
python dashboard\app.py
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050), create an account, and sign in.

---

## Verify the installation

After signing in, check these pages:

| Page | Address | Expected result |
| --- | --- | --- |
| Home | `/home` | Workspace metrics and uploaded source files |
| Validator | `/dashboard` | Source/target upload and validation screen |
| Rule Hub | `/rule-hub` | Transformation-rule governance screen |
| Database | `/database` | Read-only PostgreSQL table viewer |
| Database status | `/api/database/status` | `enabled: true` and `backend: postgresql+psycopg` |

The status endpoint should return:

```json
{
  "backend": "postgresql+psycopg",
  "enabled": true,
  "error": null
}
```

## First validation

1. Sign up and sign in.
2. Open **Dashboard**.
3. Upload a source file and its target/preload file.
4. If their names differ, open **Manage file pairs** and pair them.
5. Select the join keys and fields to validate.
6. Run validation and open the PASS or FAIL result for row-level details.
7. Download the consolidated Excel report when required.

Approved Rule Hub mappings are applied to the in-memory source view before it is compared with the target. The originally uploaded source file remains unchanged unless the user explicitly downloads a transformed copy.

## Configuration

GenMove reads `.env` automatically from the project root. A typical file is:

```dotenv
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=genmove
PG_USER=genmove
PG_PASSWORD="your-genmove-password"
PG_CONNECT_TIMEOUT=10
SAP_VALIDATOR_PORT=5050
GENMOVE_SECRET_KEY="replace-with-a-long-random-secret"
```

You may use one database URL instead of separate `PG_*` values:

```dotenv
DATABASE_URL=postgresql+psycopg://genmove:password@127.0.0.1:5432/genmove
```

`DATABASE_URL` takes precedence over the separate PostgreSQL settings. Do not commit `.env`, database passwords, API keys, or session secrets.

## Use a different web port

If port `5050` is already in use, change it in `.env`:

```dotenv
SAP_VALIDATOR_PORT=5051
```

Restart GenMove and open `http://127.0.0.1:5051`.

## Common problems

### `psql: command not found`

Install the PostgreSQL client tools and add the PostgreSQL `bin` directory to `PATH`. Restart the terminal afterward.

### `connection refused`

The PostgreSQL service is not running, or `PG_HOST`/`PG_PORT` is incorrect. Start PostgreSQL and verify connectivity using `psql`.

### `password authentication failed`

Check the administrator password used during setup. If the application itself cannot connect, check `PG_USER` and `PG_PASSWORD` in `.env`, then rerun the setup script with the intended GenMove password.

### `database "genmove" does not exist`

Run the PostgreSQL setup script again. It creates both the database and schema.

### Login or signup does not work

Open `/api/database/status`. Authentication requires PostgreSQL, so the result must contain `"enabled": true`. Restart the app after changing `.env`.

### Port `5050` is already in use

Set `SAP_VALIDATOR_PORT=5051` in `.env`, restart the application, and use the new address.

## Optional desktop validator

The standalone desktop application does not require Flask or PostgreSQL:

```bash
source venv/bin/activate
python -m pip install lxml anthropic
python sap_validator/sap_validator.py
```

On Windows, activate the virtual environment with `.\venv\Scripts\Activate.ps1` first.

## Project structure

```text
GenMove-V1/
├── core/                    Validation, mapping, transformation, and DB logic
├── dashboard/               Flask routes, HTML templates, CSS, and JavaScript
├── database/                PostgreSQL schema and setup scripts
├── data/source/             Default source-file directory
├── data/target/             Default target/preload-file directory
├── docs/                    Architecture and operational documentation
├── reports/                 Generated Excel reports
├── sap_validator/           Optional standalone desktop application
├── templates/               Uploaded field-validation templates
├── .env.example             Safe configuration example
├── requirements.txt         Web application dependencies
├── run.sh                   macOS/Linux launcher
└── run.bat                  Windows launcher
```

For the PostgreSQL data flow and screen-to-table mapping, see [`docs/postgresql-architecture.md`](docs/postgresql-architecture.md).
