const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: true,   // reflect request origin dynamically
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  allowUpgrades: false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Store active games and players
const games = new Map();
const players = new Map();
const waitingPlayers = [];

// Game states
const GAME_STATE = {
  WAITING: 'waiting',
  COUNTDOWN: 'countdown',
  ACTIVE: 'active',
  FINISHED: 'finished'
};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  players.set(socket.id, {
    id: socket.id,
    username: null,
    gameId: null,
    health: 100,
    x: 0, y: 1.7, z: 0,
    yaw: 0, pitch: 0
  });

  // Player joins queue
  socket.on('join_queue', (username) => {
    const player = players.get(socket.id);
    player.username = username;
    
    waitingPlayers.push(socket.id);
    console.log(`${username} joined queue`);
    
    // Check if we can start a game
    if (waitingPlayers.length >= 2) {
      startNewGame();
    }
  });

  // Handle player movement (3D)
  socket.on('player_move', (data) => {
    const player = players.get(socket.id);
    if (player && player.gameId) {
      player.x = data.x;
      player.y = data.y;
      player.z = data.z;
      player.yaw = data.yaw;
      player.pitch = data.pitch;

      const game = games.get(player.gameId);
      if (game) {
        const opponent = game.players.find(p => p !== socket.id);
        io.to(opponent).emit('opponent_move', {
          x: data.x,
          y: data.y,
          z: data.z,
          yaw: data.yaw,
          pitch: data.pitch,
          isSquatting: data.isSquatting,
          verticalVelocity: data.verticalVelocity
        });
      }
    }
  });

  // Handle shooting (3D)
  socket.on('shoot', (data) => {
    const player = players.get(socket.id);
    if (player && player.gameId) {
      const game = games.get(player.gameId);
      if (game) {
        const opponent = game.players.find(p => p !== socket.id);
        io.to(opponent).emit('opponent_shot', {
          x: data.x,
          y: data.y,
          z: data.z,
          yaw: data.yaw,
          pitch: data.pitch
        });
      }
    }
  });

  // Handle hit confirmation
  socket.on('hit', (data) => {
    const player = players.get(socket.id);
    if (player && player.gameId) {
      const game = games.get(player.gameId);
      if (game) {
        const opponent = game.players.find(p => p !== socket.id);
        const opponentPlayer = players.get(opponent);
        
        // Reduce opponent health
        opponentPlayer.health -= data.damage;
        
        // Send updated health to opponent
        io.to(opponent).emit('take_damage', {
          damage: data.damage,
          health: Math.max(0, opponentPlayer.health)
        });
        
        // Check if game is over
        if (opponentPlayer.health <= 0) {
          endGame(player.gameId, socket.id);
        }
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    const player = players.get(socket.id);
    if (player && player.gameId) {
      // End the game if player disconnects
      endGame(player.gameId, null);
    }
    
    // Remove from waiting queue
    const index = waitingPlayers.indexOf(socket.id);
    if (index > -1) {
      waitingPlayers.splice(index, 1);
    }
    
    players.delete(socket.id);
  });
});

function startNewGame() {
  const player1Id = waitingPlayers.shift();
  const player2Id = waitingPlayers.shift();
  
  const gameId = `game_${Date.now()}`;
  
  const game = {
    id: gameId,
    players: [player1Id, player2Id],
    state: GAME_STATE.COUNTDOWN,
    wins: { [player1Id]: 0, [player2Id]: 0 },
    createdAt: Date.now()
  };
  
  games.set(gameId, game);
  
  // Update player data
  players.get(player1Id).gameId = gameId;
  players.get(player2Id).gameId = gameId;
  
  // Reset health
  players.get(player1Id).health = 100;
  players.get(player2Id).health = 100;
  
  console.log(`Game started: ${gameId}`);
  
  // Notify both players
  io.to(player1Id).emit('game_start', {
    gameId: gameId,
    opponent: players.get(player2Id).username,
    you: 'player1',
    yourWins: 0,
    opponentWins: 0
  });
  
  io.to(player2Id).emit('game_start', {
    gameId: gameId,
    opponent: players.get(player1Id).username,
    you: 'player2',
    yourWins: 0,
    opponentWins: 0
  });
}

function endGame(gameId, winnerId) {
  const game = games.get(gameId);
  if (!game) return;

  const player1Id = game.players[0];
  const player2Id = game.players[1];

  // Increment winner's round wins
  if (winnerId) {
    game.wins[winnerId] = (game.wins[winnerId] || 0) + 1;
  }

  const p1wins = game.wins[player1Id] || 0;
  const p2wins = game.wins[player2Id] || 0;
  const seriesOver = p1wins >= 3 || p2wins >= 3 || !winnerId;

  const winner = winnerId ? players.get(winnerId) : null;
  console.log(`Round ended: ${gameId}, Winner: ${winner?.username || 'none'}, Score: ${p1wins}-${p2wins}`);

  // Notify each player from their own perspective
  io.to(player1Id).emit('round_end', {
    winner: winner?.username || null,
    yourWins: p1wins,
    opponentWins: p2wins,
    seriesOver
  });

  io.to(player2Id).emit('round_end', {
    winner: winner?.username || null,
    yourWins: p2wins,
    opponentWins: p1wins,
    seriesOver
  });

  if (seriesOver) {
    games.delete(gameId);
    if (players.get(player1Id)) players.get(player1Id).gameId = null;
    if (players.get(player2Id)) players.get(player2Id).gameId = null;
  } else {
    // Reset health and start next round after 3 seconds
    if (players.get(player1Id)) players.get(player1Id).health = 100;
    if (players.get(player2Id)) players.get(player2Id).health = 100;

    setTimeout(() => {
      if (!games.has(gameId)) return;
      const p1 = players.get(player1Id);
      const p2 = players.get(player2Id);
      if (!p1 || !p2) return;

      io.to(player1Id).emit('game_start', {
        gameId,
        opponent: p2.username,
        you: 'player1',
        yourWins: p1wins,
        opponentWins: p2wins
      });

      io.to(player2Id).emit('game_start', {
        gameId,
        opponent: p1.username,
        you: 'player2',
        yourWins: p2wins,
        opponentWins: p1wins
      });
    }, 3000);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`Server running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
});
