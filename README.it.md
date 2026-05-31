# Numerini

Sistema di gestione code per negozi — open source, self-hosted, gira su Linux.

**Licenza:** GPL-3.0  
**Trasparenza AI:** Questo progetto è stato costruito con Claude Code (Claude AI). L'utilizzo di strumenti AI è dichiarato apertamente.

## Funzionalità

- **Doppio schermo:** touchscreen per la selezione della coda, TV per i numeri chiamati
- **Stampa scontrini termici** (ESC/POS, target EPSON TM-T20III)
- **Annunci vocali** (espeak-ng, italiano predefinito)
- **Pannello operatore** su `http://numerini.local:8080/admin` (da qualsiasi dispositivo sulla LAN)
- **Pagina di attesa cliente** tramite Cloudflare Tunnel — niente WiFi/VLAN
- **Coda "Ritiro lavori":** verifica la disponibilità dell'ordine via API esterna prima di emettere il numero
- **Reset automatico giornaliero**, orari di apertura configurabili
- **Internazionalizzazione** (italiano di default, traduzioni dalla community)
- **REST API** per integrazioni esterne

## Requisiti

- Ubuntu 22.04+ (sessione X11)
- Node.js 22+ — Electron 31
- Stampante termica EPSON TM-T20III USB (altri modelli ESC/POS potrebbero funzionare)
- espeak-ng: `sudo apt install espeak-ng`

## Avvio rapido

```bash
# Installa dipendenze e ricompila i moduli nativi per Electron
npm install --ignore-scripts
npx @electron/rebuild -f -w better-sqlite3

# Build
npm run build

# Avvia
npm start
```

## Eseguire i test

```bash
npm test
```

I test unitari coprono il motore delle code (`issueTicket`, `callNext`, `resetQueue`, `getTicketPosition`, `estimatedWaitSeconds`). Girano su un database SQLite in-memory — Electron non è necessario.

Al primo avvio si apre la procedura guidata di configurazione: assegna i monitor, configura le code, imposta la stampante.

## Installazione come servizio kiosk

```bash
sudo bash packaging/install.sh
```

Lo script installa espeak-ng, avahi-daemon (per `numerini.local`), aggiunge l'utente al gruppo `lp` per la stampante, e crea il servizio systemd che avvia Numerini automaticamente al login.

## Struttura del progetto

```
src/
├── main/               # Processo principale Electron (Node.js)
│   ├── index.ts        # Punto di ingresso, handler IPC
│   ├── config.ts       # Gestione configurazione (~/.config/numerini/)
│   ├── db.ts           # Schema SQLite, WAL mode
│   ├── queue.ts        # Motore delle code (emissione, chiamata, reset)
│   ├── server.ts       # Server HTTP Express + WebSocket
│   ├── events.ts       # Event bus tipizzato (IPC + WS)
│   ├── display-manager.ts  # Gestione finestre Electron dual-screen
│   ├── printer.ts      # Controllore ESC/POS
│   ├── tts.ts          # Annunci vocali (espeak-ng)
│   ├── scheduler.ts    # Reset giornaliero (node-cron)
│   ├── order-check.ts  # Verifica ordine per coda "Ritiro lavori"
│   └── brand.ts        # Configurazione logo e colore negozio
├── renderer/
│   ├── kiosk/          # App React touchscreen cliente
│   └── display/        # App React schermo TV
├── server/             # Pagine HTML statiche servite via Express
│   ├── admin.html      # Pannello operatore
│   ├── wait.html       # Pagina attesa cliente
│   └── siamo-chiusi.html
└── preload.ts          # Bridge sicuro Electron (contextIsolation)

locales/                # Stringhe UI (it.json, en.json)
packaging/              # Script installazione, servizi systemd
```

## Architettura

```
Processo Electron principale
├── Motore code (SQLite, better-sqlite3)
├── Server HTTP Express (porta 8080)
│   ├── GET /admin          → pannello operatore
│   ├── GET /wait/:ticketId → pagina attesa cliente
│   └── REST /api/*         → API code
├── Server WebSocket (/ws)  → event bus tipizzato
│   ├── display:  riceve eventi "call" e "reset"
│   ├── admin:    riceve stato live delle code (autenticato)
│   └── wait:     riceve aggiornamenti posizione ticket
├── Controllore stampa ESC/POS
├── TTS espeak-ng (subprocess)
└── node-cron reset giornaliero

Renderer: Kiosk (React)     ← touchscreen cliente
Renderer: Display (React)   ← TV sala d'attesa
```

