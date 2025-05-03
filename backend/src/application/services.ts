// Centralized service and infrastructure wiring for the application
// This file is deprecated in favor of the service registry in services/index.ts
// All service initialization and access should use initializeServiceRegistry and getServiceRegistry from services/index.ts
// Do not use initAppServices or getInitializedServices from this file.

import { InMemoryEventBus } from '../infrastructure/eventBus/InMemoryEventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { PlayerActionService } from './playerActionService';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { ScoreService } from './scoreService';
import { LeaderboardService } from './leaderboardService';
import { connectToDatabase } from '../infrastructure/persistence/db';


type AppServices = {
  eventBus: InMemoryEventBus<SocketEventMap>;
  gameStateService: GameStateService;
  gameUpdateService: GameUpdateService;
  scoreService: ScoreService;
  playerActionService: PlayerActionService;
  leaderboardService: LeaderboardService;
}
let initializedServices: AppServices | undefined = undefined;

// Export an async initializer for all services
export function initAppServices(): AppServices {

  const eventBus = new InMemoryEventBus<SocketEventMap>();
const gameStateService = new GameStateService();
const gameUpdateService = new GameUpdateService();
const scoreService = new ScoreService(eventBus, gameStateService, gameUpdateService);
const playerActionService = new PlayerActionService(eventBus, gameStateService, gameUpdateService, scoreService);
  const leaderboardService = new LeaderboardService(eventBus, gameStateService, gameUpdateService, scoreService);

  const services = {
  eventBus,
    gameStateService,
    gameUpdateService,
    scoreService,
  playerActionService,
    leaderboardService,
};
  initializedServices = services
  return services;
}

export function getInitializedServices() {
  if (!initializedServices) {
    return initAppServices();
  }
  return initializedServices;
}

