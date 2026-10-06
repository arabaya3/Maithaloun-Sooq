"use client";

import { useRouter } from "next/navigation";
import { History, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const RECENT_KEY = "souq-maythalun:admin-search:recent:v1";
const RECENT_LIMIT = 5;
const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

interface Hit {
  id: string;
  label: string;
  detail: string | null;
  href: string;
}
interface Group {
  key: string;
  label: string;
  hits: Hit[];
}
type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; groups: Group[] }
  | { status: "error"; message: string };

// Recent searches stay on this device only; storage may be unavailable and that is fine.
function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function rememberRecent(query: string) {
  try {
    const next = [query, ...readRecent().filter((item) => item !== query)];
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(next.slice(0, RECENT_LIMIT)),
    );
  } catch {
    // Not remembering a search never blocks it.
  }
}

export function AdminGlobalSearch({
  autoFocus = false,
  onNavigate,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-results`;
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ status: "loading" });
      try {
        const response = await fetch(
          `/admin/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const body = (await response.json()) as {
          ok: boolean;
          groups?: Group[];
          message?: string;
        };
        if (!response.ok || !body.ok) {
          setState({
            status: "error",
            message: body.message ?? "تعذّر البحث الآن.",
          });
          return;
        }
        setState({ status: "done", groups: body.groups ?? [] });
        setActive(-1);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof TypeError
              ? "لا يوجد اتصال. تحققي من الشبكة ثم أعيدي المحاولة."
              : "تعذّر البحث الآن.",
        });
      }
    }, DEBOUNCE_MS);
    // A newer keystroke cancels both the wait and any request still in flight.
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, attempt]);

  // Opening a dialog moves focus to its first control, so focus the box on the next frame instead.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  const showRecent = trimmed.length < MIN_LENGTH;
  const visible: State = showRecent ? { status: "idle" } : state;
  const flat =
    visible.status === "done"
      ? visible.groups.flatMap((group) => group.hits)
      : [];

  function go(hit: Hit) {
    rememberRecent(trimmed);
    setOpen(false);
    setQuery("");
    onNavigate?.();
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && flat.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % flat.length);
    } else if (event.key === "ArrowUp" && flat.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? flat.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0 && flat[active]) {
      event.preventDefault();
      go(flat[active]);
    } else if (event.key === "Escape") {
      if (query) setQuery("");
      else setOpen(false);
    }
  }

  let index = -1;
  return (
    <div className="admin-search" ref={wrapper}>
      <div className="admin-search-field">
        <Search size={18} aria-hidden="true" />
        <label className="sr-only" htmlFor={`${id}-input`}>
          بحث في المتجر
        </label>
        <input
          ref={input}
          id={`${id}-input`}
          type="search"
          dir="auto"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 && flat[active] ? `${id}-hit-${active}` : undefined
          }
          placeholder="ابحثي عن منتج، طلب، زبون، فاتورة أو مورد…"
          autoComplete="off"
          value={query}
          onFocus={() => {
            setRecent(readRecent());
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="admin-search-clear"
            aria-label="مسح البحث"
            onClick={() => setQuery("")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div
        className="admin-search-panel"
        hidden={!open}
        id={listId}
        role="listbox"
        aria-label="نتائج البحث"
      >
        <p className="sr-only" role="status" aria-live="polite">
          {visible.status === "loading"
            ? "جارٍ البحث"
            : visible.status === "done"
              ? `${flat.length} نتيجة`
              : ""}
        </p>
        {showRecent ? (
          recent.length ? (
            <div role="group" aria-label="عمليات بحث سابقة">
              <p className="admin-search-group-label">عمليات بحث سابقة</p>
              {recent.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="admin-search-recent"
                  onClick={() => setQuery(item)}
                >
                  <History size={16} aria-hidden="true" />
                  <bdi>{item}</bdi>
                </button>
              ))}
            </div>
          ) : (
            <p className="admin-search-note">
              اكتبي حرفين على الأقل. يمكنك البحث برقم الطلب أو الهاتف أو رقم
              فاتورة البيع.
            </p>
          )
        ) : visible.status === "loading" ? (
          <p className="admin-search-note">
            <LoaderCircle size={16} className="admin-spin" aria-hidden="true" />{" "}
            جارٍ البحث…
          </p>
        ) : visible.status === "error" ? (
          <div className="admin-search-note" data-tone="error">
            <p>{visible.message}</p>
            <button
              type="button"
              className="admin-btn admin-btn-secondary admin-btn-sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              إعادة المحاولة
            </button>
          </div>
        ) : visible.status === "done" && !flat.length ? (
          <p className="admin-search-note">
            لا توجد نتائج لـ «<bdi>{trimmed}</bdi>».
          </p>
        ) : visible.status === "done" ? (
          visible.groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label}>
              <p className="admin-search-group-label">{group.label}</p>
              {group.hits.map((hit) => {
                index += 1;
                const position = index;
                return (
                  <a
                    key={`${group.key}:${hit.id}`}
                    id={`${id}-hit-${position}`}
                    role="option"
                    aria-selected={position === active}
                    className="admin-search-hit"
                    href={hit.href}
                    onClick={(event) => {
                      event.preventDefault();
                      go(hit);
                    }}
                    onPointerEnter={() => setActive(position)}
                  >
                    <bdi className="admin-search-hit-label">{hit.label}</bdi>
                    {hit.detail ? (
                      <bdi className="admin-search-hit-detail">
                        {hit.detail}
                      </bdi>
                    ) : null}
                  </a>
                );
              })}
            </div>
          ))
        ) : null}
      </div>
    </div>
  );
}
