"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type UserRole = "patient" | "doctor" | "admin" | "clinic_admin" | "clinic_staff";

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
  clinicId?: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  setAuth: (auth: { accessToken: string; refreshToken?: string; user: AuthUser }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: ({ accessToken, refreshToken, user }) =>
        set(() => ({
          accessToken,
          refreshToken: refreshToken ?? null,
          user,
        })),
      logout: () => set(() => ({ accessToken: null, refreshToken: null, user: null })),
    }),
    {
      name: "doctor-queue-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
      }),
      skipHydration: true,
    },
  ),
);
