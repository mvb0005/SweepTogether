import React, { createContext, useContext } from 'react';

export interface GameContextValue {
  gameId: string;
  playerId: string | null;
  isPlayerLocked: boolean;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

interface GameProviderProps {
  gameId: string;
  playerId: string | null;
  isPlayerLocked: boolean;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
  children: React.ReactNode;
}

export const GameProvider: React.FC<GameProviderProps> = ({
  gameId,
  playerId,
  isPlayerLocked,
  onRevealCell,
  onFlagCell,
  onChordCell,
  children,
}) => {
  const value: GameContextValue = {
    gameId,
    playerId,
    isPlayerLocked,
    onRevealCell,
    onFlagCell,
    onChordCell,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within a GameProvider');
  return ctx;
}
