#!/usr/bin/env bash
# Riavvia opencode-gate se la memoria supera la soglia (leak noto runtime llama.cpp).
# Chiamato dal timer systemd ogni 15 min. Downtime ~1 min (modello in cache).
set -u
LIMIT=$((9 * 1024 * 1024 * 1024))
CUR=$(systemctl --user show opencode-gate.service -p MemoryCurrent --value 2>/dev/null || echo 0)
if [ "${CUR:-0}" -gt "$LIMIT" ]; then
  echo "$(date -Is) memcheck: ${CUR} > ${LIMIT}, restart" >> /home/nabz/Dev/opencode-gate/logs/memcheck.log
  systemctl --user restart opencode-gate.service
fi
