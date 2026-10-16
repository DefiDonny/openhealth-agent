#!/bin/bash
# WHOOP daily sync cron job - runs at 6 AM UTC+7 (23:00 UTC previous day)
# Add to crontab: 0 23 * * * /path/to/whoop-sync/sync-cron.sh >> /var/log/whoop-sync.log 2>&1

curl -s -X POST http://127.0.0.1:3001/api/whoop/sync
echo ""
echo "[$(date)] Sync triggered via cron"
