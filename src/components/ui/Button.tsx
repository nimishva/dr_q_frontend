"use client";

import { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold",
        "bg-zinc-900 text-white active:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors",
        className,
      ].join(" ")}
    />
  );
}

