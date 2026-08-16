#!/bin/bash
# backup-db.sh — Backup giornaliero dei database di Edicola Ecclesiastica.
# Salva giuridica.db (notizie) e normativa.db (corpus canonico/ecclesiastico).
# Tiene gli ultimi 7 backup, cancella i più vecchi.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$BASE_DIR/data/backups"
DATE=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"

for NAME in giuridica normativa; do
  DB_PATH="$BASE_DIR/data/$NAME.db"
  BACKUP_FILE="$BACKUP_DIR/$NAME-$DATE.db"
  if [ ! -f "$DB_PATH" ]; then
    echo "[Backup] ATTENZIONE: $DB_PATH non trovato, salto"
    continue
  fi
  cp "$DB_PATH" "$BACKUP_FILE"
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[Backup] $(date '+%Y-%m-%d %H:%M:%S') — $BACKUP_FILE ($SIZE)"
done

DELETED=$(find "$BACKUP_DIR" -name "*-*.db" -type f -mtime +7 -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[Backup] Rimossi $DELETED backup vecchi"
fi
