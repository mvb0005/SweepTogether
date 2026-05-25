import React from 'react';
import { useViewportContext } from '../contexts/ViewportContext';
import { useTelemetry } from '../contexts/TelemetryContext';

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
  const { viewport, scale, hoverCell } = useViewportContext();
  const { enabled, config } = useTelemetry();
  const centerX = Math.round(viewport.center.x);
  const centerY = Math.round(viewport.center.y);

  return (
    <div className="game-hud" role="status">
      <div className="game-hud__row">
        <span className="game-hud__brand">SweepTogether</span>
        <span className={`game-hud__pill ${isConnected ? 'game-hud__pill--ok' : ''}`}>
          {isConnected ? 'Connected' : 'Reconnecting…'}
        </span>
        {enabled && (
          <span className="game-hud__pill game-hud__pill--ab" title="A/B experiment cohort">
            AB:{config.variant}
          </span>
        )}
      </div>
      <div className="game-hud__row game-hud__stats">
        <span>Center ({centerX}, {centerY})</span>
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
        Drag pan · Click reveal · Right-click flag · Double-click chord · WASD move · Wheel zoom
      </div>
    </div>
  );
};

export default GameHud;
