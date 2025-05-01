import { useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';

// Define the shape of the hook's return value
interface UseSocketReturn {
    socket: Socket | null;
  isConnected: boolean;
}

/**
 * Custom React hook to manage Socket.IO connection.
 */
export function useSocket(): UseSocketReturn {
    const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    // Connect to the server (same origin, proxied by Nginx in production/Docker)
    const newSocket = io();
    console.log('Attempting to connect socket...');

    setSocket(newSocket);

    // Event listeners
    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected.');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error: Error) => { // Add type to error parameter
      console.error('Socket connection error:', error);
      setIsConnected(false);
      // Optionally add retry logic or user feedback here
    });

    // Cleanup on component unmount
    return () => {
      console.log('Disconnecting socket...');
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  return { socket, isConnected };
}
