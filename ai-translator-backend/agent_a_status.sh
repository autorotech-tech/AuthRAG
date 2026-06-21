#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/home/vladx/autoro.tech/ai-translator-backend}"
LOG_FILE="$BASE_DIR/logs/agent_a.log"

echo "BASE_DIR=$BASE_DIR"
echo
echo "== PROCESS =="
pgrep -af "agent_gemini_live.py start" || echo "NOT RUNNING"

echo
echo "== LAST LOG (40) =="
if [[ -f "$LOG_FILE" ]]; then
  tail -n 40 "$LOG_FILE"
else
  echo "No log file: $LOG_FILE"
fi

echo
echo "== HEALTH HINTS =="
echo "- OK if log has: registered worker ... agent_name=translator-live"
echo "- BAD if log has: ValueError ... GOOGLE_API_KEY environment variable"
