#!/bin/bash
# sync-local-wallets.sh - Updates local SQLite wallet balances from live DigitalOcean ledger
# This script directly writes corrected balances into the local cheese-blockchain.db

DB_PATH="/Users/cheeseblockchain/CascadeProjects/cheeseblockchain/cheese-blockchain.db"
MASTER_URL="https://cheeseblockchain.com"

echo "🔄 Local SQLite Wallet Balance Sync"
echo "===================================="
echo ""

# Get all wallet addresses from local DB
WALLETS=$(sqlite3 "$DB_PATH" "SELECT address FROM wallets;")

TOTAL=0
UPDATED=0

for addr in $WALLETS; do
  TOTAL=$((TOTAL + 1))
  
  # Fetch live balance from DigitalOcean
  RESPONSE=$(curl -s "${MASTER_URL}/api/balance/${addr}?sync=true" 2>/dev/null)
  
  LIVE_BALANCE=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('balance', 0))
except:
    print('ERROR')
" 2>/dev/null)

  PORTFOLIO=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(json.dumps(d.get('portfolio', {})))
except:
    print('{}')
" 2>/dev/null)

  if [ "$LIVE_BALANCE" = "ERROR" ] || [ -z "$LIVE_BALANCE" ]; then
    echo "  ❌ $addr: Failed to fetch"
    continue
  fi

  # Update the local SQLite wallet data
  # Read existing data, update balance fields, write back
  python3 -c "
import sqlite3, json, sys, time

db = sqlite3.connect('$DB_PATH')
cursor = db.cursor()

cursor.execute('SELECT data FROM wallets WHERE address = ?', ('$addr',))
row = cursor.fetchone()
if row:
    data = json.loads(row[0])
    data['balance'] = float('$LIVE_BALANCE')
    data['balances'] = {'NCH': float('$LIVE_BALANCE')}
    try:
        portfolio = json.loads('$PORTFOLIO')
        data['portfolio'] = portfolio
        data['balances'].update(portfolio)
    except:
        pass
    data['lastUpdated'] = int(time.time() * 1000)
    
    cursor.execute('UPDATE wallets SET data = ? WHERE address = ?', (json.dumps(data), '$addr'))
    db.commit()
    print(f'  ✅ $addr: NCH {float(\"$LIVE_BALANCE\"):,.2f}')
else:
    print(f'  ⚠️  $addr: Not found in DB')

db.close()
" 2>/dev/null

  UPDATED=$((UPDATED + 1))
done

echo ""
echo "📊 Updated $UPDATED/$TOTAL wallets"
echo ""

# Verification
echo "🔍 Verification - Top 5 wallets after sync:"
sqlite3 "$DB_PATH" "
SELECT address, 
       printf('%.2f', CAST(json_extract(data, '$.balance') AS REAL)) as nch_balance
FROM wallets 
ORDER BY CAST(json_extract(data, '$.balance') AS REAL) DESC 
LIMIT 5;
" | while IFS='|' read -r addr bal; do
  echo "  $addr: NCH $bal"
done

echo ""
echo "✅ Local SQLite sync complete!"
