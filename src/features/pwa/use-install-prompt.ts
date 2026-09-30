"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  dismissalStorageKey,
  isDismissalActive,
  isIosDevice,
  nextDismissalExpiry,
  resolveInstallStatus,
  type InstallScope,
  type InstallStatus,
} from "./install-state";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let attached = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function attach() {
  if (attached) return;
  attached = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
  window
    .matchMedia?.("(display-mode: standalone)")
    .addEventListener?.("change", emit);
  window.addEventListener("storage", emit);
}

function subscribe(listener: () => void) {
  attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function getStatus(): InstallStatus {
  return resolveInstallStatus({
    standalone: isStandalone(),
    installed,
    hasDeferredPrompt: deferredPrompt !== null,
    ios: isIosDevice({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
  });
}

function readDismissed(scope: InstallScope): boolean {
  try {
    return isDismissalActive(
      window.localStorage.getItem(dismissalStorageKey(scope)),
      Date.now(),
    );
  } catch {
    return false;
  }
}

export function useInstallPrompt(scope: InstallScope) {
  const status = useSyncExternalStore<InstallStatus>(
    subscribe,
    getStatus,
    () => "unsupported",
  );
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(scope),
    () => true,
  );

  const promptInstall = useCallback(async () => {
    const event = deferredPrompt;
    if (!event) return "unavailable" as const;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A captured prompt event can only be used once.
    deferredPrompt = null;
    emit();
    return outcome;
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(
        dismissalStorageKey(scope),
        nextDismissalExpiry(Date.now()),
      );
    } catch {
      // Storage may be unavailable in private mode.
    }
    emit();
  }, [scope]);

  return { status, dismissed, promptInstall, dismiss };
}
