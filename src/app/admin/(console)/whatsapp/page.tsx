import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import {
  ownerReplyAction,
  setAssistantPausedAction,
  simulatorMessageAction,
} from "@/features/shop-assistant/application/shop-assistant-actions";
import {
  liveAssistantEnabled,
  liveSender,
  shopAssistantService,
} from "@/features/shop-assistant/application/shop-assistant-instance";

export const metadata: Metadata = { title: "مساعد واتساب" };

const NOTICES: Record<string, string> = {
  empty: "اكتبي رسالة أولاً.",
  "not-connected":
    "واتساب الرسمي غير موصول بعد، فلا يمكن إرسال رد لزبون حقيقي من هنا.",
};

const time = new Intl.DateTimeFormat("ar-PS", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Hebron",
});

export default async function WhatsAppAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; notice?: string }>;
}) {
  await connection();
  const actor = await requireAdminSession();
  if (actor.role !== "owner") redirect("/admin");
  const params = await searchParams;
  const conversations = await shopAssistantService.conversations();
  const selected = params.c
    ? (conversations.find((row) => row.id === params.c) ?? null)
    : null;
  const messages = selected
    ? await shopAssistantService.messages(selected.id)
    : [];
  const live = liveAssistantEnabled() && liveSender() !== null;

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <div>
          <h1>مساعد واتساب</h1>
          <p className="admin-lede">
            {live
              ? "المساعد يرد على زبائن واتساب. أوقفيه لأي محادثة لتردّي بنفسك."
              : "واتساب الرسمي غير موصول بعد. جرّبي المساعد هنا بمحادثة تجريبية؛ طلباتها تُسجّل كطلبات تجريبية."}
          </p>
        </div>
      </header>

      {params.notice && NOTICES[params.notice] ? (
        <p className="admin-media-message" data-tone="error" role="alert">
          {NOTICES[params.notice]}
        </p>
      ) : null}

      <section className="admin-panel" aria-labelledby="simulator-title">
        <h2 id="simulator-title">تجربة المحادثة</h2>
        <form action={simulatorMessageAction} className="admin-form">
          <label>
            <span>اكتبي كأنك زبونة</span>
            <input
              name="text"
              maxLength={1000}
              autoComplete="off"
              placeholder="بدي جل غسيل رخيص"
            />
          </label>
          <button type="submit" className="admin-btn">
            إرسال للمساعد
          </button>
        </form>
      </section>

      <section className="admin-panel" aria-labelledby="conversations-title">
        <h2 id="conversations-title">المحادثات</h2>
        {conversations.length ? (
          <ul className="admin-wa-conversations">
            {conversations.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/whatsapp?c=${row.id}`}>
                  <span dir="ltr">
                    {row.isTest ? "تجربة" : row.customerE164}
                  </span>
                  {row.customerName ? ` · ${row.customerName}` : ""}
                </Link>
                {row.humanRequestedAt ? (
                  <span className="admin-badge" data-tone="warn">
                    طلب موظفاً
                  </span>
                ) : row.botPaused ? (
                  <span className="admin-badge">موقوف</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-muted">لا توجد محادثات بعد.</p>
        )}
      </section>

      {selected ? (
        <section className="admin-panel" aria-labelledby="thread-title">
          <h2 id="thread-title">
            {selected.isTest ? "المحادثة التجريبية" : selected.customerE164}
          </h2>
          <form action={setAssistantPausedAction}>
            <input type="hidden" name="conversationId" value={selected.id} />
            <input
              type="hidden"
              name="paused"
              value={selected.botPaused ? "false" : "true"}
            />
            <button type="submit" className="admin-btn">
              {selected.botPaused
                ? "إعادة تشغيل المساعد لهذه المحادثة"
                : "إيقاف المساعد والرد بنفسي"}
            </button>
          </form>
          <ol className="admin-wa-thread">
            {messages.map((message) => (
              <li key={message.id} data-author={message.author}>
                <p dir="auto">{message.body}</p>
                <small>
                  {message.author === "customer"
                    ? "الزبون"
                    : message.author === "owner"
                      ? "أنتِ"
                      : "المساعد"}{" "}
                  · {time.format(message.createdAt)}
                  {message.deliveryStatus === "failed" ? " · لم يُرسل" : ""}
                </small>
              </li>
            ))}
          </ol>
          <form action={ownerReplyAction} className="admin-form">
            <input type="hidden" name="conversationId" value={selected.id} />
            <label>
              <span>ردّك</span>
              <textarea name="text" rows={3} maxLength={1000} />
            </label>
            <button type="submit" className="admin-btn">
              إرسال الرد
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
