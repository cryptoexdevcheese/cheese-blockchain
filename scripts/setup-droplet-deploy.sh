#!/usr/bin/env bash
# One-time setup: SSH key + GitHub Actions secrets for droplet deploy.
# Run from any directory: bash /path/to/cheese-blockchain/scripts/setup-droplet-deploy.sh
set -euo pipefail

DROPLET_USER="${DROPLET_USER:-root}"
DROPLET_HOST="${DROPLET_HOST:-165.22.252.113}"
REPO="${REPO:-cryptoexdevcheese/cheese-blockchain}"
KEY_PATH="${KEY_PATH:-$HOME/.ssh/cheese_ci_deploy}"

echo "== Droplet deploy setup =="
echo "   REPO:  $REPO"
echo "   HOST:  $DROPLET_USER@$DROPLET_HOST"
echo "   KEY:   $KEY_PATH"
echo

if ! command -v gh >/dev/null 2>&1; then
  echo "Installing GitHub CLI..."
  brew install gh
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Log in to GitHub (browser):"
  gh auth login
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Creating deploy key..."
  ssh-keygen -t ed25519 -C "gh-actions-cheese-deploy" -f "$KEY_PATH" -N ""
else
  echo "Deploy key already exists: $KEY_PATH"
fi

echo "Installing public key on droplet (uses your normal SSH login once)..."
ssh-copy-id -i "${KEY_PATH}.pub" "${DROPLET_USER}@${DROPLET_HOST}"

echo "Testing CI-style SSH login..."
ssh -i "$KEY_PATH" -o IdentitiesOnly=yes "${DROPLET_USER}@${DROPLET_HOST}" "echo CONNECTED_OK && hostname"

echo "Setting GitHub secrets..."
gh secret set DROPLET_SSH_KEY --repo "$REPO" < "$KEY_PATH"
gh secret set DROPLET_HOST   --repo "$REPO" --body "$DROPLET_HOST"
gh secret set DROPLET_USER   --repo "$REPO" --body "$DROPLET_USER"

echo "Triggering deploy workflow..."
gh workflow run "Deploy to DigitalOcean Droplet" --repo "$REPO" --ref master

echo "Done. Watch progress:"
echo "  gh run list --repo $REPO --workflow deploy-droplet.yml"
