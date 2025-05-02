// Centralized service and infrastructure wiring for the application
import { InMemoryEventBus } from '../infrastructure/eventBus/InMemoryEventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { PlayerActionService } from './playerActionService';
// Import other services as you add them

// Instantiate shared infrastructure
const eventBus = new InMemoryEventBus<SocketEventMap>();

// Instantiate application services
const playerActionService = new PlayerActionService(eventBus);
// Add more services here as needed

export {
  eventBus,
  playerActionService,
  // Export other services here
};
