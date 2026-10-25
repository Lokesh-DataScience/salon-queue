import { io, Socket } from 'socket.io-client';

const configured = import.meta.env.VITE_SOCKET_URL as string | undefined;
// Local development talks to the backend on port 4000; the live site uses its own address.
const SOCKET_URL = import.meta.env.DEV ? configured || 'http://localhost:4000' : undefined;

export const socket: Socket = io(SOCKET_URL, {
  autoConnect: true,
  withCredentials: true,
});