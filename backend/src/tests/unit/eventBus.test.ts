import { InMemoryEventBus } from '../../infrastructure/eventBus/InMemoryEventBus';

type TestEventMap = {
  testEvent: { message: string; count: number };
};

describe('InMemoryEventBus (TestEventMap)', () => {
  let bus: InMemoryEventBus<TestEventMap>;
  let received: TestEventMap['testEvent'][];
  let handler: (payload: TestEventMap['testEvent']) => void;

  beforeEach(() => {
    bus = new InMemoryEventBus<TestEventMap>();
    received = [];
    handler = (payload) => received.push(payload);
  });

  it('should publish and subscribe to testEvent with correct types', () => {
    bus.subscribe('testEvent', handler);
    const payload = { message: 'hello', count: 42 };
    bus.publish('testEvent', payload);
    expect(received).toEqual([payload]);
  });

  it('should call all subscribers for the same event', () => {
    const received2: TestEventMap['testEvent'][] = [];
    const handler2 = (payload: TestEventMap['testEvent']) => received2.push(payload);
    bus.subscribe('testEvent', handler);
    bus.subscribe('testEvent', handler2);
    const payload = { message: 'multi', count: 2 };
    bus.publish('testEvent', payload);
    expect(received).toEqual([payload]);
    expect(received2).toEqual([payload]);
  });

  it('should not call unsubscribed handlers', () => {
    bus.subscribe('testEvent', handler);
    bus.unsubscribe('testEvent', handler);
    bus.publish('testEvent', { message: 'gone', count: 0 });
    expect(received).toEqual([]);
  });

  it('should not throw if publishing with no subscribers', () => {
    expect(() => bus.publish('testEvent', { message: 'none', count: 1 })).not.toThrow();
    expect(received).toEqual([]);
  });

  it('should support dynamic subscription after publish', () => {
    const payload = { message: 'late', count: 99 };
    bus.publish('testEvent', payload); // No subscribers yet
    bus.subscribe('testEvent', handler);
    bus.publish('testEvent', payload); // Should be received
    expect(received).toEqual([payload]);
  });

  it('should not call handler after multiple unsubscriptions', () => {
    bus.subscribe('testEvent', handler);
    bus.unsubscribe('testEvent', handler);
    bus.unsubscribe('testEvent', handler); // Should be idempotent
    bus.publish('testEvent', { message: 'gone', count: 0 });
    expect(received).toEqual([]);
  });

  it('should handle null/undefined payloads', () => {
    bus.subscribe('testEvent', handler);
    // @ts-expect-error: purposely sending undefined
    bus.publish('testEvent', undefined);
    // @ts-expect-error: purposely sending null
    bus.publish('testEvent', null);
    expect(received).toEqual([undefined, null]);
  });
});
