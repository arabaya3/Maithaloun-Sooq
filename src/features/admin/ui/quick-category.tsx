"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { quickCreateCategoryAction } from "../application/catalog-management-actions";

export function QuickCategory({
  onCreated,
}: {
  onCreated: (code: string) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const result = await quickCreateCategoryAction(name);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setName("");
      setOpen(false);
      onCreated(result.code);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="sp-quick-category">
        <button
          type="button"
          className="sp-link-button"
          onClick={() => setOpen(true)}
        >
          + قسم جديد
        </button>
        <Link href="/admin/categories" prefetch={false}>
          إدارة الأقسام
        </Link>
      </div>
    );
  }

  return (
    <div className="sp-quick-category" role="group" aria-label="قسم جديد">
      <label htmlFor={`${id}-name`} className="sr-only">
        اسم القسم الجديد
      </label>
      <input
        id={`${id}-name`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        maxLength={80}
        placeholder="مثل: معطرات الجو"
        autoFocus
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <button
        type="button"
        className="admin-button-primary"
        disabled={pending || name.trim().length < 2}
        onClick={add}
      >
        {pending ? "جارٍ الإضافة…" : "إضافة"}
      </button>
      <button
        type="button"
        className="admin-button-secondary"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        إلغاء
      </button>
      {error ? (
        <p id={`${id}-error`} className="sp-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
