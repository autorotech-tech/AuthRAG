#!/usr/bin/env bash
# Запуск website/scripts/debug_livekit_room_connect.py для обоих тестовых токенов из livekit_test_session.json.
set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION_JSON="${1:?Использование: $0 /path/to/livekit_test_session.json}"
if [[ ! -f "$SESSION_JSON" ]]; then
  echo "Не найден файл сессии: $SESSION_JSON" >&2
  echo "Сначала выполните: python3 create_livekit_session.py --out livekit_test_session.json" >&2
  exit 1
fi

WEBSITE_ROOT="${WEBSITE_ROOT:-$(cd "$BACKEND_ROOT/../website" 2>/dev/null && pwd || true)}"
if [[ -z "${WEBSITE_ROOT}" || ! -d "$WEBSITE_ROOT" ]]; then
  echo "Не найден каталог website (ожидался $BACKEND_ROOT/../website). Задайте WEBSITE_ROOT." >&2
  exit 1
fi

PYTHON="${PYTHON:-$WEBSITE_ROOT/.venv-debug/bin/python3}"
DEBUG_SCRIPT="$WEBSITE_ROOT/scripts/debug_livekit_room_connect.py"
if [[ ! -f "$PYTHON" ]]; then
  echo "Нет интерпретатора: $PYTHON" >&2
  echo "Подготовьте venv: cd \"$WEBSITE_ROOT\" && python3 -m venv .venv-debug && .venv-debug/bin/pip install 'livekit~=1.0'" >&2
  exit 1
fi
if [[ ! -f "$DEBUG_SCRIPT" ]]; then
  echo "Нет файла: $DEBUG_SCRIPT" >&2
  exit 1
fi

json_get() {
  local key="$1"
  "$PYTHON" - "$SESSION_JSON" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
cur = data
for part in key.split("."):
    cur = cur.get(part) if isinstance(cur, dict) else None
    if cur is None:
        break
print("" if cur is None else str(cur))
PY
}

export LIVEKIT_URL="$(json_get "livekit_url")"
LOG="${DEBUG_LOG_PATH:-$WEBSITE_ROOT/.cursor/debug-b36587.log}"
rm -f "$LOG"
echo "Лог: $LOG"

export LIVEKIT_TOKEN="$(json_get "caller_ru.token")"
export DEBUG_RUN_ID=ru1
"$PYTHON" "$DEBUG_SCRIPT"

export LIVEKIT_TOKEN="$(json_get "caller_en.token")"
export DEBUG_RUN_ID=en1
"$PYTHON" "$DEBUG_SCRIPT"

echo "--- $LOG ---"
cat "$LOG"
