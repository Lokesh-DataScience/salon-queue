// backend/src/sockets/queue.socket.ts
import type { Server } from 'socket.io';
import { z } from 'zod';

const joinSalonSchema = z.object({
  salonId: z.string().uuid(),
});

export function initQueueSockets(io: Server) {
  io.on('connection', (socket) => {
    socket.on('join:salon', (payload) => {
      const parsed = joinSalonSchema.safeParse(payload);
      if (!parsed.success) return; // silently ignore malformed joins, don't crash the socket
      socket.join(`salon:${parsed.data.salonId}`);
    });

    socket.on('leave:salon', (payload) => {
      const parsed = joinSalonSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.leave(`salon:${parsed.data.salonId}`);
    });
  });
}