"use client";

import { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">{children}</div>;
}

