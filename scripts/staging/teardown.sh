#!/usr/bin/env zsh
# Remove the staging installation from the local bb server.
set -euo pipefail
bb plugin remove attention || true
echo "[teardown] attention plugin removed"
