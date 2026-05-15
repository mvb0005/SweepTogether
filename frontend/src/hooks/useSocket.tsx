import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback, ReactNode,
} from 'react';

// Set VITE_WORKER_WS_URL in .env.development or .env.production
const WORKER_WS_URL = (import.meta as any).env?.VITE_WORKER_WS_URL ?? 'ws://localhost:8787';

type MessageHandler = (data: Record<string, unknown>) => void;

interface SocketContextType {
  /** Send a typed message to the Worker */
  send: (msg: object) => void;
  isConnected: boolean;
  /** Subscribe to a server message type */
  on:  (type: string, handler: MessageHandler) => void;
  /** Unsubscribe a handler */
  off: (type: string, handler: MessageHandler) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = (): SocketContextType => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within a SocketProvider');
  return ctx;
};

interface SocketProviderProps { children: ReactNode; }

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef       = useRef<WebSocket | null>(null);
  const queueRef    = useRef<string[]>([]);
  const handlersRef = useRef(new Map<string, Set<MessageHandler>>());

  useEffect(() => {
    let ws: WebSocket;
    let dead = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(`${WORKER_WS_URL}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Drain queued messages
        const q = queueRef.current.splice(0);
        for (const m of q) ws.send(m);
      };

      ws.onclose = () => {
        wsRef.current = null;
        setIsConnected(false);
        if (!dead) retryTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = event => {
        let msg: { type: string } & Record<string, unknown>;
        try { msg = JSON.parse(event.data as string); } catch { return; }
        console.debug('[WS]', msg.type, msg);
        handlersRef.current.get(msg.type)?.forEach(h => h(msg));
      };
    };

    connect();
    return () => {
      dead = true;
      clearTimeout(retryTimer);
      ws.close();
    };
  }, []);

  const send = useCallback((msg: object) => {
    const s = JSON.stringify(msg);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(s);
    } else {
      queueRef.current.push(s);
    }
  }, []);

  const on = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) handlersRef.current.set(type, new Set());
    handlersRef.current.get(type)!.add(handler);
  }, []);

  const off = useCallback((type: string, handler: MessageHandler) => {
    handlersRef.current.get(type)?.delete(handler);
  }, []);

  return (
    <SocketContext.Provider value={{ send, isConnected, on, off }}>
      {children}
    </SocketContext.Provider>
  );
};
