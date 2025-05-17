// Canonical service registry for the backend application.
// All service initialization and access should use initAppServices and getInitializedServices from this file.
// Do not create new service instances elsewhere.

import { InMemoryEventBus } from '../infrastructure/eventBus/InMemoryEventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { PlayerActionService } from './playerActionService';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { ScoreService } from './scoreService';
import { LeaderboardService } from './leaderboardService';
import { Server as SocketIOServer } from 'socket.io';

// Singleton service registry
let initializedServices: AppServices | undefined = undefined;

type AppServices = {
  eventBus: InMemoryEventBus<SocketEventMap>;
  gameStateService: GameStateService;
  gameUpdateService: GameUpdateService;
  scoreService: ScoreService;
  playerActionService: PlayerActionService;
  leaderboardService: LeaderboardService;
}

export function initAppServices(io: SocketIOServer): AppServices {
  if (initializedServices) return initializedServices;
  const eventBus = new InMemoryEventBus<SocketEventMap>();
  const gameStateService = new GameStateService(io);
  const gameUpdateService = new GameUpdateService();
  const scoreService = new ScoreService(eventBus, gameStateService, gameUpdateService);
  const playerActionService = new PlayerActionService(eventBus, gameStateService, gameUpdateService, scoreService);
  const leaderboardService = new LeaderboardService(eventBus, gameStateService, gameUpdateService, scoreService);
  initializedServices = {
    eventBus,
    gameStateService,
    gameUpdateService,
    scoreService,
    playerActionService,
    leaderboardService,
  };
  return initializedServices;
}

export function getInitializedServices(io: SocketIOServer): AppServices {
  if (!initializedServices) {
    return initAppServices(io);
  }
  return initializedServices;
}

