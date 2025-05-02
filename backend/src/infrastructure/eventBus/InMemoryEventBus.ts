import { EventBus } from './EventBus';
import { EventEmitter } from 'events';

export class InMemoryEventBus<EventMap> implements EventBus<EventMap> {
  private emitter = new EventEmitter();
  private subscribedEvents = new Set<keyof EventMap>();

  publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event as string, payload);
  }

  subscribe<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.subscribedEvents.add(event);
    this.emitter.on(event as string, handler);
  }

  unsubscribe<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    this.emitter.off(event as string, handler);
    if (this.emitter.listenerCount(event as string) === 0) {
      this.subscribedEvents.delete(event);
    }
  }

  getSubscribedEventNames(): (keyof EventMap)[] {
    return Array.from(this.subscribedEvents);
  }
}
