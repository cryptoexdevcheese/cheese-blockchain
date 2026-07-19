#!/bin/bash

# CHEESE BLOCKCHAIN - DigitalOcean Droplet Deployment Script
# This script deploys the Cheese Blockchain to a DigitalOcean droplet
# and sets up automatic deployment from GitHub

set -e

echo "🧀 CHEESE BLOCKCHAIN - DIGITALOCEAN DROPLET DEPLOYMENT"
echo "=========================================================="

# Configuration
REPO_URL="https://github.com/cryptoexdevcheese/cheese-blockchain.git"
BRANCH="master"
DEPLOY_DIR="/opt/cheese-blockchain"
APP_DIR="$DEPLOY_DIR/cheese-blockchain"
SERVICE_NAME="cheese-blockchain"
GITHUB_WEBHOOK_SECRET="cheese-blockchain-webhook-secret"
GITHUB_WEBHOOK_PORT="3000"

echo "📍 Droplet IP: 165.22.252.113"
echo "📁 Deploy Directory: $DEPLOY_DIR"
echo "🔗 Repository: $REPO_URL"
echo "🌿 Branch: $BRANCH"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (sudo)"
    exit 1
fi

echo "📦 Step 1: Installing dependencies..."
apt-get update
apt-get install -y curl git nginx python3 python3-pip build-essential

echo "🔧 Step 2: Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
node --version
npm --version

echo "🐍 Step 3: Installing Python dependencies..."
pip3 install --upgrade pip
pip3 install flask requests python-dotenv

echo "📂 Step 4: Creating deployment directory..."
mkdir -p $DEPLOY_DIR
cd $DEPLOY_DIR

echo "📥 Step 5: Cloning repository..."
if [ -d "$APP_DIR" ]; then
    echo "Repository already exists, pulling latest changes..."
    cd $APP_DIR
    git fetch origin
    git reset --hard origin/$BRANCH
    git pull origin $BRANCH
else
    git clone $REPO_URL $APP_DIR
    cd $APP_DIR
fi

echo "📦 Step 6: Installing Node.js dependencies..."
cd $APP_DIR
npm install

echo "⚙️  Step 7: Configuring environment variables..."
if [ ! -f "$APP_DIR/.env" ]; then
    cp $APP_DIR/.env.example $APP_DIR/.env
    echo "Created .env from .env.example"
    echo "⚠️  Please update .env with your production values"
fi

echo "🔐 Step 8: Installing PM2 for process management..."
npm install -g pm2
pm2 update

echo "🌐 Step 9: Setting up Nginx..."
cat > /etc/nginx/sites-available/$SERVICE_NAME <<EOF
server {
    listen 80;
    server_name 165.22.252.113;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /webhook {
        proxy_pass http://localhost:3000/webhook;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "🪝 Step 10: Setting up automatic deployment webhook..."
cat > $DEPLOY_DIR/webhook-server.py <<'EOF'
#!/usr/bin/env python3
from flask import Flask, request, jsonify
import subprocess
import hmac
import hashlib
import os

app = Flask(__name__)

WEBHOOK_SECRET = os.environ.get('GITHUB_WEBHOOK_SECRET', 'cheese-blockchain-webhook-secret')
APP_DIR = '/opt/cheese-blockchain/cheese-blockchain'

def verify_signature(payload, signature):
    """Verify GitHub webhook signature"""
    if not signature:
        return False
    
    payload_bytes = payload if isinstance(payload, bytes) else payload.encode('utf-8')
    hash_object = hmac.new(
        WEBHOOK_SECRET.encode('utf-8'),
        payload_bytes,
        hashlib.sha256
    )
    expected_signature = f"sha256={hash_object.hexdigest()}"
    return hmac.compare_digest(expected_signature, signature)

@app.route('/webhook', methods=['POST'])
def webhook():
    """Handle GitHub webhook for automatic deployment"""
    signature = request.headers.get('X-Hub-Signature-256')
    payload = request.data

    if not verify_signature(payload, signature):
        return jsonify({'error': 'Invalid signature'}), 401

    try:
        data = request.json
        branch = data.get('ref', '').replace('refs/heads/', '')
        
        if branch == 'master':
            print(f"🚀 Deployment triggered for branch: {branch}")
            
            # Pull latest changes
            subprocess.run(['git', 'fetch', 'origin'], cwd=APP_DIR, check=True)
            subprocess.run(['git', 'reset', '--hard', f'origin/{branch}'], cwd=APP_DIR, check=True)
            
            # Install dependencies
            subprocess.run(['npm', 'install'], cwd=APP_DIR, check=True)
            
            # Restart application
            subprocess.run(['pm2', 'restart', 'cheese-blockchain'], check=True)
            
            return jsonify({'status': 'success', 'message': 'Deployment completed'})
        else:
            return jsonify({'status': 'ignored', 'message': f'Ignoring branch: {branch}'})
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'cheese-blockchain-webhook'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000)
EOF

chmod +x $DEPLOY_DIR/webhook-server.py

echo "🔧 Step 11: Setting up webhook as systemd service..."
cat > /etc/systemd/system/$SERVICE_NAME-webhook.service <<EOF
[Unit]
Description=Cheese Blockchain GitHub Webhook
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$DEPLOY_DIR
ExecStart=/usr/bin/python3 $DEPLOY_DIR/webhook-server.py
Restart=always
Environment="GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET"

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME-webhook
systemctl start $SERVICE_NAME-webhook

echo "🚀 Step 12: Starting Cheese Blockchain application..."
cd $APP_DIR

# Check if start-server.js exists
if [ -f "start-server.js" ]; then
    pm2 start start-server.js --name "cheese-blockchain"
    pm2 save
    pm2 startup
else
    echo "⚠️  start-server.js not found, checking for alternative entry points..."
    if [ -f "server.js" ]; then
        pm2 start server.js --name "cheese-blockchain"
        pm2 save
        pm2 startup
    elif [ -f "index.js" ]; then
        pm2 start index.js --name "cheese-blockchain"
        pm2 save
        pm2 startup
    else
        echo "❌ No entry point found. Please create start-server.js or specify main file."
    fi
fi

echo "🔥 Step 13: Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "✅ DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo "=========================================="
echo ""
echo "📍 Application URL: http://165.22.252.113"
echo "🪝 Webhook URL: http://165.22.252.113:3000/webhook"
echo "📊 PM2 Dashboard: Run 'pm2 monit'"
echo "📋 Application Logs: Run 'pm2 logs cheese-blockchain'"
echo "🌐 Nginx Logs: tail -f /var/log/nginx/error.log"
echo ""
echo "🔧 NEXT STEPS:"
echo "1. Update .env file with production values"
echo "2. Configure GitHub webhook with secret: $GITHUB_WEBHOOK_SECRET"
echo "3. GitHub Webhook URL: http://165.22.252.113:3000/webhook"
echo "4. Test webhook by pushing to GitHub"
echo ""
echo "🎉 Your Cheese Blockchain is now live on DigitalOcean!"