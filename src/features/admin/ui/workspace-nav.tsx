"use client";

import { useEffect, useState } from "react";

/** Sticky section links; the section in view is marked current. Every section stays mounted, so edits are never lost. */
export function WorkspaceNav({
  sections,
  label,
}: {
  sections: ReadonlyArray<{ id: string; label: string }>;
  label: string;
}) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");

  // The current section is the last one whose top has passed 35% of the screen; at the very bottom
  // of the page the last section is current even when it is too short to reach that line.
  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      const targets = sections
        .map((section) => document.getElementById(section.id))
        .filter((node): node is HTMLElement => node !== null);
      if (!targets.length) return;
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      const line = window.innerHeight * 0.35;
      const passed = targets.filter(
        (target) => target.getBoundingClientRect().top <= line,
      );
      setCurrent(
        (atBottom ? targets.at(-1) : (passed.at(-1) ?? targets[0]))!.id,
      );
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);

  return (
    <nav className="admin-workspace-nav" aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          aria-current={current === section.id ? "true" : undefined}
          onClick={() => setCurrent(section.id)}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
