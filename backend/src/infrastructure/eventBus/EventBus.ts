// EventBus interface for publish/subscribe pattern
export interface EventBus<EventMap> {
  publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
  subscribe<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void;
  unsubscribe<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void;
  getSubscribedEventNames(): (keyof EventMap)[];
}
