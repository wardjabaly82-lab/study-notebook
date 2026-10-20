#!/bin/bash
# Runs the online server's tests: starts it locally in test mode (wrangler dev), runs cloud/test, stops it.
cd "$(dirname "$0")/../cloud"
STATE=$(mktemp -d)
npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to "$STATE" > "$STATE/wrangler.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 1; done
npm test 2>&1 | grep -E "✓|✗|FAIL|PASSED|Error" | tail -${1:-80}
pkill -f "[w]rangler dev"; pkill -x workerd; rm -rf "$STATE"
