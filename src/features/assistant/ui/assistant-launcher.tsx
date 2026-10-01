"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import "./assistant.css";

const AssistantPanel = dynamic(
  () => import("./assistant-panel").then((module) => module.AssistantPanel),
  {
    ssr: false,
    loading: () => (
      <section
        className="assistant-panel"
        aria-label="المساعد"
        aria-busy="true"
      >
        <p className="assistant-empty">جارٍ فتح المساعد…</p>
      </section>
    ),
  },
);

function AssistantIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3 0-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.8l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="assistant-launcher"
        aria-label={open ? "إغلاق المساعد" : "فتح المساعد"}
        aria-expanded={open}
        data-activity={activity || undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <AssistantIcon />
        {activity ? (
          <span className="assistant-launcher-dot" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        <AssistantPanel onClose={close} onActivity={setActivity} />
      ) : null}
    </>
  );
}
