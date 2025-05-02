import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import http from 'http';
import { Server } from "socket.io";
import path from 'path';

// Import from our modular files
import { GameConfig } from './types';
import { setupSocketHandlers, games, pendingGameConfigs } from './socketHandlers';
import { connectToDatabase, disconnectFromDatabase } from './db'; // Import DB functions

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

// --- Game Configuration Endpoint (Needs refactoring for infinite board) ---
// TODO: Refactor this endpoint to handle infinite board config (e.g., initial viewport)
app.post('/configure/:gameId', (req: Request, res: Response, next: NextFunction): void => {
    try {
        const { gameId } = req.params;
        const { config, mineLocations } = req.body as {
            config?: Partial<Omit<GameConfig, 'mineLocations'>>,
            mineLocations?: { row: number, col: number }[]
        };

        // 1. Validate gameId
        if (typeof gameId !== 'string' || gameId.trim().length === 0) {
            console.error(`Invalid /configure request: Missing or invalid gameId format.`);
            res.status(400).json({ error: 'Invalid or missing gameId in URL path. Must be a non-empty string.' });
            return;
        }

        // 2. Validate config object and basic properties
        if (!config || typeof config !== 'object') {
            console.error(`Invalid /configure payload: Missing or invalid 'config' object for gameId ${gameId}.`);
            res.status(400).json({ error: "Request body must include a 'config' object." });
            return;
        }
        if (typeof config.rows !== 'number' || !Number.isInteger(config.rows) || config.rows <= 0) {
            console.error(`Invalid /configure payload: Invalid 'rows' value for gameId ${gameId}:`, config.rows);
            res.status(400).json({ error: 'config.rows must be a positive integer.' });
            return;
        }
        if (typeof config.cols !== 'number' || !Number.isInteger(config.cols) || config.cols <= 0) {
            console.error(`Invalid /configure payload: Invalid 'cols' value for gameId ${gameId}:`, config.cols);
            res.status(400).json({ error: 'config.cols must be a positive integer.' });
            return;
        }
        if (typeof config.mines !== 'number' || !Number.isInteger(config.mines) || config.mines < 0) {
            console.error(`Invalid /configure payload: Invalid 'mines' value for gameId ${gameId}:`, config.mines);
            res.status(400).json({ error: 'config.mines must be a non-negative integer.' });
            return;
        }

        // 3. Validate mine count relative to board size
        const totalCells = config.rows * config.cols;
        if (config.mines >= totalCells) {
            console.error(`Invalid game configuration: Mine count (${config.mines}) exceeds or equals total cells (${totalCells}) for gameId ${gameId}.`);
            res.status(400).json({ error: `config.mines must be less than the total number of cells (${totalCells}).` });
            return;
        }

        // 4. Validate mineLocations if provided
        let validatedMineLocations: { row: number, col: number }[] | undefined = undefined;
        if (mineLocations !== undefined) { // Check explicitly for undefined, allowing empty array
            console.log(`Received mineLocations for game ${gameId}`);
            if (!Array.isArray(mineLocations)) {
                 console.error(`Invalid /configure payload: 'mineLocations' is not an array for gameId ${gameId}.`);
                 res.status(400).json({ error: 'If provided, mineLocations must be an array.' });
                 return;
            }

            // Check if number of mines matches config.mines
            if (mineLocations.length !== config.mines) {
                 console.error(`Invalid /configure payload: mineLocations count mismatch for gameId ${gameId}: Expected ${config.mines}, got ${mineLocations.length}`);
                 res.status(400).json({ error: `mineLocations array length (${mineLocations.length}) must match config.mines (${config.mines}).` });
                 return;
            }

            // Check each location object and coordinates
            const uniqueLocations = new Set<string>();
            for (let i = 0; i < mineLocations.length; i++) {
                const loc = mineLocations[i];
                const locIdentifier = `Location ${i + 1}`;

                if (typeof loc !== 'object' || loc === null) {
                    console.error(`Invalid /configure payload: mineLocations[${i}] is not an object for gameId ${gameId}.`);
                    res.status(400).json({ error: `${locIdentifier}: Each item in mineLocations must be an object.` });
                    return;
                }
                if (typeof loc.row !== 'number' || !Number.isInteger(loc.row)) {
                    console.error(`Invalid /configure payload: mineLocations[${i}].row is invalid for gameId ${gameId}:`, loc.row);
                    res.status(400).json({ error: `${locIdentifier}: 'row' must be an integer.` });
                    return;
                }
                if (typeof loc.col !== 'number' || !Number.isInteger(loc.col)) {
                    console.error(`Invalid /configure payload: mineLocations[${i}].col is invalid for gameId ${gameId}:`, loc.col);
                    res.status(400).json({ error: `${locIdentifier}: 'col' must be an integer.` });
                    return;
                }
                if (loc.row < 0 || loc.row >= config.rows) {
                    console.error(`Invalid /configure payload: mineLocations[${i}].row out of bounds for gameId ${gameId}:`, loc.row);
                    res.status(400).json({ error: `${locIdentifier}: 'row' (${loc.row}) is out of bounds [0, ${config.rows - 1}].` });
                    return;
                }
                if (loc.col < 0 || loc.col >= config.cols) {
                    console.error(`Invalid /configure payload: mineLocations[${i}].col out of bounds for gameId ${gameId}:`, loc.col);
                    res.status(400).json({ error: `${locIdentifier}: 'col' (${loc.col}) is out of bounds [0, ${config.cols - 1}].` });
                    return;
                }

                // Check for duplicate locations
                const locString = `${loc.row},${loc.col}`;
                if (uniqueLocations.has(locString)) {
                    console.error(`Invalid /configure payload: Duplicate mine location found for gameId ${gameId}:`, loc);
                    res.status(400).json({ error: `${locIdentifier}: Duplicate mine location (${loc.row}, ${loc.col}) found.` });
                    return;
                }
                uniqueLocations.add(locString);
            }
            validatedMineLocations = mineLocations;
            console.log(`Validated mineLocations for game ${gameId}`);
        }

        // 5. Prevent re-configuring an existing game
        if (games.has(gameId)) {
            console.warn(`Attempted to configure already existing game ${gameId}`);
            // Use 409 Conflict status code
            res.status(409).json({ error: `Game ${gameId} already exists and cannot be reconfigured.` });
            return;
        }

        // 6. Store the validated configuration
        const tempInitialViewport = { centerX: 0, centerY: 0, width: 30, height: 20 }; // Example
        const finalConfig: GameConfig = {
            initialViewport: tempInitialViewport, // Use viewport
            mineLocations: validatedMineLocations // Keep for fixed mode if supported
        };

        console.log(`Storing pending configuration for game ${gameId}:`, finalConfig);
        pendingGameConfigs.set(gameId, finalConfig);
        res.status(200).json({ message: `Configuration set for game ${gameId}` });

    } catch (error) {
        console.error("Error during game configuration:", error);
        // Pass error to the generic error handler, which will send a 500
        next(error);
    }
});

// Set up Socket.IO event handlers
io.on('connection', (socket) => {
    setupSocketHandlers(io, socket);
});

// --- Start Server Function ---
async function startServer() {
    try {
        // Connect to the database before starting the server
        await connectToDatabase();

        // Start the HTTP server
        server.listen(PORT, () => {
            console.log(`Server listening on *:${PORT}`);
        });

        // Graceful shutdown
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

// Basic Error Handling
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
};

app.use(errorHandler);

// --- Run the Server --- 
startServer();
