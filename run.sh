#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(\".\")[0])' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "Node.js 18+ is required. Current version: $(node -v 2>/dev/null || echo unknown)" >&2
  exit 1
fi

MARKER="$SCRIPT_DIR/node_modules/.mcp-deps-ok"
NEEDED_FILES=(
  "$SCRIPT_DIR/node_modules/@modelcontextprotocol/sdk/package.json"
  "$SCRIPT_DIR/node_modules/zod/package.json"
)

needs_install=false
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  needs_install=true
elif [ -f "$SCRIPT_DIR/package-lock.json" ] && { [ ! -f "$MARKER" ] || [ "$SCRIPT_DIR/package-lock.json" -nt "$MARKER" ]; }; then
  needs_install=true
else
  for f in "${NEEDED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
      needs_install=true
      break
    fi
  done
fi

if [ "$needs_install" = true ]; then
  if [ -f "$SCRIPT_DIR/package-lock.json" ]; then
    npm ci --prefix "$SCRIPT_DIR" --no-audit --no-fund >&2
  else
    npm install --prefix "$SCRIPT_DIR" --no-audit --no-fund >&2
  fi
  touch "$MARKER"
fi

exec node "$SCRIPT_DIR/server.mjs" "$@"
