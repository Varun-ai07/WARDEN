#!/bin/bash
kill -9 $(pgrep -f "vite apps/web") 2>/dev/null
kill -9 $(pgrep -f "node apps/api") 2>/dev/null
sleep 1
rm -f apps/api/data/warden.db*
DATABASE_PATH=apps/api/data/warden.db node apps/api/dist/server.js &
echo $! > /tmp/warden.pid
sleep 2
echo "API started: $(cat /tmp/warden.pid)"
