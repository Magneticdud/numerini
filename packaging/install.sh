#!/bin/bash
# Numerini install script
# Usage: curl -fsSL https://... | bash

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
info()  { echo -e "${GREEN}[numerini]${NC} $*"; }
error() { echo -e "${RED}[numerini]${NC} $*" >&2; }

# Must run as root for system-level installs
if [[ $EUID -ne 0 ]]; then
  error "Run as root: sudo bash install.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-$USER}"

info "Installing system dependencies..."
apt-get update -q
apt-get install -y -q espeak-ng avahi-daemon avahi-utils libavahi-client3

# Add user to lp group for USB printer access
if ! groups "$REAL_USER" | grep -q '\blp\b'; then
  info "Adding $REAL_USER to lp group (logout required to take effect)"
  usermod -aG lp "$REAL_USER"
fi

# Detect printer
for DEV in /dev/usb/lp0 /dev/usb/lp1 /dev/ttyUSB0 /dev/ttyUSB1; do
  if [[ -e "$DEV" ]]; then
    info "Detected printer at $DEV"
    chmod 666 "$DEV" || true
    break
  fi
done

# Enable avahi for mDNS (numerini.local)
systemctl enable avahi-daemon
systemctl start avahi-daemon

# Install logrotate config
install -m 644 /usr/share/numerini/logrotate.conf /etc/logrotate.d/numerini

# Install systemd user service
UNIT_DIR="/home/$REAL_USER/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cp /usr/share/numerini/numerini-app.service "$UNIT_DIR/"
su -c "systemctl --user daemon-reload" "$REAL_USER"
su -c "systemctl --user enable numerini-app.service" "$REAL_USER"

# Cloudflare tunnel (optional)
if [[ -f "/home/$REAL_USER/.config/numerini/cf-tunnel-token" ]]; then
  CF_TOKEN=$(cat "/home/$REAL_USER/.config/numerini/cf-tunnel-token")
  info "Configuring Cloudflare Tunnel..."
  # Install cloudflared if not present
  if ! command -v cloudflared &>/dev/null; then
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -q && apt-get install -y cloudflared
  fi
  systemctl enable "cloudflared@$CF_TOKEN"
  systemctl start  "cloudflared@$CF_TOKEN"
  info "Cloudflare Tunnel configured"
else
  info "Cloudflare Tunnel not configured (no token found)"
  info "To enable: echo '<your-token>' > ~/.config/numerini/cf-tunnel-token && sudo bash install.sh"
fi

info "Installation complete!"
info "Start Numerini: systemctl --user start numerini-app"
info "Or reboot for auto-start"
