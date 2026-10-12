#!/bin/bash
# Cloud sessions: install dependencies so typecheck, tests and the dev server work at once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# The repo pins pnpm via "packageManager"; corepack provides that exact version.
corepack enable >/dev/null 2>&1 || true
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# `install` (not `--frozen-lockfile` in CI mode) so the cached container stays reusable.
pnpm install --prefer-offline

# Playwright uses the preinstalled Chromium; never download browsers.
echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "${CLAUDE_ENV_FILE:-/dev/null}"
