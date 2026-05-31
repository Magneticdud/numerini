import { WebSocket } from 'ws';
import { ipcMain, WebContents } from 'electron';

// ── Typed event definitions ──────────────────────────────────────────────────

export type NumeriniEvent =
  | { type: 'call';             queueId: number; number: number; suffix: string | null; calledBy: string }
  | { type: 'queue_state';      queueId: number; current: number; waiting: number }
  | { type: 'reset';            queueId: number }
  | { type: 'ticket_status';    ticketId: number; position: number; eta: number | null }
  | { type: 'ticket:transferred'; queueId: number; newTicketId: number; number: number; suffix: string | null; originalTicketId: number };

// WS client roles
type ClientRole = 'display' | 'admin' | 'wait';

interface WsClient {
  ws: WebSocket;
  role: ClientRole;
  ticketId?: number; // for 'wait' clients — tracks the original ticket ID
  authenticated: boolean;
}

const wsClients: WsClient[] = [];
const rendererContents: WebContents[] = [];

export function registerRenderer(contents: WebContents): void {
  rendererContents.push(contents);
  contents.on('destroyed', () => {
    const i = rendererContents.indexOf(contents);
    if (i >= 0) rendererContents.splice(i, 1);
  });
}

export function registerWsClient(ws: WebSocket, role: ClientRole, opts?: { ticketId?: number; token?: string; adminToken?: string }): void {
  const authenticated = role === 'admin'
    ? opts?.token === opts?.adminToken
    : true;

  const client: WsClient = { ws, role, ticketId: opts?.ticketId, authenticated };
  wsClients.push(client);

  ws.on('close', () => {
    const i = wsClients.indexOf(client);
    if (i >= 0) wsClients.splice(i, 1);
  });
}

export function broadcast(event: NumeriniEvent): void {
  const json = JSON.stringify(event);

  for (const contents of rendererContents) {
    if (!contents.isDestroyed()) {
      contents.send('numerini-event', event);
    }
  }

  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;

    if (event.type === 'call' || event.type === 'reset') {
      client.ws.send(json);
    } else if (event.type === 'queue_state' && client.role === 'admin' && client.authenticated) {
      client.ws.send(json);
    } else if (event.type === 'ticket_status' && client.role === 'wait' && client.ticketId === event.ticketId) {
      client.ws.send(json);
    } else if (event.type === 'ticket:transferred') {
      // Send to display and admin so the waiting list updates immediately.
      // Send to the wait client that was tracking the OLD ticket ID so the
      // /wait page can redirect to the new ticket.
      if (client.role === 'display' || (client.role === 'admin' && client.authenticated)) {
        client.ws.send(json);
      } else if (client.role === 'wait' && client.ticketId === event.originalTicketId) {
        client.ws.send(json);
      }
    }
  }
}

export function broadcastQueueState(queueId: number, current: number, waiting: number): void {
  broadcast({ type: 'queue_state', queueId, current, waiting });
}
