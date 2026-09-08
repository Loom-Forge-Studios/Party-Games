import type { ConnectionStatus } from '../app/connection.js';
import { el } from './dom.js';

const LABELS: Record<ConnectionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

/**
 * Always-visible connection status indicator (DoD: "a visible connection
 * status"). `role="status"` + `aria-live="polite"` announce changes to
 * screen readers without stealing focus.
 */
export function renderConnectionStatus(status: ConnectionStatus): HTMLElement {
  return el(
    'div',
    {
      class: `pg-status pg-status--${status}`,
      role: 'status',
      'aria-live': 'polite',
      'data-testid': 'connection-status',
    },
    [el('span', { class: 'pg-status__dot', 'aria-hidden': 'true' }), LABELS[status]],
  );
}
