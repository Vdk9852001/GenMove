#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
MYSQL_BIN="${MYSQL_BIN:-$(command -v mysql || true)}"
MYSQLADMIN_BIN="${MYSQLADMIN_BIN:-$(command -v mysqladmin || true)}"
if [[ -x /usr/local/mysql/bin/mysql ]]; then
  MYSQL_BIN=/usr/local/mysql/bin/mysql
  MYSQLADMIN_BIN=/usr/local/mysql/bin/mysqladmin
fi
[[ -x "$MYSQL_BIN" ]] || { echo "Install native MySQL Server first."; exit 1; }
MYSQL_ADMIN_USER="${MYSQL_ADMIN_USER:-root}"
MYSQL_ADMIN_PASSWORD="${MYSQL_ADMIN_PASSWORD:-password}"
GENMOVE_DB_PASSWORD_GENERATED=0
if [[ -z "${GENMOVE_DB_PASSWORD:-}" ]]; then
  GENMOVE_DB_PASSWORD="$(openssl rand -hex 16)"
  GENMOVE_DB_PASSWORD_GENERATED=1
fi
"$MYSQLADMIN_BIN" -h 127.0.0.1 -P 3306 ping --silent || {
  echo "Native MySQL is not running on 127.0.0.1:3306."; exit 1;
}
MYSQL_PWD="$MYSQL_ADMIN_PASSWORD" "$MYSQL_BIN" -h 127.0.0.1 -P 3306 -u "$MYSQL_ADMIN_USER" <<SQL
CREATE DATABASE IF NOT EXISTS genmove CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'genmove'@'localhost' IDENTIFIED BY '${GENMOVE_DB_PASSWORD}';
ALTER USER 'genmove'@'localhost' IDENTIFIED BY '${GENMOVE_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON genmove.* TO 'genmove'@'localhost';
FLUSH PRIVILEGES;
SQL
MYSQL_PWD="$MYSQL_ADMIN_PASSWORD" "$MYSQL_BIN" -h 127.0.0.1 -P 3306 -u "$MYSQL_ADMIN_USER" < database/schema.sql
echo "Local MySQL ready: 127.0.0.1:3306 / database genmove / user genmove"
if [[ "$GENMOVE_DB_PASSWORD_GENERATED" == "1" ]]; then
  echo "Generated password for 'genmove'@'localhost': ${GENMOVE_DB_PASSWORD}"
  echo "Save this — re-run with GENMOVE_DB_PASSWORD set to reuse it next time."
fi
