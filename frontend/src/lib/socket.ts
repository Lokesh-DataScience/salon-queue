import { io, Socket } from 'socket.io-client';

const configured = import.meta.env.VITE_SOCKET_URL as string | undefined;
// Empty in production means "the address this page came from".
const SOCKET_URL = configured ? configured : import.meta.env.DEV ? 'http://localhost:4000' : undefined;

export const socket: Socket = io(SOCKET_URL, {
  autoConnect: true,
  withCredentials: true,
});