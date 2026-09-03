#!/usr/bin/env bash
# Provisions the GenMove database/role on an existing PostgreSQL server and
# applies schema.sql. Does NOT install or start Postgres -- point this at a
# server you already have (local, Docker, or hosted) via PG_ADMIN_* env vars.
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
[[ -x "$PSQL_BIN" ]] || { echo "psql client not found. Install the PostgreSQL client tools first."; exit 1; }

PG_ADMIN_HOST="${PG_ADMIN_HOST:-127.0.0.1}"
PG_ADMIN_PORT="${PG_ADMIN_PORT:-5432}"
PG_ADMIN_USER="${PG_ADMIN_USER:-postgres}"
PG_ADMIN_PASSWORD="${PG_ADMIN_PASSWORD:?Set PG_ADMIN_PASSWORD to your Postgres admin/superuser password}"
PG_ADMIN_DATABASE="${PG_ADMIN_DATABASE:-postgres}"

GENMOVE_DB_NAME="${GENMOVE_DB_NAME:-genmove}"
GENMOVE_DB_USER="${GENMOVE_DB_USER:-genmove}"
GENMOVE_DB_PASSWORD_GENERATED=0
if [[ -z "${GENMOVE_DB_PASSWORD:-}" ]]; then
  GENMOVE_DB_PASSWORD="$(openssl rand -hex 16)"
  GENMOVE_DB_PASSWORD_GENERATED=1
fi

identifier_pattern='^[A-Za-z_][A-Za-z0-9_]*$'
[[ "$GENMOVE_DB_NAME" =~ $identifier_pattern ]] || { echo "Invalid GENMOVE_DB_NAME"; exit 1; }
[[ "$GENMOVE_DB_USER" =~ $identifier_pattern ]] || { echo "Invalid GENMOVE_DB_USER"; exit 1; }
SQL_PASSWORD=${GENMOVE_DB_PASSWORD//\'/\'\'}

export PGPASSWORD="$PG_ADMIN_PASSWORD"

"$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$PG_ADMIN_USER" -d "$PG_ADMIN_DATABASE" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${GENMOVE_DB_USER}') THEN
    CREATE ROLE ${GENMOVE_DB_USER} LOGIN PASSWORD '${SQL_PASSWORD}';
  ELSE
    ALTER ROLE ${GENMOVE_DB_USER} WITH LOGIN PASSWORD '${SQL_PASSWORD}';
  END IF;
END
\$\$;
SQL

"$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$PG_ADMIN_USER" -d "$PG_ADMIN_DATABASE" -tc \
  "SELECT 1 FROM pg_database WHERE datname = '${GENMOVE_DB_NAME}'" | grep -q 1 || \
  "$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$PG_ADMIN_USER" -d "$PG_ADMIN_DATABASE" -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${GENMOVE_DB_NAME} OWNER ${GENMOVE_DB_USER};"

"$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$PG_ADMIN_USER" -d "$PG_ADMIN_DATABASE" -v ON_ERROR_STOP=1 \
  -c "GRANT ALL PRIVILEGES ON DATABASE ${GENMOVE_DB_NAME} TO ${GENMOVE_DB_USER};"

PGPASSWORD="$GENMOVE_DB_PASSWORD" "$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$GENMOVE_DB_USER" \
  -d "$GENMOVE_DB_NAME" -v ON_ERROR_STOP=1 -f database/schema.sql

PGPASSWORD="$PG_ADMIN_PASSWORD" "$PSQL_BIN" -h "$PG_ADMIN_HOST" -p "$PG_ADMIN_PORT" -U "$PG_ADMIN_USER" \
  -d "$GENMOVE_DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO ${GENMOVE_DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${GENMOVE_DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${GENMOVE_DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${GENMOVE_DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${GENMOVE_DB_USER};
SQL

ENV_PASSWORD=${GENMOVE_DB_PASSWORD//\\/\\\\}
ENV_PASSWORD=${ENV_PASSWORD//\"/\\\"}
cat > .env <<EOF
PG_HOST=$PG_ADMIN_HOST
PG_PORT=$PG_ADMIN_PORT
PG_DATABASE=$GENMOVE_DB_NAME
PG_USER=$GENMOVE_DB_USER
PG_PASSWORD="$ENV_PASSWORD"
PG_CONNECT_TIMEOUT=10
SAP_VALIDATOR_PORT=5050
EOF

echo "PostgreSQL ready: ${PG_ADMIN_HOST}:${PG_ADMIN_PORT} / database ${GENMOVE_DB_NAME} / user ${GENMOVE_DB_USER}"
echo "Set this before starting GenMove:"
echo "  export DATABASE_URL=\"postgresql+psycopg://${GENMOVE_DB_USER}:${GENMOVE_DB_PASSWORD}@${PG_ADMIN_HOST}:${PG_ADMIN_PORT}/${GENMOVE_DB_NAME}\""
echo "A local .env file was also created; python dashboard/app.py will load it automatically."
if [[ "$GENMOVE_DB_PASSWORD_GENERATED" == "1" ]]; then
  echo "(password was generated -- save it, or re-run with GENMOVE_DB_PASSWORD set to reuse it)"
fi
