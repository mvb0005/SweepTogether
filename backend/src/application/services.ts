// Centralized service and infrastructure wiring for the application
import { InMemoryEventBus } from '../infrastructure/eventBus/InMemoryEventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { PlayerActionService } from './playerActionService';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { ScoreService } from './scoreService';
import { LeaderboardService } from './leaderboardService';

// Instantiate shared infrastructure
const eventBus = new InMemoryEventBus<SocketEventMap>();

// Instantiate application services
const gameStateService = new GameStateService();
const gameUpdateService = new GameUpdateService();
const scoreService = new ScoreService(eventBus, gameStateService, gameUpdateService);
const playerActionService = new PlayerActionService(eventBus, gameStateService, gameUpdateService, scoreService);
const leaderboardService = new LeaderboardService(eventBus, gameStateService, gameUpdateService, scoreService);
// Add more services here as needed

export {
  eventBus,
    gameStateService,
    gameUpdateService,
    scoreService,
  playerActionService,
    leaderboardService,
  // Export other services here
};
