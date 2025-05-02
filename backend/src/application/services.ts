// Centralized service and infrastructure wiring for the application
import { InMemoryEventBus } from '../infrastructure/eventBus/InMemoryEventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { PlayerActionService } from './playerActionService';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';

// Instantiate shared infrastructure
const eventBus = new InMemoryEventBus<SocketEventMap>();

// Instantiate application services
const gameStateService = new GameStateService();
const gameUpdateService = new GameUpdateService();
const playerActionService = new PlayerActionService(eventBus, gameStateService, gameUpdateService);
// Add more services here as needed

export {
  eventBus,
    gameStateService,
    gameUpdateService,
  playerActionService,
  // Export other services here
};
