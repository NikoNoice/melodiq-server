import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import apiRoutes from './routes/api';
import { setupSocketHandlers } from './socket/handler';
import { gameManager } from './services/GameManager';
import { ClientToServerEvents, ServerToClientEvents } from './types';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Socket.IO
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

setupSocketHandlers(io);

// Cleanup stale lobbies every 30 minutes
setInterval(() => {
  gameManager.cleanup();
}, 30 * 60 * 1000);

const PORT = parseInt(process.env.PORT || '8080', 10);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║     🎵  MelodiQ Server Ready  🎵    ║
  ║     Port: ${String(PORT).padEnd(25)}║
  ║     Origins: ${(allowedOrigins[0] || 'any').slice(0, 22).padEnd(22)}║
  ╚══════════════════════════════════════╝
  `);
});
