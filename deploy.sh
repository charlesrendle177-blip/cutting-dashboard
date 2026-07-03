#!/bin/bash
set -e

MSG="${1:-update}"
REPO="charlesrendle177-blip/cutting-dashboard"

echo "→ Committing and pushing..."
git add -A
git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || echo "  (nothing to commit)"
git push origin main

echo "→ Waiting for GitHub Pages build..."
TOKEN=$(git remote get-url origin | grep -oP '(?<=https://)[^@]+(?=@)' || echo "")

for i in $(seq 1 24); do
  sleep 5
  if [ -n "$TOKEN" ]; then
    RESULT=$(curl -s "https://api.github.com/repos/$REPO/actions/runs?per_page=1" \
      -H "Authorization: token $TOKEN" | \
      python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['status']+'|'+str(r.get('conclusion','')))" 2>/dev/null || echo "pending|")
  else
    RESULT="pending|"
  fi
  STATUS="${RESULT%|*}"
  CONCLUSION="${RESULT#*|}"
  echo "  [$i] $STATUS $CONCLUSION"
  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCLUSION" = "success" ]; then
      echo "✅ Live: https://charlesrendle177-blip.github.io/cutting-dashboard/"
    else
      echo "❌ Build failed — check: https://github.com/$REPO/actions"
      exit 1
    fi
    exit 0
  fi
done

echo "⏱ Timed out — check: https://github.com/$REPO/actions"
