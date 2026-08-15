#!/bin/bash
# cron-daily.sh — Blocco giornaliero del corpus ecclesiastico (max 10.000 unità).
#
# Installazione sul server (crontab -e, utente work):
#   30 2 * * * /home/work/edicola-ecclesiastica/corpus/cron-daily.sh
#
# Il tetto si cambia con ECCL_MAX_UNITA (default 10000).

cd /home/work/edicola-ecclesiastica || exit 1
LOG=corpus/run-daily.log

{
  echo "════════ $(date '+%Y-%m-%d %H:%M:%S') — inizio blocco giornaliero ════════"
  node corpus/run-daily.js
  echo "════════ $(date '+%Y-%m-%d %H:%M:%S') — fine ════════"
} >> "$LOG" 2>&1

# Rotazione grezza del log oltre i 20 MB
if [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 20000000 ]; then
  mv "$LOG" "$LOG.1"
fi
