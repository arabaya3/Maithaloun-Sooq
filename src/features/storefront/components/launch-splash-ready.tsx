"use client";

import { useEffect } from "react";

export function LaunchSplashReady() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.launch !== "skip") root.dataset.launch = "ready";
  }, []);
  return null;
}
