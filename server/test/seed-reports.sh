#!/usr/bin/env bash
# Reports the stage listing's (demo/listings/absurd-scam.json) fake phone + IBAN 3 times (free route),
# so the demo shows "reported 3 times". All values are obviously fake. Server must be running.
set -euo pipefail
URL=${URL:-http://localhost:3000}
for i in 1 2 3; do
  curl -s -X POST "$URL/report" -H 'content-type: application/json' \
    -d '{"phone":"+353 00 000 0001","iban":"ES00 TEST 0000 0000 0000 0001","note":"asked for deposit before viewing"}'
  echo
done
