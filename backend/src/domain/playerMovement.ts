export const MOVE_COOLDOWN_MS = 50;
export const DEFAULT_SPAWN_X = 0;
export const DEFAULT_SPAWN_Y = 0;

const PLAYER_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa',
  '#00acc1', '#fdd835', '#6d4c41', '#546e7a', '#d81b60',
  '#7cb342', '#5e35b1',
];

export function playerColorFromId(playerId: string): string {
  let h = 2_166_136_261;
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return PLAYER_COLORS[Math.abs(h) % PLAYER_COLORS.length];
}

export function validateMoveInput(dx: number, dy: number): boolean {
  return Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx) + Math.abs(dy) === 1;
}

export function canMoveNow(lastMoveAt: number | undefined, now: number): boolean {
  return now - (lastMoveAt ?? 0) >= MOVE_COOLDOWN_MS;
}
