#!/usr/bin/env zsh
# Remove the staging installation from the local bb server.
set -euo pipefail
bb plugin remove activity-overview || true
echo "[teardown] activity-overview plugin removed"
