"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

const BRAND = "Doctor Queue";

export type AppShellHeaderProps = {
  /** Shown in bold under the app title (e.g. user name, or a short screen title). */
  displayName: string;
  /** Dark pill label: Patient, Doctor, Sign in, etc. */
  roleBadge: string;
  /** When true, shows the green/amber live connection pill. */
  showLiveConnection?: boolean;
  /** Whether the realtime socket is connected (only if `showLiveConnection`). */
  liveConnected?: boolean;
  /** Custom right area; overrides default Sign out when set. */
  rightSlot?: ReactNode;
  /** Renders default Sign out button when provided and `rightSlot` is not. */
  onSignOut?: () => void;
  signOutLabel?: string;
};

/**
 * Shared sticky header for Doctor Queue — same layout and styles on patient, doctor, and auth screens.
 */
export function AppShellHeader({
  displayName,
  roleBadge,
  showLiveConnection = true,
  liveConnected = false,
  rightSlot,
  onSignOut,
  signOutLabel = "Sign out",
}: AppShellHeaderProps) {
  const connected = liveConnected;

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">{BRAND}</div>
          <div className="truncate text-base font-bold text-zinc-900">{displayName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white">
              {roleBadge}
            </span>
            {showLiveConnection ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  connected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
                  aria-hidden
                />
                {connected ? "Live updates on" : "Reconnecting…"}
              </span>
            ) : null}
          </div>
        </div>
        {rightSlot != null ? (
          <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
        ) : onSignOut ? (
          <span
            className="cursor-pointer text-sm font-semibold text-zinc-900"
            onClick={onSignOut}
          >
            {signOutLabel}
          </span>
        ) : null}
      </div>
    </header>
  );
}
