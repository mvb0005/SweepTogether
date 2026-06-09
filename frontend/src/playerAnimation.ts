import { Coordinates } from './types';
import { MOVE_ANIM_MS, CAMERA_FOLLOW_MS } from './constants';

export function cellCenter(cell: Coordinates): Coordinates {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpCoord(from: Coordinates, to: Coordinates, t: number): Coordinates {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

export interface TimedAnimation {
  from: Coordinates;
  to: Coordinates;
  startMs: number;
  durationMs: number;
}

export function advanceAnimation(
  anim: TimedAnimation | null,
  nowMs: number,
): { pos: Coordinates; done: boolean; next: TimedAnimation | null } {
  if (!anim) return { pos: { x: 0, y: 0 }, done: true, next: null };
  if (anim.durationMs <= 0) return { pos: anim.to, done: true, next: null };
  const t = Math.min(1, (nowMs - anim.startMs) / anim.durationMs);
  const pos = lerpCoord(anim.from, anim.to, easeOutQuad(t));
  if (t >= 1) return { pos: anim.to, done: true, next: null };
  return { pos, done: false, next: anim };
}

export function startMoveAnimation(
  currentDisplay: Coordinates,
  targetCell: Coordinates,
  nowMs: number,
): TimedAnimation {
  return {
    from: currentDisplay,
    to: cellCenter(targetCell),
    startMs: nowMs,
    durationMs: MOVE_ANIM_MS,
  };
}

export function startCameraAnimation(
  current: Coordinates,
  target: Coordinates,
  nowMs: number,
): TimedAnimation {
  return {
    from: current,
    to: target,
    startMs: nowMs,
    durationMs: CAMERA_FOLLOW_MS,
  };
}

export interface AnimatedPlayer {
  id: string;
  username: string;
  color: string;
  avatarUrl?: string;
  discordUserId?: string;
  cell: Coordinates;
  display: Coordinates;
  moveAnim: TimedAnimation | null;
}

export function tickPlayerDisplay(player: AnimatedPlayer, nowMs: number): boolean {
  const target = cellCenter(player.cell);
  if (!player.moveAnim) {
    const dx = target.x - player.display.x;
    const dy = target.y - player.display.y;
    if (dx * dx + dy * dy < 1e-6) {
      player.display = target;
      return false;
    }
    player.moveAnim = startMoveAnimation(player.display, player.cell, nowMs);
  }
  const step = advanceAnimation(player.moveAnim, nowMs);
  player.display = step.pos;
  player.moveAnim = step.next;
  return !step.done;
}
