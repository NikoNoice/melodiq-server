// ============================================
// MelodiQ Type Definitions
// ============================================

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  source: 'youtube' | 'spotify';
  sourceId: string; // YouTube video ID or Spotify track ID
  duration: number; // total duration in seconds
  previewUrl?: string; // direct audio URL for Spotify previews
  startTime: number; // custom start time in seconds
  endTime: number; // custom end time in seconds
}

export interface Playlist {
  id: string;
  name: string;
  source: 'youtube' | 'spotify';
  sourceId: string;
  coverUrl?: string;
  songCount: number;
}

export type GameMode = 'classic' | 'blitz' | 'elimination' | 'marathon';
export type GuessStyle = 'type' | 'grid' | 'multiple_choice';
export type LobbyState = 'waiting' | 'starting' | 'playing' | 'round_end' | 'game_over';

export interface GameSettings {
  mode: GameMode;
  guessStyle: GuessStyle;
  rounds: number;
  timePerRound: number; // seconds to guess
  snippetDuration: number; // how long song plays (seconds)
  maxPlayers: number;
  hintsEnabled: boolean;
  showArtist: boolean; // show artist as hint
  scoreMultiplierSpeed: boolean; // faster = more points
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'classic',
  guessStyle: 'type',
  rounds: 15,
  timePerRound: 30,
  snippetDuration: 5,
  maxPlayers: 12,
  hintsEnabled: true,
  showArtist: false,
  scoreMultiplierSpeed: true,
};

export interface Avatar {
  emoji: string;
  color: string;
}

export const AVATARS: Avatar[] = [
  { emoji: '🎸', color: '#ff4757' },
  { emoji: '🎹', color: '#2ed573' },
  { emoji: '🥁', color: '#1e90ff' },
  { emoji: '🎺', color: '#ffa502' },
  { emoji: '🎻', color: '#a855f7' },
  { emoji: '🎤', color: '#ff6b81' },
  { emoji: '🎧', color: '#7bed9f' },
  { emoji: '🎵', color: '#70a1ff' },
  { emoji: '🎷', color: '#eccc68' },
  { emoji: '🪗', color: '#ff7f50' },
  { emoji: '🎶', color: '#dfe6e9' },
  { emoji: '🪘', color: '#e17055' },
];

export interface Player {
  id: string;
  socketId: string;
  name: string;
  avatar: Avatar;
  score: number;
  streak: number;
  isHost: boolean;
  isReady: boolean;
  hasGuessed: boolean;
  lastGuessCorrect: boolean;
  roundScore: number;
}

export interface RoundState {
  roundNumber: number;
  song: Song;
  startedAt: number;
  phase: 'playing' | 'reveal';
  guesses: Record<string, { guess: string; correct: boolean; time: number; score: number }>;
  gridOptions?: string[]; // for grid/multiple choice modes
}

export interface Lobby {
  code: string;
  hostId: string;
  state: LobbyState;
  players: Record<string, Player>;
  settings: GameSettings;
  songs: Song[];
  currentRound: RoundState | null;
  roundHistory: RoundState[];
  createdAt: number;
}

// Socket Events
export interface ServerToClientEvents {
  lobby_update: (lobby: Lobby) => void;
  game_start: (lobby: Lobby) => void;
  round_start: (round: { roundNumber: number; totalRounds: number; snippetDuration: number; timePerRound: number; gridOptions?: string[]; artistHint?: string; song?: { sourceId: string; source: string; startTime: number; endTime: number } }) => void;
  round_tick: (timeLeft: number) => void;
  player_guessed: (data: { playerId: string; correct: boolean }) => void;
  round_end: (data: { song: Song; scores: Record<string, number>; guesses: Record<string, { guess: string; correct: boolean; score: number }> }) => void;
  game_over: (data: { players: Player[]; mvp: Player }) => void;
  error: (message: string) => void;
  chat_message: (data: { playerId: string; playerName: string; message: string }) => void;
  player_joined: (player: Player) => void;
  player_left: (playerId: string) => void;
  hint_reveal: (hint: string) => void;
}

export interface ClientToServerEvents {
  create_lobby: (data: { playerName: string; avatar: Avatar }, callback: (response: { success: boolean; lobby?: Lobby; playerId?: string; error?: string }) => void) => void;
  join_lobby: (data: { code: string; playerName: string; avatar: Avatar }, callback: (response: { success: boolean; lobby?: Lobby; playerId?: string; error?: string }) => void) => void;
  update_settings: (settings: Partial<GameSettings>) => void;
  add_song: (song: Omit<Song, 'id'>, callback: (response: { success: boolean; song?: Song; error?: string }) => void) => void;
  remove_song: (songId: string) => void;
  add_songs_bulk: (songs: Omit<Song, 'id'>[], callback: (response: { success: boolean; count?: number; error?: string }) => void) => void;
  toggle_ready: () => void;
  start_game: () => void;
  submit_guess: (guess: string) => void;
  skip_round: () => void;
  send_chat: (message: string) => void;
  kick_player: (playerId: string) => void;
  leave_lobby: () => void;
}
