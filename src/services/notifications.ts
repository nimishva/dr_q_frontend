"use client";

export function supportsNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

