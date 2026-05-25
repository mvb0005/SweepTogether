import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { telemetry } from '../telemetry/collector';

const params = new URLSearchParams(window.location.search);
const playerId = params.get('playerId') || 'Anonymous';

const socket: Socket = io({
  query: { playerId },
});

interface SocketContextType {
  socket: Socket;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = (): SocketContextType => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const connectStartedRef = useRef(performance.now());

  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true);
      telemetry.trackDuration('socket_connected', connectStartedRef.current);
    };
    const handleDisconnect = () => {
      setIsConnected(false);
      telemetry.track('socket_disconnected');
      connectStartedRef.current = performance.now();
    };
    const handleError = () => setIsConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleError);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
