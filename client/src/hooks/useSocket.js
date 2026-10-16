import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

// Singleton socket shared across renders.
// Token is attached as socket auth before connect (see server/index.js io.use).
// Call resetSocket() on login/logout so a stale token is never reused.
let socketInstance = null;

export function getSocket(token) {
  if (!socketInstance) {
    socketInstance = io(SERVER_URL, { autoConnect: false });
  }
  // Only set auth when a token is passed: send/react/typing helpers call
  // getSocket() bare, and socket.io reads auth again on every reconnect —
  // clobbering it would fail the handshake and sign the user out.
  if (token) socketInstance.auth = { token };
  return socketInstance;
}

export function resetSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

export function useSocket() {
  const ref = useRef(null);
  if (!ref.current) ref.current = getSocket();
  useEffect(() => {
    return () => {
      // do not disconnect here - Chat.jsx controls lifecycle
    };
  }, []);
  return ref.current;
}
