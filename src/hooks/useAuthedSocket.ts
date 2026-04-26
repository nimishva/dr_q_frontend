"use client";

import { useEffect, useMemo } from "react";
import { getSocket } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";

export function useAuthedSocket(autoConnect = true) {
  const accessToken = useAuthStore((s) => s.accessToken);

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    if (!autoConnect) return;
    if (!accessToken) return;
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [accessToken, autoConnect, socket]);

  return socket;
}

