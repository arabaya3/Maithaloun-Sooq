"use client";

import { History } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export const MANUAL_DRAFT_KEY = "souq-maythalun:admin:product-draft:v1";

interface StoredDraft {
  savedAt: string;
  fields: Record<string, string>;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// Drafts stay on this device only and storage may be unavailable; losing autosave never blocks typing.
function readRaw(): string | null {
  try {
    return window.localStorage.getItem(MANUAL_DRAFT_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredDraft | null {
  try {
    const parsed = JSON.parse(raw ?? "null") as StoredDraft | null;
    return parsed &&
      typeof parsed.savedAt === "string" &&
      parsed.fields &&
      Object.values(parsed.fields).some((value) => String(value).trim())
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const noSubscription = () => () => {};

function fieldsIn(root: HTMLElement): Field[] {
  return [
    ...root.querySelectorAll<Field>(
      "input[name], select[name], textarea[name]",
    ),
  ].filter(
    (field) =>
      !(field instanceof HTMLInputElement) ||
      !["hidden", "file", "submit", "button", "password"].includes(field.type),
  );
}

const timeFormat = new Intl.DateTimeFormat("ar-PS-u-nu-latn", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Autosaves the manual product form on this device and offers to restore it after a reload or failure. */
export function ProductDraft({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  // The draft found when the page opened; the server render sees none, so hydration matches.
  const stored = useSyncExternalStore(noSubscription, readRaw, () => null);
  const [settled, setSettled] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const offer = settled ? null : parse(stored);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let timer = 0;
    function save() {
      // Typing means the owner has chosen to start fresh (or already restored).
      setSettled(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const fields: Record<string, string> = {};
        for (const field of fieldsIn(node!)) {
          fields[field.name] =
            field instanceof HTMLInputElement && field.type === "checkbox"
              ? field.checked
                ? "on"
                : ""
              : field.value;
        }
        const draft = { savedAt: new Date().toISOString(), fields };
        try {
          window.localStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify(draft));
          setSavedAt(draft.savedAt);
        } catch {
          // Storage full or blocked: keep working without autosave.
        }
      }, 400);
    }
    node.addEventListener("input", save);
    node.addEventListener("change", save);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener("input", save);
      node.removeEventListener("change", save);
    };
  }, []);

  function restore() {
    if (!offer || !root.current) return;
    for (const field of fieldsIn(root.current)) {
      const value = offer.fields[field.name];
      if (value === undefined) continue;
      // Controlled React fields ignore a plain assignment; the prototype setter plus the event they
      // listen for updates them the same way typing would.
      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        if (field.checked !== (value === "on")) field.click();
        continue;
      }
      const prototype = Object.getPrototypeOf(field) as object;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        field,
        value,
      );
      field.dispatchEvent(
        new Event(field instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    }
    setSavedAt(offer.savedAt);
    setSettled(true);
  }

  function discard() {
    try {
      window.localStorage.removeItem(MANUAL_DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
    setSettled(true);
  }

  return (
    <div ref={root} className="admin-product-draft">
      {offer ? (
        <div className="admin-media-message" data-tone="warning" role="status">
          <p>
            <History size={18} aria-hidden="true" /> لديك مسودة محفوظة من الساعة{" "}
            <time dateTime={offer.savedAt}>
              {timeFormat.format(new Date(offer.savedAt))}
            </time>
            .
          </p>
          <div className="admin-draft-actions">
            <button
              type="button"
              className="admin-btn admin-btn-primary admin-btn-sm"
              onClick={restore}
            >
              استعادة المسودة
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={discard}
            >
              تجاهلها
            </button>
          </div>
        </div>
      ) : null}
      {children}
      <p className="admin-muted admin-draft-status" aria-live="polite">
        {savedAt
          ? `حُفظت المسودة على هذا الجهاز الساعة ${timeFormat.format(new Date(savedAt))}`
          : "تُحفظ المسودة تلقائياً على هذا الجهاز أثناء الكتابة."}
      </p>
    </div>
  );
}

/** Rendered on the new product's page after a successful create, so the finished draft is not offered again. */
export function ClearProductDraft() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(MANUAL_DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);
  return null;
}
