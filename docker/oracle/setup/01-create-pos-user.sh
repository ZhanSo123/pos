#!/bin/bash
set -euo pipefail

if [[ -z "${ORACLE_APP_PASSWORD:-}" ]]; then
  echo "ORACLE_APP_PASSWORD must be set for the POS schema user."
  exit 1
fi
safe_password="${ORACLE_APP_PASSWORD//\"/\"\"}"

sqlplus -s / as sysdba <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER=FREEPDB1;
DECLARE
  user_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM all_users WHERE username='POS_APP';
  IF user_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER pos_app IDENTIFIED BY "${safe_password}"';
  ELSE
    EXECUTE IMMEDIATE 'ALTER USER pos_app IDENTIFIED BY "${safe_password}"';
  END IF;
END;
/
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE SEQUENCE TO pos_app;
ALTER USER pos_app QUOTA UNLIMITED ON USERS;
EXIT;
SQL
