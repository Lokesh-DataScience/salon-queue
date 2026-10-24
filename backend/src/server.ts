// backend/src/server.ts
import http from 'http';
import { Server } from 'socket.io';
import { env } from './config/env';
import { createApp } from './app';
import { setIO } from './sockets/io';
import { initQueueSockets } from './sockets/queue.socket';
import { startCleanupJob } from './jobs/cleanup.job';

const app = createApp();
const httpServer = http.createServer(app);

export const io = new Server(httpServer, {
  maxHttpBufferSize: 10_000, // our only messages are tiny { salonId } payloads
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

setIO(io);
initQueueSockets(io);

httpServer.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  startCleanupJob();
});