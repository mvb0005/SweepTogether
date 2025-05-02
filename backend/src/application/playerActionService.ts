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
import { PlayerStatus, Cell, GameState, Player } from '../domain/types';
import * as gridLogic from '../domain/gridLogic';

export class PlayerActionService {
    constructor(
        private eventBus: EventBus<SocketEventMap>,
        private gameStateService: GameStateService,
        private gameUpdateService: GameUpdateService
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

        const { gameState, player } = validationResult;

        // 5. Call revealCell from gridLogic
        try {
            const result = await gridLogic.revealCell(
                gameState,
                x,
                y,
                this.gameStateService.getCell
            );

            // 6. Handle result
            if ('hitMine' in result) {
                // Mine hit case
                const { hitMine } = result;

                // Update player status to LOCKED_OUT
                player.status = PlayerStatus.LOCKED_OUT;
                player.lockedUntil = Date.now() + gameState.scoringConfig.lockoutDurationMs;

                // Calculate score deduction
                const scoreDelta = -gameState.scoringConfig.mineHitPenalty;
                player.score += scoreDelta;

                // Persist the revealed mine state
                this.gameStateService.updateGridCell(gameId, hitMine);

                // Send updates to clients
                // 1. Player status update
                this.gameUpdateService.sendPlayerStatusUpdate(
                    gameId,
                    socketId,
                    player.status,
                    player.lockedUntil
                );

                // 2. Score update
                this.gameUpdateService.sendScoreUpdate(
                    gameId,
                    socketId,
                    player.score,
                    scoreDelta,
                    'Hit Mine'
                );

                // 3. Tile update for the revealed mine
                this.gameUpdateService.sendTileUpdate(
                    gameId,
                    {
                        x: hitMine.x,
                        y: hitMine.y,
                        revealed: true,
                        flagged: false,
                        isMine: true
                    }
                );

                console.log(`Player ${socketId} hit a mine at (${x},${y}).`);
            } else {
                // Successful reveal case (array of cells)
                const revealedCells: Cell[] = result;

                if (revealedCells.length === 0) {
                    // Nothing to reveal (already revealed/flagged)
                    return;
                }

                // Calculate score increase (only for non-mine cells)
                const scoreDelta = revealedCells.length * gameState.scoringConfig.numberRevealPoints;
                player.score += scoreDelta;

                // Persist the state changes for all revealed cells
                this.gameStateService.updateGridCells(gameId, revealedCells);

                // Send updates to clients
                // 1. Score update
                this.gameUpdateService.sendScoreUpdate(
                    gameId,
                    socketId,
                    player.score,
                    scoreDelta,
                    'Reveal Cells'
                );

                // 2. Tiles update for all revealed cells
                const tilesUpdatePayload = revealedCells.map(cell => ({
                    x: cell.x,
                    y: cell.y,
                    revealed: cell.revealed,
                    flagged: cell.flagged,
                    adjacentMines: cell.adjacentMines
                }));

                this.gameUpdateService.sendTilesUpdate(gameId, tilesUpdatePayload);

                console.log(`Player ${socketId} revealed ${revealedCells.length} cells.`);
            }
        } catch (error) {
            console.error('Error revealing cell:', error);
            this.gameUpdateService.sendError(socketId, 'Failed to reveal tile');
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

            // Persist the updated cell state
            this.gameStateService.updateGridCell(gameId, updatedCell);

            // Calculate score change based on flag action
            let scoreDelta = 0;
            let reason = '';

            if (updatedCell.flagged) {
                // Added a flag
                scoreDelta = gameState.scoringConfig.flagPlacePoints;
                reason = 'Place Flag';
            } else {
                // Removed a flag
                scoreDelta = gameState.scoringConfig.flagRemovePoints;
                reason = 'Remove Flag';
            }

            // Update player score
            player.score += scoreDelta;

            // Send updates to clients

            // 1. Score update
            this.gameUpdateService.sendScoreUpdate(
                gameId,
                socketId,
                player.score,
                scoreDelta,
                reason
            );

            // 2. Tile update for the flagged/unflagged cell
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

        // Call chordClick from gridLogic
        try {
            const result = await gridLogic.chordClick(
                gameState,
                x,
                y,
                this.gameStateService.getCell
            );

            // Handle result
            if ('hitMine' in result) {
                // Mine hit case
                const { hitMine } = result;

                // Update player status to LOCKED_OUT
                player.status = PlayerStatus.LOCKED_OUT;
                player.lockedUntil = Date.now() + gameState.scoringConfig.lockoutDurationMs;

                // Calculate score deduction
                const scoreDelta = -gameState.scoringConfig.mineHitPenalty;
                player.score += scoreDelta;

                // Persist the revealed mine state
                this.gameStateService.updateGridCell(gameId, hitMine);

                // Send updates to clients
                // 1. Player status update
                this.gameUpdateService.sendPlayerStatusUpdate(
                    gameId,
                    socketId,
                    player.status,
                    player.lockedUntil
                );

                // 2. Score update
                this.gameUpdateService.sendScoreUpdate(
                    gameId,
                    socketId,
                    player.score,
                    scoreDelta,
                    'Hit Mine (Chord Click)'
                );

                // 3. Tile update for the revealed mine
                this.gameUpdateService.sendTileUpdate(
                    gameId,
                    {
                        x: hitMine.x,
                        y: hitMine.y,
                        revealed: true,
                        flagged: false,
                        isMine: true
                    }
                );

                console.log(`Player ${socketId} hit a mine during chord click at (${x},${y}).`);
            } else {
                // Successful reveal case (array of cells)
                const revealedCells: Cell[] = result;

                if (revealedCells.length === 0) {
                    // Nothing to reveal (already revealed/flagged or insufficient flags around number)
                    console.log(`Chord click at (${x},${y}) did not reveal any cells.`);
                    return;
                }

                // Calculate score increase (only for non-mine cells)
                const scoreDelta = revealedCells.length * gameState.scoringConfig.numberRevealPoints;
                player.score += scoreDelta;

                // Persist the state changes for all revealed cells
                this.gameStateService.updateGridCells(gameId, revealedCells);

                // Send updates to clients
                // 1. Score update
                this.gameUpdateService.sendScoreUpdate(
                    gameId,
                    socketId,
                    player.score,
                    scoreDelta,
                    'Chord Click Reveal'
                );

                // 2. Tiles update for all revealed cells
                const tilesUpdatePayload = revealedCells.map(cell => ({
                    x: cell.x,
                    y: cell.y,
                    revealed: cell.revealed,
                    flagged: cell.flagged,
                    adjacentMines: cell.adjacentMines
                }));

                this.gameUpdateService.sendTilesUpdate(gameId, tilesUpdatePayload);

                console.log(`Player ${socketId} revealed ${revealedCells.length} cells via chord click at (${x},${y}).`);
            }
        } catch (error) {
            console.error('Error performing chord click:', error);
            this.gameUpdateService.sendError(socketId, 'Failed to perform chord click');
        }
    }
}
