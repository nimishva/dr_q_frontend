"use client";

import { io, Socket } from "socket.io-client";
import { useAuthStore } from "@/stores/auth";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

let socket: Socket | null = null;
let subscribed = false;

/** Clears singleton after logout so the next session gets a fresh client. */
export function resetSocket(): void {
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch {
      // ignore
    }
    socket = null;
    subscribed = false;
  }
}

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ["websocket"],
    auth: {
      token: useAuthStore.getState().accessToken,
    },
  });

  if (!subscribed) {
    subscribed = true;
    useAuthStore.subscribe((state, prev) => {
      if (!socket) return;
      const token = state.accessToken;
      socket.auth = { token: token ?? undefined };

      const had = Boolean(prev?.accessToken);
      const has = Boolean(token);
      if (had && !has) {
        resetSocket();
        return;
      }
      if (had && has && prev!.accessToken !== token && socket.connected) {
        socket.disconnect();
        socket.connect();
      }
    });
  }

  return socket;
}

