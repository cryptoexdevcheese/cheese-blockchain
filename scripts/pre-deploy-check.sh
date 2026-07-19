#!/usr/bin/env bash
# Run locally before deploy to catch parse errors and broken static assets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Syntax check (critical JS) =="
FILES=(
  public/wallet/app.js
  public/wallet/token-metadata.js
  public/wallet/wallet-security.js
  public/config.js
  public/dex/dex-logic-v2.js
  dex-engine.js
  dex-server-routes-fixed.js
  start-server.js
)
for f in "${FILES[@]}"; do
  node -c "$f"
  echo "  OK $f"
done

echo "== Required static assets =="
test -f public/wallet-logos/cheese-blockchain-128.png
test -f public/wallet-logos/cheese-blockchain-256.png
echo "  OK chainlist wallet logos present"

# QR: app.js must support qrcodejs constructor API (no broken jsdelivr node-qrcode path in index)
grep -q 'qrcodejs/1.0.0/qrcode.min.js' public/wallet/index.html
grep -q 'typeof QRCode.toDataURL' public/wallet/app.js
echo "  OK wallet QR code wiring"

PORT="${VERIFY_PORT:-8788}"
if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "== Local server smoke (port ${PORT}) =="
  curl -sf "http://127.0.0.1:${PORT}/wallet/app.js" | node -c /dev/stdin
  echo "  OK served wallet/app.js parses"
  curl -sf "http://127.0.0.1:${PORT}/api/health" | grep -q '"status"'
  echo "  OK /api/health"
  curl -sf "http://127.0.0.1:${PORT}/dex/" | head -1 | grep -q '<!DOCTYPE html>'
  echo "  OK /dex/ HTML"
else
  echo "== Skip live smoke (start server: PORT=${PORT} node start-server.js) =="
fi

echo "All pre-deploy checks passed."
