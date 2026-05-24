/**
 * @fileoverview Service responsible for handling player actions within an active game.
 * This includes processing requests to reveal tiles, flag/unflag tiles, and perform
 * chord clicks. It validates actions against game rules and state, updates the
 * game state accordingly (potentially via gameStateService), calculates scoring changes,
 * and triggers necessary updates to be broadcasted (potentially via gameUpdateService).
 */

import { EventBus } from '../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { ScoreService } from './scoreService';
import { PlayerStatus, Cell, GameState, Player } from '../domain/types';
import * as gridLogic from '../domain/gridLogic';
import { getChunkRepository } from '../infrastructure/persistence/db';
import { CHUNK_SIZE } from '../types/chunkTypes';

export class PlayerActionService {
    constructor(
        private eventBus: EventBus<SocketEventMap>,
        private gameStateService: GameStateService,
        private gameUpdateService: GameUpdateService,
        private scoreService: ScoreService
    ) {
        this.eventBus.subscribe('revealTile', this.handleRevealTile.bind(this));
        this.eventBus.subscribe('flagTile', this.handleFlagTile.bind(this));
        this.eventBus.subscribe('chordClick', this.handleChordClick.bind(this));
    }

    /**
     * Validates common preconditions for player actions
     * Returns the game state and player if valid, or null if invalid
     */
    private validateAction(gameId: string, socketId: string): { gameState: GameState, player: Player } | null {
        // 1. Get game state
        const gameState = this.gameStateService.getGame(gameId);
        if (!gameState) {
            console.error(`Game ${gameId} not found.`);
            this.gameUpdateService.sendError(socketId, 'Game not found.');
            return null;
        }

        // 2. Validate game state
        if (gameState.gameOver) {
            console.log(`Game ${gameId} is already over.`);
            return null;
        }

        // 3. Get player from state
        const player = gameState.players[socketId];
        if (!player) {
            console.error(`Player ${socketId} not found in game ${gameId}.`);
            return null;
        }

        // 4. Check if player is locked out
        if (player.status === PlayerStatus.LOCKED_OUT) {
            const now = Date.now();
            if (!player.lockedUntil || now < player.lockedUntil) {
                console.log(`Player ${socketId} is locked out.`);
                return null;
            }
            // Player lockout has expired, reset status
            player.status = PlayerStatus.ACTIVE;
            delete player.lockedUntil;

            // Publish player status update
            this.gameUpdateService.sendPlayerStatusUpdate(
                gameId,
                socketId,
                PlayerStatus.ACTIVE
            );
        }

        return { gameState, player };
    }

    private async handleRevealTile(payload: SocketEventMap['revealTile']) {
        console.log('[PlayerActionService] revealTile event:', payload);

        const { gameId, socketId, x, y } = payload;

        const validationResult = this.validateAction(gameId, socketId);
        if (!validationResult) return;

        const { gameState, player } = validationResult; // gameState and player are still useful for validation and context

        try {
            const chunkManager = this.gameStateService.getChunkManager(gameId);
            if (!chunkManager) {
                console.error(`ChunkManager not found for game ${gameId}`);
                this.gameUpdateService.sendError(socketId, 'Internal server error: Chunk manager not found.');
                return;
            }

            const { chunkCoordinate, localCoordinate } = chunkManager.convertGlobalToChunkLocalCoordinates(x, y);
            const targetChunk = await chunkManager.getChunk(chunkCoordinate.x, chunkCoordinate.y);

            const cellToReveal = targetChunk.getTile(localCoordinate.x, localCoordinate.y);

            console.log(`[DEBUG] Cell to reveal: ${JSON.stringify(cellToReveal)}`);
            if (!cellToReveal) {
                console.error(`Cell not found at local (${localCoordinate.x}, ${localCoordinate.y}) in chunk ${targetChunk.id}`);
                this.gameUpdateService.sendError(socketId, 'Internal server error: Cell data not found.');
                return;
            }

            if (cellToReveal.revealed) {
                console.log(`Cell (${x},${y}) is already revealed.`);
                return; 
            }

            if (cellToReveal.flagged) {
                console.log(`Cell (${x},${y}) is flagged. Cannot reveal.`);
                return; 
            }

            if (cellToReveal.isMine) {
                console.log(`Player ${socketId} hit a mine at (${x},${y}).`);
                player.status = PlayerStatus.LOCKED_OUT;
                player.lockedUntil = Date.now() + gameState.scoringConfig.lockoutDurationMs;
                this.scoreService.handleMineHit(gameId, socketId);

                cellToReveal.revealed = true;
                targetChunk.setTile(localCoordinate.x, localCoordinate.y, cellToReveal);

                this.gameUpdateService.sendPlayerStatusUpdate(
                    gameId,
                    socketId,
                    player.status,
                    player.lockedUntil
                );
                this.gameUpdateService.sendTileUpdate(
                    gameId,
                    {
                        x: cellToReveal.x,
                        y: cellToReveal.y,
                        revealed: true,
                        flagged: false,
                        isMine: true
                    }
                );
                return;
            }

            const { revealedCells, pendingFills } = await this.gameStateService.runGlobalFloodFill(gameId, x, y, socketId);

            console.log(`Player ${socketId} initiated reveal at (${x},${y}). Global flood fill revealed ${revealedCells.length} cells. Pending fills for chunks: ${Array.from(pendingFills).join(', ')}`);

            if (revealedCells.length > 0) {
                this.scoreService.handleCellReveal(gameId, socketId, revealedCells);
                const tilesUpdatePayload = revealedCells.map(cell => ({
                    x: cell.x,
                    y: cell.y,
                    revealed: cell.revealed,
                    flagged: cell.flagged,
                    adjacentMines: cell.adjacentMines
                }));
                this.gameUpdateService.sendTilesUpdate(gameId, tilesUpdatePayload);
            }
            // Optionally: handle pendingFills here (e.g., trigger chunk loading)

        } catch (error) {
            console.error('Error revealing cell with global method:', error);
            this.gameUpdateService.sendError(socketId, 'Failed to reveal tile.');
        }
    }

