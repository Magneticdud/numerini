# Numerini

Queue management system for small shops — open source, self-hosted, runs on Linux.

**License:** GPL-3.0  
**AI disclosure:** This project was built with Claude Code (Claude AI). AI-assisted development is embraced openly.

## Features

- Dual-screen kiosk: touchscreen for queue selection, TV display for called numbers
- Thermal receipt printing (ESC/POS, EPSON TM-T20III target)
- Voice announcements (espeak-ng, Italian default)
- Web admin panel at `http://numerini.local:8080/admin`
- Customer waiting page via Cloudflare Tunnel (no WiFi/VLAN required)
- "Ritiro lavori" queue type: checks order readiness via external API
- Daily auto-reset, configurable business hours
- i18n ready (Italian default, community translations welcome)
- REST API for external integrations

## Requirements

- Ubuntu 22.04+ (X11 session)
- Node.js 22+ / Electron 31
- EPSON TM-T20III USB thermal printer (other ESC/POS printers may work)
- espeak-ng (`sudo apt install espeak-ng`)

## Quick start

```bash
# Install deps + rebuild native modules against Electron
npm install --ignore-scripts
npx @electron/rebuild -f -w better-sqlite3

# Build
npm run build

# Run
npm start
```

## Install as kiosk service

```bash
sudo bash packaging/install.sh
```

## Security notes

- REST API mutations require a bearer token (shown in first-run wizard)
- `order_check_url` for "Ritiro lavori": any URL is accepted. If set to a local network IP, it bypasses internet access. This is by design for shops with local ERP systems. Physical access to the machine is required to modify this setting.
- The system assumes a trusted shop environment. For untrusted networks, use firewall rules to restrict port 8080.

## Architecture

```
Electron main process
├── Queue engine (SQLite via better-sqlite3)
├── Express HTTP server (port 8080)
│   ├── GET /admin          → operator panel
│   ├── GET /wait/:ticketId → customer waiting page
│   └── REST /api/*         → queue API
├── WebSocket server (/ws) — typed event bus
├── ESC/POS print controller
├── espeak-ng TTS
└── node-cron daily reset

Renderer: Kiosk window (React, touchscreen)
Renderer: Display window (React, TV)
```
