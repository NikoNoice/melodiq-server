import { Server, Socket } from 'socket.io';
import { gameManager } from '../services/GameManager';
import { ClientToServerEvents, ServerToClientEvents } from '../types';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function setupSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  io.on('connection', (socket: GameSocket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Create Lobby ───────────────────────────────────────
    socket.on('create_lobby', (data, callback) => {
      try {
        const { lobby, playerId } = gameManager.createLobby(socket.id, data.playerName, data.avatar);
        socket.join(lobby.code);
        callback({ success: true, lobby, playerId });
        console.log(`[Lobby] Created ${lobby.code} by ${data.playerName}`);
      } catch (err: any) {
        callback({ success: false, error: err.message });
      }
    });

    // ─── Join Lobby ─────────────────────────────────────────
    socket.on('join_lobby', (data, callback) => {
      try {
        const { lobby, playerId } = gameManager.joinLobby(data.code, socket.id, data.playerName, data.avatar);
        socket.join(lobby.code);
        callback({ success: true, lobby, playerId });

        // Notify others
        socket.to(lobby.code).emit('lobby_update', lobby);
        socket.to(lobby.code).emit('player_joined', lobby.players[playerId]);
        console.log(`[Lobby] ${data.playerName} joined ${lobby.code}`);
      } catch (err: any) {
        callback({ success: false, error: err.message });
      }
    });

    // ─── Update Settings ────────────────────────────────────
    socket.on('update_settings', (settings) => {
      const lobby = gameManager.updateSettings(socket.id, settings);
      if (lobby) {
        io.to(lobby.code).emit('lobby_update', lobby);
      }
    });

    // ─── Add Song ───────────────────────────────────────────
    socket.on('add_song', (songData, callback) => {
      const result = gameManager.addSong(socket.id, songData);
      if (result) {
        callback({ success: true, song: result.song });
        io.to(result.lobby.code).emit('lobby_update', result.lobby);
      } else {
        callback({ success: false, error: 'Failed to add song' });
      }
    });

    // ─── Add Songs Bulk (for playlists) ─────────────────────
    socket.on('add_songs_bulk', (songsData, callback) => {
      const result = gameManager.addSongsBulk(socket.id, songsData);
      if (result) {
        callback({ success: true, count: result.count });
        io.to(result.lobby.code).emit('lobby_update', result.lobby);
      } else {
        callback({ success: false, error: 'Failed to add songs' });
      }
    });

    // ─── Remove Song ────────────────────────────────────────
    socket.on('remove_song', (songId) => {
      const lobby = gameManager.removeSong(socket.id, songId);
      if (lobby) {
        io.to(lobby.code).emit('lobby_update', lobby);
      }
    });

    // ─── Toggle Ready ───────────────────────────────────────
    socket.on('toggle_ready', () => {
      const lobby = gameManager.toggleReady(socket.id);
      if (lobby) {
        io.to(lobby.code).emit('lobby_update', lobby);
      }
    });

    // ─── Start Game ─────────────────────────────────────────
    socket.on('start_game', () => {
      const lobby = gameManager.startGame(socket.id);
      if (!lobby) return;

      io.to(lobby.code).emit('game_start', lobby);

      // Start first round after a short delay
      setTimeout(() => {
        startNextRound(io, lobby.code);
      }, 3000);
    });

    // ─── Submit Guess ───────────────────────────────────────
    socket.on('submit_guess', (guess) => {
      const result = gameManager.submitGuess(socket.id, guess);
      if (!result) return;

      const lobby = gameManager.getLobbyBySocket(socket.id);
      if (!lobby) return;

      // Notify all players someone guessed
      io.to(lobby.code).emit('player_guessed', {
        playerId: result.playerId,
        correct: result.correct,
      });

      // If all players guessed, end round early
      if (result.allGuessed) {
        clearRoundTimer(lobby.code);
        endRound(io, lobby.code);
      }
    });

    // ─── Skip Round (host only) ─────────────────────────────
    socket.on('skip_round', () => {
      const lobby = gameManager.getLobbyBySocket(socket.id);
      const playerId = gameManager.getPlayerIdBySocket(socket.id);
      if (!lobby || !playerId || lobby.hostId !== playerId) return;

      clearRoundTimer(lobby.code);
      endRound(io, lobby.code);
    });

    // ─── Chat ───────────────────────────────────────────────
    socket.on('send_chat', (message) => {
      const lobby = gameManager.getLobbyBySocket(socket.id);
      const playerId = gameManager.getPlayerIdBySocket(socket.id);
      if (!lobby || !playerId) return;

      const player = lobby.players[playerId];
      if (!player) return;

      // Don't send the actual guess text during a round if the guess is close to the answer
      io.to(lobby.code).emit('chat_message', {
        playerId,
        playerName: player.name,
        message: message.slice(0, 200),
      });
    });

    // ─── Kick Player ────────────────────────────────────────
    socket.on('kick_player', (targetPlayerId) => {
      const result = gameManager.kickPlayer(socket.id, targetPlayerId);
      if (result) {
        io.to(result.lobby.code).emit('lobby_update', result.lobby);
        io.to(result.kickedSocketId).emit('error', 'You have been kicked from the lobby');
        const kickedSocket = io.sockets.sockets.get(result.kickedSocketId);
        if (kickedSocket) {
          kickedSocket.leave(result.lobby.code);
        }
      }
    });

    // ─── Leave Lobby ────────────────────────────────────────
    socket.on('leave_lobby', () => {
      handleDisconnect(socket, io);
    });

    // ─── Disconnect ─────────────────────────────────────────
    socket.on('disconnect', () => {
      handleDisconnect(socket, io);
      console.log(`[Socket] Disconnected: ${socket.id}`);
    });
  });
}

