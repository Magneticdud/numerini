# Changelog

All notable changes to Numerini are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.2.0.0] - 2026-05-31

### Added

- **Wrong-queue transfer** — operators can now reassign a customer to the correct queue directly from the admin panel. The customer gets an intermediate ticket number (e.g., "22B") that preserves their original arrival time: they are served before anyone who arrived after them in the target queue.
- **Transfer receipt** — when a ticket is transferred, a new ESC/POS receipt is printed automatically at the operator station, showing the new number and "Numero trasferito. Il tuo posto è garantito."
- **Admin panel transfer modal** — the "Chiama successivo" button now activates a "Trasferisci" action. A modal lets the operator pick the destination queue and confirm. Confirmation and error feedback are shown inline.
- **Display screen suffix support** — the large-number display correctly shows suffixed numbers (e.g., "022B") and plays the chime as normal.
- **Wait page transfer redirect** — the `/wait/:id` QR page detects when a ticket is transferred via WebSocket and shows the new number with a 5-second auto-redirect to the new ticket. If the page is opened after a transfer (stale QR), it redirects immediately on load.
- **Transfer analytics table** — every transfer is logged in `ticket_transfers` (source queue, target queue, timestamp). When a queue generates many transfers, it is a signal that its name or description on the kiosk is confusing customers.
- **REST endpoint** `POST /api/tickets/:id/transfer` with full error responses for invalid states, self-transfers, and missing queues.

### Changed

- `callNext` now returns the full `Ticket` object (number + suffix + status) instead of a plain integer. The `call` WebSocket event includes the suffix field so the display screen always shows the correct label.
- `ReceiptData.number` renamed to `ticketLabel: string` — the print controller now accepts composite labels ("22B") directly.
- Queue reset now also clears `transferred` source tickets, preventing stale rows from accumulating across daily resets.
- Wrap-around in ticket issuance (`999→1`) no longer marks suffix tickets (transferred customers) as done — only null-suffix waiting tickets at the same number are cleared.

### Fixed

- Migration runs inside a transaction so a mid-startup crash cannot leave the schema half-migrated (which would cause a duplicate-column error on the next boot).
- Source queue badge counter updates correctly after a transfer (previously the wrong queue ID was used for the WebSocket broadcast).
- `/wait` page no longer enters a reconnect loop after a transfer — the WebSocket close handler is cleared before disconnecting.
- Display labels in admin toasts and API responses are now zero-padded to 3 digits ("022", not "22").
- Queue names are HTML-escaped in the admin panel, closing an XSS surface via the config file.

## [0.1.0.0] - 2026-05-28

### Added

- Initial implementation: dual-screen Electron kiosk (kiosk window + display window)
- SQLite queue state machine (tickets, queues, calls tables)
- Thermal receipt printing via ESC/POS to `/dev/usb/lp0`
- REST API with bearer token auth (`/api/queues`, `/api/queues/:id/next`, `/api/issue`, etc.)
- WebSocket live updates to display screen, admin panel, and `/wait` pages
- Admin HTML panel with queue call and reset controls
- Customer `/wait/:id` page with position and ETA polling
- Idle slideshow on display screen (configurable image folder)
- `order_pickup` queue type with external order-check API integration
- i18next localization (Italian default)
- First-run configuration wizard
