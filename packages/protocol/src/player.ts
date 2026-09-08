import type { PlayerId } from './ids.js';

export interface PlayerPublic {
  id: PlayerId;
  username: string;
  seat: number; // 0..n-1, position around the table
  connected: boolean;
  isHost: boolean;
  team?: number; // team games only
}