// ─── Round Timer Management ───────────────────────────────────
const roundTimers: Map<string, NodeJS.Timeout> = new Map();
const tickTimers: Map<string, NodeJS.Timeout> = new Map();

function clearRoundTimer(lobbyCode: string) {
  const timer = roundTimers.get(lobbyCode);
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(lobbyCode);
  }
  const tick = tickTimers.get(lobbyCode);
  if (tick) {
    clearInterval(tick);
    tickTimers.delete(lobbyCode);
  }
}

function startNextRound(io: Server<ClientToServerEvents, ServerToClientEvents>, lobbyCode: string) {
  const round = gameManager.startRound(lobbyCode);
  if (!round) {
    // Game over
    const results = gameManager.getGameResults(lobbyCode);
    if (results) {
      io.to(lobbyCode).emit('game_over', results);
      gameManager.resetLobby(lobbyCode);
    }
    return;
  }

  const lobby = [...(io.sockets.adapter.rooms.get(lobbyCode) || [])];
  if (lobby.length === 0) return;

  // Send round start (without revealing the answer)
  io.to(lobbyCode).emit('round_start', {
    roundNumber: round.roundNumber,
    totalRounds: round.song ? round.roundNumber : 0, // We get total from lobby
    snippetDuration: 5, // default
    timePerRound: 30, // default
    gridOptions: round.gridOptions,
    artistHint: undefined,
    song: {
      sourceId: round.song.sourceId,
      source: round.song.source,
      startTime: round.song.startTime,
      endTime: round.song.endTime,
      ...(round.song.previewUrl ? { previewUrl: round.song.previewUrl } : {}),
    } as any,
  });

  // Set up round timer
  let timeLeft = 30; // default

  const tickInterval = setInterval(() => {
    timeLeft--;
    io.to(lobbyCode).emit('round_tick', timeLeft);

    if (timeLeft <= 0) {
      clearInterval(tickInterval);
    }
  }, 1000);

  tickTimers.set(lobbyCode, tickInterval);

  const timer = setTimeout(() => {
    clearRoundTimer(lobbyCode);
    endRound(io, lobbyCode);
  }, 30 * 1000); // default time

  roundTimers.set(lobbyCode, timer);
}

function endRound(io: Server<ClientToServerEvents, ServerToClientEvents>, lobbyCode: string) {
  const result = gameManager.endRound(lobbyCode);
  if (!result) return;

  io.to(lobbyCode).emit('round_end', {
    song: result.song,
    scores: result.scores,
    guesses: result.guesses,
  });

  if (result.isGameOver) {
    const results = gameManager.getGameResults(lobbyCode);
    if (results) {
      setTimeout(() => {
        io.to(lobbyCode).emit('game_over', results);
        gameManager.resetLobby(lobbyCode);
      }, 5000);
    }
  } else {
    // Start next round after reveal
    setTimeout(() => {
      startNextRound(io, lobbyCode);
    }, 6000);
  }
}

function handleDisconnect(socket: GameSocket, io: Server<ClientToServerEvents, ServerToClientEvents>) {
  const result = gameManager.leaveLobby(socket.id);
  if (result && result.lobby) {
    socket.to(result.lobby.code).emit('player_left', result.playerId);
    socket.to(result.lobby.code).emit('lobby_update', result.lobby);
    socket.leave(result.lobby.code);
  }
}
