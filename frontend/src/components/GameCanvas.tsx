import React, { useCallback, useEffect, useRef } from 'react';
import { ChunkMap } from '../types';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import { usePlayerContext } from '../contexts/PlayerContext';
import { useDiscord } from '../discord/DiscordProvider';
import { BoardRenderer, RenderPlayer, screenToWorldCell } from '../renderer';
import {
  AnimatedPlayer,
  advanceAnimation,
  cellCenter,
  startCameraAnimation,
  startMoveAnimation,
  tickPlayerDisplay,
} from '../playerAnimation';

interface GameCanvasProps {
  chunks: ChunkMap;
  chunkSize: number;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ chunks, chunkSize }) => {
  const { viewport, cellPx, onZoom, setHoverCell } = useViewportContext();
  const { self, others } = usePlayerContext();
  const { getParticipant, speakingUserIds, user: discordUser } = useDiscord();
  const speakingUserIdsRef = useRef(speakingUserIds);
  speakingUserIdsRef.current = speakingUserIds;
  const discordUserRef = useRef(discordUser);
  discordUserRef.current = discordUser;
  const getParticipantRef = useRef(getParticipant);
  getParticipantRef.current = getParticipant;
  const { isPlayerLocked, onRevealCell, onFlagCell, onChordCell } = useGameContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rafRef = useRef<number | null>(null);

  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cellPxRef = useRef(cellPx);
  cellPxRef.current = cellPx;

  const animatedPlayersRef = useRef<Map<string, AnimatedPlayer>>(new Map());
  const cameraCenterRef = useRef(cellCenter({ x: 0, y: 0 }));
  const cameraAnimRef = useRef<ReturnType<typeof startCameraAnimation> | null>(null);
  const needsFrameRef = useRef(true);

  const syncAnimatedPlayers = useCallback(() => {
    const map = animatedPlayersRef.current;
    const seen = new Set<string>();

    const upsert = (
      id: string,
      username: string,
      color: string,
      x: number,
      y: number,
      avatarUrl?: string,
      discordUserId?: string,
    ) => {
      seen.add(id);
      const existing = map.get(id);
      if (!existing) {
        const cell = { x, y };
        map.set(id, {
          id,
          username,
          color,
          avatarUrl,
          discordUserId,
          cell,
          display: cellCenter(cell),
          moveAnim: null,
        });
        return;
      }
      if (existing.cell.x !== x || existing.cell.y !== y) {
        if (self && id === self.id) {
          existing.cell = { x, y };
          existing.display = cellCenter({ x, y });
          existing.moveAnim = null;
        } else {
          existing.moveAnim = startMoveAnimation(existing.display, { x, y }, performance.now());
          existing.cell = { x, y };
        }
      }
      existing.username = username;
      existing.color = color;
      existing.avatarUrl = avatarUrl;
      existing.discordUserId = discordUserId;
    };

    if (self) {
      upsert(self.id, self.username, self.color, self.x, self.y, self.avatarUrl, self.discordUserId);
    }
    for (const p of others) {
      upsert(p.id, p.username, p.color, p.x, p.y, p.avatarUrl, p.discordUserId);
    }

    for (const id of Array.from(map.keys())) {
      if (!seen.has(id)) map.delete(id);
    }
  }, [self, others]);

  useEffect(() => {
    syncAnimatedPlayers();
  }, [syncAnimatedPlayers]);

  const buildRenderPlayers = (): RenderPlayer[] => {
    const out: RenderPlayer[] = [];
    for (const p of animatedPlayersRef.current.values()) {
      const discordUserId = p.id === self?.id
        ? (p.discordUserId ?? discordUserRef.current?.id)
        : p.discordUserId;
      const participant = getParticipantRef.current(discordUserId);
      out.push({
        id: p.id,
        username: participant?.username ?? p.username,
        color: p.color,
        avatarUrl: participant?.avatarUrl ?? p.avatarUrl,
        displayX: p.display.x,
        displayY: p.display.y,
        isSelf: p.id === self?.id,
        isSpeaking: Boolean(discordUserId && speakingUserIdsRef.current.has(discordUserId)),
      });
    }
    return out;
  };

  const paint = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const base = viewportRef.current;
    renderer.render({
      chunks: chunksRef.current,
      chunkSize,
      viewport: { ...base, center: cameraCenterRef.current },
      cellPx: cellPxRef.current,
      players: buildRenderPlayers(),
    });
  }, [chunkSize, self?.id, speakingUserIds]);

  const tickFrame = useCallback(() => {
    const now = performance.now();
    let moving = false;

    for (const player of animatedPlayersRef.current.values()) {
      if (tickPlayerDisplay(player, now)) moving = true;
    }

    const follow = self
      ? animatedPlayersRef.current.get(self.id)?.display ?? cellCenter({ x: self.x, y: self.y })
      : cameraCenterRef.current;

    if (self) {
      cameraCenterRef.current = follow;
      cameraAnimRef.current = null;
    } else {
      const camDistSq =
        (follow.x - cameraCenterRef.current.x) ** 2 +
        (follow.y - cameraCenterRef.current.y) ** 2;

      if (camDistSq > 1e-6) {
        if (!cameraAnimRef.current) {
          cameraAnimRef.current = startCameraAnimation(cameraCenterRef.current, follow, now);
        } else {
          cameraAnimRef.current.to = follow;
        }
        moving = true;
      }

      if (cameraAnimRef.current) {
        const step = advanceAnimation(cameraAnimRef.current, now);
        cameraCenterRef.current = step.pos;
        cameraAnimRef.current = step.next;
        if (!step.done) moving = true;
      }
    }

    paint();
    if (moving) needsFrameRef.current = true;
    return moving;
  }, [paint, self]);

  const requestFrame = useCallback(() => {
    needsFrameRef.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new BoardRenderer(canvas);
    rendererRef.current.onAvatarLoaded = requestFrame;
    needsFrameRef.current = true;
    tickFrame();
  }, [tickFrame, requestFrame]);

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      if (needsFrameRef.current) {
        const stillMoving = tickFrame();
        needsFrameRef.current = stillMoving;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tickFrame]);

  useEffect(() => {
    needsFrameRef.current = true;
  }, [speakingUserIds]);

  useEffect(() => {
    needsFrameRef.current = true;
    paint();
  }, [chunks, viewport.width, viewport.height, cellPx, paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.max(-0.3, Math.min(0.3, -e.deltaY * 0.002));
      onZoom(delta);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [onZoom]);

  const pickCell = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return screenToWorldCell(
      clientX,
      clientY,
      canvas.getBoundingClientRect(),
      { ...viewportRef.current, center: cameraCenterRef.current },
      cellPxRef.current,
    );
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="Minesweeper board"
      style={{ cursor: isPlayerLocked ? 'not-allowed' : 'crosshair' }}
      onMouseMove={e => {
        const cell = pickCell(e.clientX, e.clientY);
        setHoverCell(cell ? { x: cell.worldX, y: cell.worldY } : null);
      }}
      onMouseLeave={() => setHoverCell(null)}
      onClick={e => {
        if (isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onRevealCell(cell.worldX, cell.worldY);
      }}
      onDoubleClick={e => {
        if (isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onChordCell(cell.worldX, cell.worldY);
      }}
      onContextMenu={e => {
        e.preventDefault();
        if (isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onFlagCell(cell.worldX, cell.worldY);
      }}
    />
  );
};

export default GameCanvas;
