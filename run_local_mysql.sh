#!/usr/bin/env bash
set -Eeuo pipefail
show_error() {
  code=$?
  echo
  echo "GenMove could not start (exit code $code). The error is shown above."
  read -r -p "Press Enter to keep this message visible and close..." || true
  exit "$code"
}
trap show_error ERR
cd "$(dirname "$0")"
bash database/setup_local_mysql.sh
python3 -m pip install -r requirements.txt
export MYSQL_HOST="127.0.0.1"
export MYSQL_PORT="3306"
export MYSQL_DATABASE="genmove"
export MYSQL_USER="genmove"
export MYSQL_PASSWORD="password"
export SAP_VALIDATOR_PORT="${SAP_VALIDATOR_PORT:-5050}"
python3 dashboard/app.py
