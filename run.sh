#!/usr/bin/env bash
# Serves the demo on http://localhost:8080 and opens it in the default browser.
cd "$(dirname "$0")"
PORT=${PORT:-8080}
URL="http://localhost:$PORT"
( sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) &
echo "Phone Assist demo: $URL  (press Ctrl+C to stop)"
if command -v python3 >/dev/null 2>&1; then python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then python -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then npx --yes serve -l "$PORT" .
else echo "Need python3 or node installed to serve the folder." ; exit 1; fi