    private async handleFlagTile(payload: SocketEventMap['flagTile']) {
        console.log('[PlayerActionService] flagTile event:', payload);

        const { gameId, socketId, x, y } = payload;

        const validationResult = this.validateAction(gameId, socketId);
        if (!validationResult) return;

        const { gameState, player } = validationResult;

        // 5. Call toggleFlag from gridLogic
        try {
            const updatedCell = await gridLogic.toggleFlag(
                gameState,
                x,
                y,
                this.gameStateService.getCell
            );

            // 6. Handle result
            if (!updatedCell) {
                // No change occurred (already revealed cell or invalid coordinates)
                console.log(`No change occurred when flagging at (${x},${y})`);
                return;
            }

            // Persist the updated cell state (in-memory + MongoDB)
            this.gameStateService.updateGridCell(gameId, updatedCell);
            try {
                const chunkRepo = getChunkRepository();
                const chunkX = Math.floor(updatedCell.x / CHUNK_SIZE);
                const chunkY = Math.floor(updatedCell.y / CHUNK_SIZE);
                const localX = ((updatedCell.x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                const localY = ((updatedCell.y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                await chunkRepo.ensure(gameId, chunkX, chunkY);
                const playerIndex = await chunkRepo.getOrAddPlayerIndex(gameId, chunkX, chunkY, socketId);
                await chunkRepo.setFlagged(gameId, chunkX, chunkY, localX, localY, playerIndex, updatedCell.flagged);
            } catch (err) {
                console.error('[handleFlagTile] Failed to persist flag state:', err);
            }

            // Sync flag state to the ChunkManager in-memory tile so sendTileUpdate
            // broadcasts the updated flag value (sendTilesUpdate reads from the chunk cache).
            const chunkManager = this.gameStateService.getChunkManager(gameId);
            const flagChunkX = Math.floor(updatedCell.x / CHUNK_SIZE);
            const flagChunkY = Math.floor(updatedCell.y / CHUNK_SIZE);
            const flagLocalX = ((updatedCell.x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const flagLocalY = ((updatedCell.y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const flagChunk = chunkManager.getChunkById(`${flagChunkX}_${flagChunkY}`);
            if (flagChunk) {
                const tile = flagChunk.getTile(flagLocalX, flagLocalY);
                if (tile) flagChunk.setTile(flagLocalX, flagLocalY, { ...tile, flagged: updatedCell.flagged });
            }

            // Update score via ScoreService (handles score calculation and update notification)
            this.scoreService.handleFlagToggle(gameId, socketId, updatedCell.flagged);

            // Send tile update for the flagged/unflagged cell
            this.gameUpdateService.sendTileUpdate(
                gameId,
                {
                    x: updatedCell.x,
                    y: updatedCell.y,
                    revealed: updatedCell.revealed,
                    flagged: updatedCell.flagged,
                    // Include adjacentMines only if revealed
                    ...(updatedCell.revealed ? { adjacentMines: updatedCell.adjacentMines } : {})
                }
            );

            console.log(`Player ${socketId} ${updatedCell.flagged ? 'flagged' : 'unflagged'} cell at (${x},${y}).`);
        } catch (error) {
            console.error('Error flagging cell:', error);
            this.gameUpdateService.sendError(socketId, 'Failed to flag tile');
        }
    }

    private async handleChordClick(payload: SocketEventMap['chordClick']) {
        console.log('[PlayerActionService] chordClick event:', payload);

        const { gameId, socketId, x, y } = payload;

        const validationResult = this.validateAction(gameId, socketId);
        if (!validationResult) return;

        const { gameState, player } = validationResult;

        try {
            const chunkManager = this.gameStateService.getChunkManager(gameId);

            const { chunkCoordinate: cc, localCoordinate: lc } = chunkManager.convertGlobalToChunkLocalCoordinates(x, y);
            const centerChunk = await chunkManager.getChunk(cc.x, cc.y);
            const centerCell = centerChunk?.getTile(lc.x, lc.y);

            if (!centerCell || !centerCell.revealed || centerCell.adjacentMines === 0) {
                console.log(`Chord click at (${x},${y}): center cell not a valid chord target.`);
                return;
            }

            const DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const;
            let adjacentFlags = 0;
            const hiddenNeighbors: { x: number; y: number; isMine: boolean }[] = [];

            for (const [dx, dy] of DIRS) {
                const nx = x + dx;
                const ny = y + dy;
                const { chunkCoordinate: nc, localCoordinate: nl } = chunkManager.convertGlobalToChunkLocalCoordinates(nx, ny);
                const neighborChunk = await chunkManager.getChunk(nc.x, nc.y);
                const neighborCell = neighborChunk?.getTile(nl.x, nl.y);
                if (!neighborCell) continue;
                if (neighborCell.flagged && !neighborCell.revealed) {
                    adjacentFlags++;
                } else if (!neighborCell.revealed && !neighborCell.flagged) {
                    hiddenNeighbors.push({ x: nx, y: ny, isMine: neighborCell.isMine });
                }
            }

            if (adjacentFlags !== centerCell.adjacentMines) {
                console.log(`Chord click at (${x},${y}) did not reveal any cells.`);
                return;
            }

            // Check for mine hits first
            const hitMineNeighbor = hiddenNeighbors.find(n => n.isMine);
            if (hitMineNeighbor) {
                player.status = PlayerStatus.LOCKED_OUT;
                player.lockedUntil = Date.now() + gameState.scoringConfig.lockoutDurationMs;
                this.scoreService.handleMineHit(gameId, socketId, 'Hit Mine (Chord Click)');

                const { chunkCoordinate: mc, localCoordinate: ml } = chunkManager.convertGlobalToChunkLocalCoordinates(hitMineNeighbor.x, hitMineNeighbor.y);
                const mineChunk = await chunkManager.getChunk(mc.x, mc.y);
                const mineTile = mineChunk?.getTile(ml.x, ml.y);
                if (mineTile) {
                    const revealedMine = { ...mineTile, revealed: true, flagged: false };
                    mineChunk.setTile(ml.x, ml.y, revealedMine);
                    this.gameStateService.updateGridCell(gameId, revealedMine);
                }

                this.gameUpdateService.sendPlayerStatusUpdate(gameId, socketId, player.status, player.lockedUntil);
                this.gameUpdateService.sendTileUpdate(gameId, {
                    x: hitMineNeighbor.x,
                    y: hitMineNeighbor.y,
                    revealed: true,
                    flagged: false,
                    isMine: true,
                });
                console.log(`Player ${socketId} hit a mine during chord click at (${x},${y}).`);
                return;
            }

            // Reveal all hidden non-mine neighbors via flood fill
            const allRevealedCells: Cell[] = [];
            for (const neighbor of hiddenNeighbors) {
                const { revealedCells } = await this.gameStateService.runGlobalFloodFill(gameId, neighbor.x, neighbor.y, socketId);
                allRevealedCells.push(...revealedCells);
            }

            if (allRevealedCells.length > 0) {
                this.scoreService.handleCellReveal(gameId, socketId, allRevealedCells, 'Chord Click Reveal');
                this.gameUpdateService.sendTilesUpdate(gameId, allRevealedCells.map(cell => ({
                    x: cell.x,
                    y: cell.y,
                    revealed: cell.revealed,
                    flagged: cell.flagged,
                    adjacentMines: cell.adjacentMines,
                })));
            }

            console.log(`Player ${socketId} revealed ${allRevealedCells.length} cells via chord click at (${x},${y}).`);
        } catch (error) {
            console.error('Error performing chord click:', error);
            this.gameUpdateService.sendError(socketId, 'Failed to perform chord click');
        }
    }
}
