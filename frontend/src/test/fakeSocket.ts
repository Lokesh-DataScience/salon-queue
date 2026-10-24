import { vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
const handlers = new Map<string, Set<Handler>>();

// Stand-in for lib/socket.ts, so no test ever opens a real connection.
export const socket = {
  on: vi.fn((event: string, handler: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
  }),
  off: vi.fn((event: string, handler: Handler) => {
    handlers.get(event)?.delete(handler);
  }),
  emit: vi.fn(),
};

export function fireSocket(event: string, ...args: unknown[]) {
  handlers.get(event)?.forEach((h) => h(...args));
}

export function resetSocket() {
  handlers.clear();
  socket.on.mockClear();
  socket.off.mockClear();
  socket.emit.mockClear();
}