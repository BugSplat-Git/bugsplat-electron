#!/usr/bin/env bash
# Prepares an Ubuntu GitHub runner to launch Electron with its sandbox enabled (used by the e2e jobs).
set -euo pipefail

sudo apt-get update
sudo apt-get install -y xvfb libnss3 libgbm1 libasound2t64 libxss1 libgtk-3-0

# Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor. Chromium's sandbox needs
# them now that recent Electron builds no longer ship the setuid chrome-sandbox helper.
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true

# Older Electron builds still ship the setuid helper, which must be root-owned and setuid.
SANDBOX=node_modules/electron/dist/chrome-sandbox
if [ -f "$SANDBOX" ]; then
    sudo chown root:root "$SANDBOX"
    sudo chmod 4755 "$SANDBOX"
fi
