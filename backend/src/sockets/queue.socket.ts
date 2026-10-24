// backend/src/sockets/queue.socket.ts
import type { Server } from 'socket.io';
import { z } from 'zod';

const joinSalonSchema = z.object({
  salonId: z.string().uuid(),
});

const MAX_SALON_ROOMS = 3; // a customer tracks one salon; a barber watches one
const EVENT_WINDOW_MS = 10_000;
const MAX_EVENTS_PER_WINDOW = 20;

export function initQueueSockets(io: Server) {
  io.on('connection', (socket) => {
    let windowStart = Date.now();
    let eventCount = 0;

    function withinEventBudget() {
      const now = Date.now();
      if (now - windowStart > EVENT_WINDOW_MS) {
        windowStart = now;
        eventCount = 0;
      }
      return ++eventCount <= MAX_EVENTS_PER_WINDOW;
    }

    const salonRoomCount = () => [...socket.rooms].filter((r) => r.startsWith('salon:')).length;

    socket.on('join:salon', (payload) => {
      if (!withinEventBudget()) return;
      const parsed = joinSalonSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = `salon:${parsed.data.salonId}`;
      if (!socket.rooms.has(room) && salonRoomCount() >= MAX_SALON_ROOMS) return;
      socket.join(room);
    });

    socket.on('leave:salon', (payload) => {
      if (!withinEventBudget()) return;
      const parsed = joinSalonSchema.safeParse(payload);
      if (!parsed.success) return;
      socket.leave(`salon:${parsed.data.salonId}`);
    });
  });
}