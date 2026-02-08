import { nanoid } from 'nanoid';
import {
  Lobby, Player, Song, GameSettings, RoundState, Avatar,
  DEFAULT_SETTINGS, LobbyState,
} from '../types';

class GameManager {
  private lobbies: Map<string, Lobby> = new Map();
  private playerToLobby: Map<string, string> = new Map(); // socketId -> lobbyCode
  private playerIds: Map<string, string> = new Map(); // socketId -> playerId

  generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // Make sure code is unique
    if (this.lobbies.has(code)) return this.generateCode();
    return code;
  }

  createLobby(socketId: string, playerName: string, avatar: Avatar): { lobby: Lobby; playerId: string } {
    const code = this.generateCode();
    const playerId = nanoid(12);

    const player: Player = {
      id: playerId,
      socketId,
      name: playerName,
      avatar,
      score: 0,
      streak: 0,
      isHost: true,
      isReady: true,
      hasGuessed: false,
      lastGuessCorrect: false,
      roundScore: 0,
    };

    const lobby: Lobby = {
      code,
      hostId: playerId,
      state: 'waiting',
      players: { [playerId]: player },
      settings: { ...DEFAULT_SETTINGS },
      songs: [],
      currentRound: null,
      roundHistory: [],
      createdAt: Date.now(),
    };

    this.lobbies.set(code, lobby);
    this.playerToLobby.set(socketId, code);
    this.playerIds.set(socketId, playerId);

    return { lobby, playerId };
  }

  joinLobby(code: string, socketId: string, playerName: string, avatar: Avatar): { lobby: Lobby; playerId: string } {
    const lobby = this.lobbies.get(code.toUpperCase());
    if (!lobby) throw new Error('Lobby not found');
    if (lobby.state !== 'waiting') throw new Error('Game already in progress');
    if (Object.keys(lobby.players).length >= lobby.settings.maxPlayers) throw new Error('Lobby is full');

    const playerId = nanoid(12);
    const player: Player = {
      id: playerId,
      socketId,
      name: playerName,
      avatar,
      score: 0,
      streak: 0,
      isHost: false,
      isReady: false,
      hasGuessed: false,
      lastGuessCorrect: false,
      roundScore: 0,
    };

    lobby.players[playerId] = player;
    this.playerToLobby.set(socketId, code.toUpperCase());
    this.playerIds.set(socketId, playerId);

    return { lobby, playerId };
  }

  leaveLobby(socketId: string): { lobby: Lobby | null; playerId: string; wasHost: boolean } | null {
    const code = this.playerToLobby.get(socketId);
    const playerId = this.playerIds.get(socketId);
    if (!code || !playerId) return null;

    const lobby = this.lobbies.get(code);
    if (!lobby) return null;

    const wasHost = lobby.players[playerId]?.isHost || false;
    delete lobby.players[playerId];
    this.playerToLobby.delete(socketId);
    this.playerIds.delete(socketId);

    // If lobby is empty, delete it
    if (Object.keys(lobby.players).length === 0) {
      this.lobbies.delete(code);
      return { lobby: null, playerId, wasHost };
    }

    // Transfer host if needed
    if (wasHost) {
      const newHostId = Object.keys(lobby.players)[0];
      lobby.players[newHostId].isHost = true;
      lobby.hostId = newHostId;
    }

    return { lobby, playerId, wasHost };
  }

  getLobbyBySocket(socketId: string): Lobby | null {
    const code = this.playerToLobby.get(socketId);
    if (!code) return null;
    return this.lobbies.get(code) || null;
  }

  getPlayerIdBySocket(socketId: string): string | null {
    return this.playerIds.get(socketId) || null;
  }

  updateSettings(socketId: string, settings: Partial<GameSettings>): Lobby | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    lobby.settings = { ...lobby.settings, ...settings };
    return lobby;
  }

  addSong(socketId: string, songData: Omit<Song, 'id'>): { lobby: Lobby; song: Song } | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    const song: Song = { ...songData, id: nanoid(10) };
    lobby.songs.push(song);
    return { lobby, song };
  }

  addSongsBulk(socketId: string, songsData: Omit<Song, 'id'>[]): { lobby: Lobby; count: number } | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    const songs: Song[] = songsData.map(s => ({ ...s, id: nanoid(10) }));
    lobby.songs.push(...songs);
    return { lobby, count: songs.length };
  }

  removeSong(socketId: string, songId: string): Lobby | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    lobby.songs = lobby.songs.filter(s => s.id !== songId);
    return lobby;
  }

  toggleReady(socketId: string): Lobby | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;

    lobby.players[playerId].isReady = !lobby.players[playerId].isReady;
    return lobby;
  }

  canStartGame(lobby: Lobby): { can: boolean; reason?: string } {
    const players = Object.values(lobby.players);
    if (players.length < 1) return { can: false, reason: 'Need at least 1 player' };
    if (lobby.songs.length < 3) return { can: false, reason: 'Need at least 3 songs' };
    const notReady = players.filter(p => !p.isReady && !p.isHost);
    if (notReady.length > 0) return { can: false, reason: 'Not all players are ready' };
    return { can: true };
  }

  startGame(socketId: string): Lobby | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    const check = this.canStartGame(lobby);
    if (!check.can) return null;

    // Reset scores
    Object.values(lobby.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.hasGuessed = false;
      p.lastGuessCorrect = false;
      p.roundScore = 0;
    });

    lobby.state = 'playing';
    lobby.roundHistory = [];
    lobby.currentRound = null;

    // Adjust rounds to song count if needed
    lobby.settings.rounds = Math.min(lobby.settings.rounds, lobby.songs.length);

    return lobby;
  }

  startRound(lobbyCode: string): RoundState | null {
    const lobby = this.lobbies.get(lobbyCode);
    if (!lobby || lobby.state !== 'playing') return null;

    const roundNumber = lobby.roundHistory.length + 1;
    if (roundNumber > lobby.settings.rounds) return null;

    // Pick a random song that hasn't been used
    const usedSongIds = new Set(lobby.roundHistory.map(r => r.song.id));
    const availableSongs = lobby.songs.filter(s => !usedSongIds.has(s.id));
    if (availableSongs.length === 0) return null;

    const song = availableSongs[Math.floor(Math.random() * availableSongs.length)];

    // Reset player guess state
    Object.values(lobby.players).forEach(p => {
      p.hasGuessed = false;
      p.lastGuessCorrect = false;
      p.roundScore = 0;
    });

    // Generate grid options if needed
    let gridOptions: string[] | undefined;
    if (lobby.settings.guessStyle === 'grid' || lobby.settings.guessStyle === 'multiple_choice') {
      const otherSongs = lobby.songs.filter(s => s.id !== song.id);
      const shuffled = otherSongs.sort(() => Math.random() - 0.5);
      const decoys = shuffled.slice(0, lobby.settings.guessStyle === 'grid' ? 8 : 3);
      gridOptions = [...decoys.map(s => s.title), song.title].sort(() => Math.random() - 0.5);
    }

    const round: RoundState = {
      roundNumber,
      song,
      startedAt: Date.now(),
      phase: 'playing',
      guesses: {},
      gridOptions,
    };

    lobby.currentRound = round;
    return round;
  }

  submitGuess(socketId: string, guess: string): {
    correct: boolean;
    score: number;
    playerId: string;
    allGuessed: boolean;
  } | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId || !lobby.currentRound) return null;
    if (lobby.players[playerId].hasGuessed) return null;

    const round = lobby.currentRound;
    const timeElapsed = (Date.now() - round.startedAt) / 1000;
    const correct = this.checkGuess(guess, round.song);

    // Calculate score
    let score = 0;
    if (correct) {
      const baseScore = 1000;
      const timeBonus = lobby.settings.scoreMultiplierSpeed
        ? Math.max(0, Math.floor((1 - timeElapsed / lobby.settings.timePerRound) * 500))
        : 0;
      const streakBonus = lobby.players[playerId].streak * 100;
      score = baseScore + timeBonus + streakBonus;

      lobby.players[playerId].streak++;
      lobby.players[playerId].score += score;
    } else {
      lobby.players[playerId].streak = 0;
    }

    lobby.players[playerId].hasGuessed = true;
    lobby.players[playerId].lastGuessCorrect = correct;
    lobby.players[playerId].roundScore = score;

    round.guesses[playerId] = { guess, correct, time: timeElapsed, score };

    const allGuessed = Object.values(lobby.players).every(p => p.hasGuessed);

    return { correct, score, playerId, allGuessed };
  }

  private checkGuess(guess: string, song: Song): boolean {
    const normalize = (s: string) => s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedGuess = normalize(guess);
    const normalizedTitle = normalize(song.title);
    const normalizedArtist = normalize(song.artist);

    // Exact match on full title
    if (normalizedGuess === normalizedTitle) return true;

    // Split title on common separators like " - ", " by ", etc.
    // e.g. "Blinding Lights - The Weeknd" => ["blinding lights", "the weeknd"]
    const titleParts = song.title
      .split(/\s*[-–—|]\s*/)
      .map(normalize)
      .filter(p => p.length > 0);

    // Check if guess matches any individual part (song name OR artist in title)
    for (const part of titleParts) {
      if (part.length < 2) continue;
      // Exact match on part
      if (normalizedGuess === part) return true;
      // Fuzzy match on part (allow small typos)
      const dist = this.levenshteinDistance(normalizedGuess, part);
      const threshold = Math.max(1, Math.floor(part.length * 0.25));
      if (dist <= threshold) return true;
    }

    // Check against artist name directly
    if (normalizedGuess === normalizedArtist) return true;
    const artistDist = this.levenshteinDistance(normalizedGuess, normalizedArtist);
    if (artistDist <= Math.max(1, Math.floor(normalizedArtist.length * 0.25))) return true;

    // Fuzzy match on full title (allow for typos)
    const distance = this.levenshteinDistance(normalizedGuess, normalizedTitle);
    const threshold = Math.max(1, Math.floor(normalizedTitle.length * 0.25));
    if (distance <= threshold) return true;

    // Check if guess is a substantial substring of title or any part
    if (normalizedTitle.includes(normalizedGuess) && normalizedGuess.length >= 3) return true;
    if (normalizedGuess.includes(normalizedTitle)) return true;

    return false;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  endRound(lobbyCode: string): {
    song: Song;
    scores: Record<string, number>;
    guesses: Record<string, { guess: string; correct: boolean; score: number }>;
    isGameOver: boolean;
  } | null {
    const lobby = this.lobbies.get(lobbyCode);
    if (!lobby || !lobby.currentRound) return null;

    const round = lobby.currentRound;
    round.phase = 'reveal';
    lobby.roundHistory.push(round);

    const scores: Record<string, number> = {};
    Object.values(lobby.players).forEach(p => {
      scores[p.id] = p.score;
    });

    const isGameOver = lobby.roundHistory.length >= lobby.settings.rounds;
    if (isGameOver) {
      lobby.state = 'game_over';
    }

    lobby.currentRound = null;

    return {
      song: round.song,
      scores,
      guesses: round.guesses,
      isGameOver,
    };
  }

  getGameResults(lobbyCode: string): { players: Player[]; mvp: Player } | null {
    const lobby = this.lobbies.get(lobbyCode);
    if (!lobby) return null;

    const players = Object.values(lobby.players).sort((a, b) => b.score - a.score);
    const mvp = players[0];

    return { players, mvp };
  }

  resetLobby(lobbyCode: string): Lobby | null {
    const lobby = this.lobbies.get(lobbyCode);
    if (!lobby) return null;

    lobby.state = 'waiting';
    lobby.currentRound = null;
    lobby.roundHistory = [];
    Object.values(lobby.players).forEach(p => {
      p.score = 0;
      p.streak = 0;
      p.isReady = p.isHost;
      p.hasGuessed = false;
      p.lastGuessCorrect = false;
      p.roundScore = 0;
    });

    return lobby;
  }

  kickPlayer(socketId: string, targetPlayerId: string): { lobby: Lobby; kickedSocketId: string } | null {
    const lobby = this.getLobbyBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    if (!lobby || !playerId) return null;
    if (lobby.hostId !== playerId) return null;

    const target = lobby.players[targetPlayerId];
    if (!target || target.isHost) return null;

    const kickedSocketId = target.socketId;
    delete lobby.players[targetPlayerId];
    this.playerToLobby.delete(kickedSocketId);
    this.playerIds.delete(kickedSocketId);

    return { lobby, kickedSocketId };
  }

  // Cleanup stale lobbies (older than 3 hours)
  cleanup(): void {
    const now = Date.now();
    const maxAge = 3 * 60 * 60 * 1000;
    for (const [code, lobby] of this.lobbies.entries()) {
      if (now - lobby.createdAt > maxAge) {
        // Clean up player mappings
        Object.values(lobby.players).forEach(p => {
          this.playerToLobby.delete(p.socketId);
          this.playerIds.delete(p.socketId);
        });
        this.lobbies.delete(code);
      }
    }
  }
}

export const gameManager = new GameManager();
