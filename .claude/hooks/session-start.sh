#!/bin/bash
# Prepares a Claude Code on the web session: installs workspace dependencies and
# starts the local Postgres 16 that the db and payments test suites use.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install

# Idempotent: initializes the cluster on first run, starts it if stopped, no-op if running.
bash packages/db/scripts/local-pg.sh
