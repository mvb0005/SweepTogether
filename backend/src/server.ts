import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';
import { connectToDatabase, disconnectFromDatabase } from './infrastructure/persistence/db';
import { initAppServices } from './application/services';
import { setupSocketServer } from './infrastructure/network/socketServer';

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// HTTP server (needed for Socket.IO)
const httpServer = createServer(app);

// Create Socket.IO server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Setup API routes

// Initialize app
async function initializeApp() {
  try {
    // Connect to MongoDB
    await connectToDatabase();
    console.log('Connected to database');

    // Initialize service registry (single source of services)
    initAppServices(io);
    console.log('Service registry initialized');

    // Setup Socket.IO game server
    console.log('Setting up Socket.IO game server');
    console.log('io=', io);
    setupSocketServer(io);
    console.log('Socket.IO game server initialized');

    // Setup API routes

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  
  try {
    // Close database connection
    await disconnectFromDatabase();
    console.log('Database connection closed');
    
    // Close HTTP server
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start application
initializeApp().catch(console.error);

// Export for testing
export { app, httpServer, io };