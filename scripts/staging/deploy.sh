#!/usr/bin/env zsh
# Staging deploy = path-install the plugin into the local bb server.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm install
bb plugin build
bb plugin install . --yes
bb plugin reload activity-overview
bb plugin list 2>&1 | grep -A2 '^activity-overview@'
echo "[deploy] staging done"
