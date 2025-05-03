#!/usr/bin/env python3
"""
Bots Runner: Launches many concurrent bot players to stress-test the Mines backend via Socket.IO.
"""
import asyncio
import socketio
import random
import string
import time
from typing import Optional, Any, Dict, List, Tuple

BACKEND_URL = 'http://localhost:3001'  # Use Docker Compose service name
NUM_BOTS = 1 # Change to desired concurrency

class BotPlayer:
    def __init__(self, bot_id: int):
        self.bot_id: int = bot_id
        self.sio: socketio.AsyncClient = socketio.AsyncClient()
        self.game_id: Optional[str] = None
        self.player_id: Optional[str] = None
        self.username: str = f'Bot_{bot_id}'
        self.connected: bool = False
        self.game_over: bool = False

    async def connect(self) -> None:
        try:
            await self.sio.connect(BACKEND_URL)
            print(f"Bot {self.bot_id}: Connected to {BACKEND_URL}")
            self.connected = True
            self.sio.on('gameState', self.on_game_state)
            self.sio.on('gameOver', self.on_game_over)
            self.sio.on('gameCreated', self.on_game_created)
            self.sio.on('gameJoined', self.on_game_joined)
            await self.create_and_join_game()
            await self.sio.wait()  # Keeps the connection and event loop open for callbacks
        except Exception as e:
            print(f"Bot {self.bot_id}: Connection failed: {e}")
        finally:
            print(f"Bot {self.bot_id}: Disconnecting...")

    async def create_and_join_game(self) -> None:
        self.game_id = f"testgame_{self.bot_id}_{int(time.time())}"
        config: Dict[str, Any] = {'username': self.username}
        print(f"Bot {self.bot_id}: Creating game with ID: {self.game_id}")
        await self.sio.emit('createGame', config)
        print(f"Bot {self.bot_id}: Disconnecting...")

    async def on_game_created(self, response: Dict[str, Any]) -> None:
        print(f"Bot {self.bot_id}: Game created: {response}")
        if response:
            self.game_id = response['gameId']
            print(f"Bot {self.bot_id}: Successfully joined game with ID: {self.game_id}")
            await self.sio.emit('joinGame', {'gameId': self.game_id, 'username': self.username})
        else:
            print(f"Bot {self.bot_id}: Failed to create game: {response}")

    async def on_game_joined(self, response: Dict[str, Any]) -> None:
        if response:
            self.player_id = response['playerId']
            await self.play_game()
        else:
            print(f"Bot {self.bot_id}: Failed to join game: {response}")

    async def on_game_state(self, data: Dict[str, Any]) -> None:
        if not self.game_over:
            await self.make_random_move(data)

    async def on_game_over(self, data: Dict[str, Any]) -> None:
        self.game_over = True
        print(f"Bot {self.bot_id}: Game over. Data: {data}")
        await self.sio.disconnect()

    async def play_game(self) -> None:
        print(f"Bot {self.bot_id}: Playing game with ID: {self.game_id}")
        for i in range(10):  # Play for a limited number of moves
            await self.sio.emit('revealTile', {'gameId': self.game_id, 'playerId': self.username, 'x': random.randint(0, 7), 'y': random.randint(0, 7)})
        # await self.sio.disconnect()

    async def make_random_move(self, game_state: Dict[str, Any]) -> None:
        board = game_state.get('boardState')
        config = game_state.get('boardConfig')
        if not board or not config:
            return
        rows: int = config.get('rows', 8)
        cols: int = config.get('cols', 8)
        unrevealed: List[Tuple[int, int]] = [(r, c) for r in range(rows) for c in range(cols)
                      if not board[r][c].get('revealed', False)]
        if unrevealed:
            row, col = random.choice(unrevealed)
            await self.sio.emit('reveal_tile', {'position': {'x': col, 'y': row}})

async def main() -> None:
    bots: List[BotPlayer] = [BotPlayer(i) for i in range(NUM_BOTS)]
    await asyncio.gather(*(bot.connect() for bot in bots))

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Main runner exception: {e}")
