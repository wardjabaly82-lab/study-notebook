#!/bin/bash
# Runs the online server's tests: starts it locally in test mode (wrangler dev), runs cloud/test, stops it.
cd "$(dirname "$0")/../cloud"
STATE=$(mktemp -d)
npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to "$STATE" > "$STATE/wrangler.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 1; done
npm test 2>&1 | grep -E "✓|✗|FAIL|PASSED|Error" | tail -${1:-80}
if command -v pkill >/dev/null; then pkill -f "[w]rangler dev"; pkill -x workerd
else   # Windows (Git Bash has no pkill): stop the test server and its workerd so the next run can rebuild cloud/public
  powershell -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "wrangler" -and $_.CommandLine -match "dev --port 8787" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep -Milliseconds 300; Get-Process workerd -EA 0 | Stop-Process -Force' >/dev/null 2>&1
fi
sleep 1; rm -rf "$STATE"
