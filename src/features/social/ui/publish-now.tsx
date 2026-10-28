"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Send, X } from "lucide-react";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="admin-btn admin-btn-primary"
      disabled={pending}
      aria-busy={pending}
    >
      <Send size={16} aria-hidden="true" />{" "}
      {pending ? "جارٍ الإرسال… لا تغلقي الصفحة" : "نعم، انشري الآن"}
    </button>
  );
}

/**
 * «انشر الآن» with a confirmation that names the exact post. The confirmation carries the post's id
 * and version, so the server sends this post as it was shown, or nothing.
 */
export function PublishNowForm({
  action,
  id,
  version,
  title,
  scheduled,
}: {
  action: (form: FormData) => Promise<void>;
  id: string;
  version: number;
  title: string;
  scheduled: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="admin-btn admin-btn-primary"
        onClick={() => setOpen(true)}
      >
        <Send size={16} aria-hidden="true" /> انشر الآن
      </button>
    );
  }
  return (
    <form
      action={action}
      className="admin-alert-panel social-settle admin-form"
      aria-labelledby="publish-now-title"
    >
      <h2 id="publish-now-title">نشر هذا المنشور الآن؟</h2>
      <p>
        سيُرسل <strong>{title}</strong> وحده إلى صفحة MAYTHA MARKET على فيسبوك
        الآن، بدل موعده ({scheduled}). لن يُنشر أي منشور آخر.
      </p>
      <p className="admin-muted">
        رقم المنشور: <bdi dir="ltr">{id}</bdi>
      </p>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <label className="social-toggle">
        <input type="checkbox" name="confirm" value={id} required />
        <span>راجعتُ الصورة والنص وأريد نشره الآن.</span>
      </label>
      <div className="social-actions">
        <ConfirmButton />
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => setOpen(false)}
        >
          <X size={16} aria-hidden="true" /> إلغاء
        </button>
      </div>
    </form>
  );
}
