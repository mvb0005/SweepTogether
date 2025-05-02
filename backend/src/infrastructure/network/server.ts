import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import http from 'http';
import { Server } from "socket.io";
import path from 'path';

// Import the refactored socket handler registration function
import { registerSocketHandlers } from './socketHandlers'; 

// Import DB functions and repository implementation
import { connectToDatabase, disconnectFromDatabase, MongoGameRepository } from '../persistence/db'; 

// Import the application service
import { GameService } from '../../application/gameService';

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

const server = http.createServer(app);
// Configure Socket.IO with CORS settings
const io = new Server(server, {
    cors: {
        origin: "http://localhost:8080", // Allow requests from the frontend origin
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- Instantiate Repository and Service ---
// Instantiate the concrete repository implementation
const gameRepository = new MongoGameRepository(); 
const gameService = new GameService(gameRepository);
// Provide the io server instance to the game service
gameService.setIoServer(io);

// Set up Socket.IO event handlers using the new structure
io.on('connection', (socket) => {
    // Pass the gameService instance to the handler registration
    registerSocketHandlers(io, socket, gameService);
});

// --- Start Server Function (mostly unchanged) ---
async function startServer() {
    try {
        // Connect to the database before starting the server
        await connectToDatabase();

        // Start the HTTP server
        server.listen(PORT, () => {
            console.log(`Server listening on *:${PORT}`);
        });

        // Graceful shutdown (unchanged)
        const shutdown = async (signal: string) => {
            console.log(`\nReceived ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                console.log('HTTP server closed.');
                await disconnectFromDatabase();
                process.exit(0);
            });
            // Force shutdown after timeout
            setTimeout(async () => {
                console.error('Could not close connections in time, forcing shutdown');
                await disconnectFromDatabase(); // Attempt disconnect even on forced shutdown
                process.exit(1);
            }, 10000); // 10 seconds timeout
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT')); // Catches Ctrl+C

    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

// Basic Error Handling (unchanged)
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
};

app.use(errorHandler);

// --- Run the Server --- 
startServer();
