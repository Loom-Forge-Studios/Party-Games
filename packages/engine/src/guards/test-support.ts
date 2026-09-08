// Tiny shared test fixture helper (players roster) used by more than one
// guard's *.test.ts file — not part of any guard's own logic.
import type { PlayerPublic } from '@party/protocol';

export function makePlayers(count: number): PlayerPublic[] {
  return Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    username: `Player ${seat}`,
    seat,
    connected: true,
    isHost: seat === 0,
  }));
}
