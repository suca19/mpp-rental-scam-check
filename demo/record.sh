#!/usr/bin/env bash
# Records fallback output for every listing into demo/saved/ (run once the real server works).
# Usage (from demo/):  ./record.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p saved
curl -s -i -X POST http://localhost:3000/check -H 'content-type: application/json' \
  --data @listings/absurd-scam.json > saved/402-challenge.txt
for f in listings/*.json; do
  n=$(basename "$f" .json)
  npm run -s check -- "$f" > "saved/$n.txt" 2>&1 || echo "FAILED: $n (see saved/$n.txt)"
  npm run -s check -- "$f" --json > "saved/$n.response.json" 2>/dev/null || true
  echo "saved $n"
done
