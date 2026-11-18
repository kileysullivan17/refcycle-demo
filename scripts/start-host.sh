#!/bin/sh
# Starts the whole app on a host, inside one container: the pinned engine on 127.0.0.1:3000, then the app on
# PORT. If either stops, both stop and the script exits, so the host restarts the container.
#
# The provider key comes from the host's secret store as ANTHROPIC_API_KEY. No .env file is read or needed.
# This script never sets DEMO_LIMITS: limits are on by default, and the app refuses a production start with
# them off.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "STOPPED: ANTHROPIC_API_KEY is not set. Set it as a host secret." >&2; exit 1; }
export NODE_ENV=production

ENGINE_PID=""; APP_PID=""
stop_all() {
  for pid in $APP_PID $ENGINE_PID; do kill "$pid" 2>/dev/null || true; done
}
trap 'stop_all; exit 143' TERM INT

cd "$ROOT/engine"
LLM_PROVIDER="${LLM_PROVIDER:-anthropic}" LLM_MODEL="${LLM_MODEL:-claude-sonnet-5-5}" \
  node --import "$ROOT/engine/code/node_modules/tsx/dist/esm/index.mjs" code/src/main.ts &
ENGINE_PID=$!

# Wait for the engine before the app takes any visitor.
i=0
until node -e "fetch('http://127.0.0.1:3000/api/jurisdictions').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i + 1))
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then echo "STOPPED: the engine exited while starting." >&2; exit 1; fi
  if [ "$i" -ge 60 ]; then echo "STOPPED: the engine did not answer within 60 seconds." >&2; stop_all; exit 1; fi
  sleep 1
done

cd "$ROOT/app"
HOST=0.0.0.0 PORT="${PORT:-8080}" ENGINE_URL=http://127.0.0.1:3000 \
  LLM_IMAGE_PROVIDER="${LLM_IMAGE_PROVIDER:-anthropic}" LLM_IMAGE_MODEL="${LLM_IMAGE_MODEL:-claude-sonnet-5-5}" \
  node --import tsx src/server.ts &
APP_PID=$!

while kill -0 "$ENGINE_PID" 2>/dev/null && kill -0 "$APP_PID" 2>/dev/null; do sleep 2; done
echo "STOPPED: the engine or the app exited; stopping both so the host restarts the container." >&2
stop_all
exit 1
