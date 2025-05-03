// import { Express, Request, Response } from 'express';
// import { LeaderboardCategory, LeaderboardMetric } from '../../domain/types';

// // Always get services at the top for all controllers

// /**
//  * Sets up API routes for the Express application
//  */
// export function setupRoutes(app: Express): void {

//   // Game routes
//   // app.get('/api/games/:gameId', getGame);
//   app.post('/api/games', createGame);
//   app.get('/api/games/:gameId/board', getGameBoard);
//   app.get('/api/games/:gameId/players', getGamePlayers);
  
//   // Score routes
//   app.get('/api/games/:gameId/scores', getGameScores);
//   // app.get('/api/games/:gameId/players/:playerId/score', getPlayerScore);
  
//   // Leaderboard routes
//   app.get('/api/leaderboard/:category/:metric', getLeaderboard);
  
//   // Statistics routes
//   app.get('/api/stats/active-games', getActiveGamesCount);
//   app.get('/api/stats/active-players', getActivePlayersCount);
// }

// // Game controllers
// // function getGame(req: Request, res: Response): void {
// //   try {
// //     const { gameId } = req.params;
// //     const game = gameStateService.getGame(gameId);
// //     if (!game) {
// //       res.status(404).json({ error: 'Game not found' });
// //       return;
// //     }
// //     res.status(200).json({
// //       gameId: game.gameId,
// //       config: game.boardConfig,
// //       status: game.status,
// //       createdAt: game.createdAt,
// //       playerCount: Object.keys(game.players).length
// //     });
// //   } catch (error) {
// //     console.error('Error fetching game:', error);
// //     res.status(500).json({ error: 'Internal server error' });
// //   }
// // }

// function createGame(req: Request, res: Response): void {
//   try {
//     const { rows, cols, mines, isInfiniteWorld = false } = req.body;
//     if (!rows || !cols || !mines) {
//       res.status(400).json({ error: 'Missing required game parameters' });
//       return;
//     }
//     const gameId = "game_" + Date.now(); // Simple game ID generation
//     gameStateService.createGame(gameId, { rows, cols, mines, isInfiniteWorld });
//     res.status(201).json({
//       gameId,
//       config: { rows, cols, mines, isInfiniteWorld }
//     });
//   } catch (error) {
//     console.error('Error creating game:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// function getGameBoard(req: Request, res: Response): void {
//   try {
//     const { gameId } = req.params;
//     const game = gameStateService.getGame(gameId);
//     if (!game) {
//       res.status(404).json({ error: 'Game not found' });
//       return;
//     }
//     // TODO: Implement getVisibleCells or similar logic
//     res.status(200).json({ cells: [] });
//   } catch (error) {
//     console.error('Error fetching game board:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// function getGamePlayers(req: Request, res: Response): void {
//   try {
//     const { gameId } = req.params;
//     const game = gameStateService.getGame(gameId);
//     if (!game) {
//       res.status(404).json({ error: 'Game not found' });
//       return;
//     }
//     const players = Object.values(game.players).map(player => ({
//       id: player.id,
//       username: player.username,
//       status: player.status,
//       joinedAt: player.lockedUntil
//     }));
//     res.status(200).json({ players });
//   } catch (error) {
//     console.error('Error fetching game players:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// // Score controllers
// function getGameScores(req: Request, res: Response): void {
//   try {
//     const { gameId } = req.params;
//     const leaderboard = leaderboardService.getLeaderboard(
//       LeaderboardCategory.ALL_TIME,
//       LeaderboardMetric.HIGHEST_SCORE,
//       10,
//     )
//     if (!leaderboard) {
//       res.status(404).json({ error: 'Game not found or no scores available' });
//       return;
//     }
//     res.status(200).json({ leaderboard });
//   } catch (error) {
//     console.error('Error fetching game scores:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// // function getPlayerScore(req: Request, res: Response): void {
// //   try {
// //     const { gameId, playerId } = req.params;
// //     const score = scoreService.getPlayerScore(gameId, playerId);
// //     if (score === null) {
// //       res.status(404).json({ error: 'Game or player not found' });
// //       return;
// //     }
// //     res.status(200).json({ score });
// //   } catch (error) {
// //     console.error('Error fetching player score:', error);
// //     res.status(500).json({ error: 'Internal server error' });
// //   }
// // }

// // Leaderboard controllers
// function getLeaderboard(req: Request, res: Response): void {
//   try {
//     const { category, metric } = req.params;
//     const { limit = 10 } = req.query;
//     if (!Object.values(LeaderboardCategory).includes(category as LeaderboardCategory) || 
//         !Object.values(LeaderboardMetric).includes(metric as LeaderboardMetric)) {
//       res.status(400).json({ error: 'Invalid leaderboard category or metric' });
//       return;
//     }
//     leaderboardService.getLeaderboard(
//       category as LeaderboardCategory,
//       metric as LeaderboardMetric,
//       Number(limit)
//     )
//       .then(leaderboard => {
//         res.status(200).json(leaderboard);
//       })
//       .catch(error => {
//         console.error('Error fetching leaderboard:', error);
//         res.status(500).json({ error: 'Internal server error' });
//       });
//   } catch (error) {
//     console.error('Error fetching leaderboard:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// // Statistics controllers
// function getActiveGamesCount(req: Request, res: Response): void {
//   try {
//     const count = gameStateService.getAllGameIds().length;
//     res.status(200).json({ count });
//   } catch (error) {
//     console.error('Error fetching active games count:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }

// function getActivePlayersCount(req: Request, res: Response): void {
//   try {
//     // TODO: Implement logic to count active players
//     res.status(200).json({ count: 0 });
//   } catch (error) {
//     console.error('Error fetching active players count:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// }