## Configurazione

Tutti i file di configurazione si trovano in `~/.config/numerini/`.

```
~/.config/numerini/
├── config.json         # Configurazione principale
└── logs/app.log        # Log errori

~/numerini/
├── brand/
│   ├── logo.png        # Logo negozio
│   ├── logo-receipt.png  # Logo per stampa (1-bit, generato automaticamente)
│   └── color.json      # Colore brand (#hex)
└── slides/             # Immagini per lo slideshow idle (JPEG, PNG, WebP)
```

### config.json — Parametri principali

| Parametro | Descrizione | Default |
|-----------|-------------|---------|
| `queues` | Lista code con nome, tipo, URL verifica ordini | — |
| `printerPath` | Percorso stampante USB | `/dev/usb/lp0` |
| `adminToken` | Token accesso pannello `/admin` | generato |
| `brandColor` | Colore accent negozio (hex) | `#3182ce` |
| `openTime` / `closeTime` | Orari apertura per "siamo chiusi" | `09:00` / `19:00` |
| `resetTime` | Orario reset giornaliero code | `09:00` |
| `ttsEnabled` / `ttsLanguage` | Annunci vocali on/off e lingua | `true` / `it` |
| `language` | Lingua UI | `it` |

## API REST

| Metodo | Percorso | Auth | Descrizione |
|--------|----------|------|-------------|
| GET | `/api/status` | no | Stato app e riepilogo code |
| GET | `/api/queues` | no | Lista code |
| GET | `/api/queues/:id` | no | Stato singola coda |
| POST | `/api/queues/:id/next` | token | Chiama numero successivo |
| POST | `/api/queues/:id/reset` | token | Reset coda a 0 |
| GET | `/api/ticket/:id/status` | no | Posizione e stima attesa ticket |
| POST | `/api/issue` | token | Emette ticket (da sistema esterno) |

L'autenticazione per i metodi POST usa `Authorization: Bearer <token>`. Il token viene generato automaticamente alla prima esecuzione e mostrato nella procedura guidata.

## Coda "Ritiro lavori"

Tipo di coda speciale per negozi con sistema ordini esterno (farmacia, fotografo, tipografia, ecc).

**Flusso:**
1. Cliente tocca "Ritiro lavori" sul kiosk
2. Tastierino numerico custom appare: "Inserisci il tuo numero ordine"
3. Il server chiama `GET {order_check_url}/{numero_ordine}` (timeout 3s)
4. Risposta attesa: `{ "ready": true | false }`
5. Il numero viene **sempre emesso** — se l'API dice "non pronto", il biglietto mostra: *"Il sistema non ha ancora aggiornato il tuo ordine. Verifica al bancone."*
6. Se l'API non risponde: il numero viene emesso senza avvisi

> **Perché viene sempre emesso?** L'ERP potrebbe avere aggiornamenti in ritardo. Il cliente può comunque presentarsi al bancone per verificare.

## Cloudflare Tunnel (accesso esterno senza WiFi)

La pagina di attesa `/wait/:id` è raggiungibile da internet tramite Cloudflare Tunnel — il cliente non deve essere connesso al WiFi del negozio.

**Setup:**
1. Crea un tunnel su [dash.cloudflare.com](https://dash.cloudflare.com)
2. Salva il token in `~/.config/numerini/cf-tunnel-token`
3. Rilancia `sudo bash packaging/install.sh`

**Quando il PC è spento (di notte):** configura un Cloudflare Worker (~5 righe JS, gratis) che intercetta le risposte 502 e mostra una pagina "Siamo chiusi" branded. Vedi la [documentazione Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Note di sicurezza

- Le API mutanti richiedono il bearer token (mostrato nella procedura guidata)
- `order_check_url` accetta qualsiasi URL, inclusi IP locali per ERP aziendali — documentato nel README come comportamento atteso; richiede accesso fisico alla macchina per modificare
- Il sistema è progettato per reti LAN fidate. Per reti con dispositivi non fidati, usa regole firewall per limitare la porta 8080

## Contribuire

PR benvenute. Le traduzioni si aggiungono in `locales/<lang>.json`. Modelli di stampanti testati si aggiungono al README.

Questo è un progetto GPL-3.0: qualsiasi fork derivato deve restare open source.
