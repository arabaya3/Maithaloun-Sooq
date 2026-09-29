"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Uint8Array(bytes.buffer);
}

export function PushNotificationControl() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    queueMicrotask(() => setSupported(available));
    if (!available) return;
    void navigator.serviceWorker.ready.then(async (registration) => {
      setEnabled(Boolean(await registration.pushManager.getSubscription()));
    });
  }, []);

  async function toggle() {
    setPending(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await fetch("/api/admin/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        await current.unsubscribe();
        setEnabled(false);
        setMessage("تم إيقاف إشعارات هذا الجهاز.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("اسمحي بالإشعارات من إعدادات المتصفح أولاً.");
        return;
      }
      const response = await fetch("/api/admin/push", { cache: "no-store" });
      const config = (await response.json()) as {
        ok: boolean;
        publicKey?: string | null;
      };
      if (!config.ok || !config.publicKey) {
        setMessage("الإشعارات غير مهيأة على الخادم بعد.");
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(config.publicKey),
      });
      const save = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!save.ok) throw new Error("subscribe_failed");
      setEnabled(true);
      setMessage("سيصل إشعار فور وصول طلب جديد.");
    } catch {
      setMessage("تعذّر تغيير إعداد الإشعارات. حاولي مرة أخرى.");
    } finally {
      setPending(false);
    }
  }

  if (!supported) {
    return (
      <p className="admin-muted">
        ثبّتي الموقع كتطبيق على الهاتف لتفعيل إشعارات الطلبات.
      </p>
    );
  }

  return (
    <div className="admin-push-control">
      <button
        type="button"
        className={
          enabled
            ? "admin-btn admin-btn-secondary"
            : "admin-btn admin-btn-primary"
        }
        onClick={toggle}
        disabled={pending}
      >
        {enabled ? (
          <BellOff size={18} aria-hidden="true" />
        ) : (
          <Bell size={18} aria-hidden="true" />
        )}
        {pending
          ? "جارٍ الحفظ…"
          : enabled
            ? "إيقاف الإشعارات"
            : "تفعيل إشعارات الطلبات"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
