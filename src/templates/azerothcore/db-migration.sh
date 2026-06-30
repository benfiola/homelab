#!/bin/bash
set -e

echo "Waiting for game data download to complete..."
while [ ! -f /data/data-version ]; do
  echo "Waiting for game data to be ready..."
  sleep 5
done

if [ -f /logs/.db-migrated ]; then
  echo "Database migrations already completed, skipping..."
  exit 0
fi

IFS=';' read -r DB_HOST DB_PORT DB_USER DB_PASS _ <<< "$AC_LOGIN_DATABASE_INFO"

echo "Waiting for database to be ready..."
until MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e "SELECT 1" >/dev/null 2>&1; do
  echo "Database not ready, retrying..."
  sleep 5
done

echo "Resetting databases for clean migration..."
MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  -e "DROP DATABASE IF EXISTS acore_auth; DROP DATABASE IF EXISTS acore_characters; DROP DATABASE IF EXISTS acore_world;"

echo "Running database migrations with dbimport..."
/azerothcore/env/dist/bin/dbimport
echo "Database migrations complete"
mkdir -p /logs
touch /logs/.db-migrated

