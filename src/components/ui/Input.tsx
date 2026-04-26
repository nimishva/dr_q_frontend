"use client";

import { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm",
        "outline-none focus:ring-2 focus:ring-zinc-900/15 focus:border-zinc-300",
        "placeholder:text-zinc-400",
        className,
      ].join(" ")}
    />
  );
}

