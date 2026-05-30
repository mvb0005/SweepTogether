import React from 'react';
import { useViewportContext } from '../contexts/ViewportContext';
import { usePlayerContext } from '../contexts/PlayerContext';

interface GameHudProps {
  isConnected: boolean;
  isPlayerLocked: boolean;
  loadedChunkCount: number;
  isInitialLoad: boolean;
}

const GameHud: React.FC<GameHudProps> = ({
  isConnected,
  isPlayerLocked,
  loadedChunkCount,
  isInitialLoad,
}) => {
  const { scale, hoverCell } = useViewportContext();
  const { self } = usePlayerContext();
  const posX = self?.x ?? 0;
  const posY = self?.y ?? 0;

  return (
    <div className="game-hud" role="status">
      <div className="game-hud__row">
        <span className="game-hud__brand">SweepTogether</span>
        <span className={`game-hud__pill ${isConnected ? 'game-hud__pill--ok' : ''}`}>
          {isConnected ? 'Connected' : 'Reconnecting…'}
        </span>
      </div>
      <div className="game-hud__row game-hud__stats">
        <span>Pos ({posX}, {posY})</span>
        <span>Zoom {Math.round(scale * 100)}%</span>
        <span>Chunks {loadedChunkCount}</span>
        {hoverCell && (
          <span>
            Cell ({hoverCell.x}, {hoverCell.y})
          </span>
        )}
      </div>
      {isInitialLoad && <div className="game-hud__banner">Loading world…</div>}
      {isPlayerLocked && (
        <div className="game-hud__banner game-hud__banner--lockout">
          You hit a mine — wait for unlock
        </div>
      )}
      <div className="game-hud__help">
        WASD / arrows move · Click reveal · Right-click flag · Double-click chord · Wheel zoom
      </div>
    </div>
  );
};

export default GameHud;
