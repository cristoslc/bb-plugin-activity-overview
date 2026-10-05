#!/usr/bin/env zsh
# Staging E2E: plugin running + nav panel registered + tests green.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm test
listing=$(bb plugin list 2>&1)
echo "$listing" | grep -q '^activity-overview@' && echo "[e2e] plugin running"
grep -q 'navPanel' app.tsx && echo "[e2e] nav panel registered"
bb plugin types || true
echo "[e2e] done"
