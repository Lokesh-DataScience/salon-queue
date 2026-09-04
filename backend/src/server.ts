// backend/src/server.ts
import http from 'http';
import { Server } from 'socket.io';
import { env } from './config/env';
import { createApp } from './app';

const app = createApp();
const httpServer = http.createServer(app);

// Socket.IO is initialized here from Milestone 1 so the wiring exists, but
// no event handlers are registered until Milestone 4 (Real-time).
export const io = new Server(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

httpServer.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});