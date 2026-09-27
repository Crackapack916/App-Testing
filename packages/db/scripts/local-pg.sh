#!/usr/bin/env bash
# Starts a throwaway local Postgres 16 for tests. Prints the DATABASE_URL to use.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/crackapack-pg}
PGPORT=${PGPORT:-54329}
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
if [ ! -d "$PGDATA" ]; then
  mkdir -p "$PGDATA"; [ "$(id -u)" = 0 ] && chown postgres "$PGDATA"
  run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust >/dev/null"
fi
run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/log status >/dev/null" || \
  run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/log -w start >/dev/null"
echo "postgres://postgres@127.0.0.1:$PGPORT/postgres"
