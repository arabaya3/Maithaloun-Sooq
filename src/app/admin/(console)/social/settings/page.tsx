import type { Metadata } from "next";
import { CheckCircle2, Megaphone, ShieldCheck, XCircle } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader, StatusPill } from "@/features/admin/ui/kit";
import {
  connectTokenAction,
  disconnectAction,
  saveSocialSettingsAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import { requiredPageScopes } from "@/features/social/infrastructure/meta-graph-client";
import {
  makeCallbackSecret,
  makeConfigProblems,
} from "@/features/social/infrastructure/make-publisher";
import {
  first,
  SocialNav,
  SocialNotice,
  StoreTime,
} from "@/features/social/ui/social-ui";
import {
  mascotLibrary,
  mascotPoseIds,
  type MascotPoseStatus,
} from "@/features/social/domain/mascot";

const mascotStatusLabels: Record<MascotPoseStatus, string> = {
  approved: "معتمدة",
  small_only: "صغيرة فقط (لا تُكبَّر)",
  blocked: "موقوفة للمراجعة",
  artwork_required: "تحتاج رسماً",
};

export const metadata: Metadata = { title: "فيسبوك — الإعدادات" };

export default async function SocialSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const params = await searchParams;
  const owner = can(actor, "social.approve");
  const publisher = socialService.publisherName();
  const makeProblems = makeConfigProblems(process.env);
  const [connection, settings] = await Promise.all([
    socialService.connection(),
    socialService.settings(),
  ]);
  const loginAvailable = Boolean(
    process.env.META_APP_ID && process.env.META_APP_SECRET,
  );
  const facebookResult = first(params.facebook);
  const missingScopes = connection
    ? requiredPageScopes.filter((scope) => !connection.scopes.includes(scope))
    : [];

  return (
    <main className="admin-page">
      <PageHeader title="إعدادات فيسبوك" />
      <SocialNav current="/admin/social/settings" />
      <SocialNotice
        done={
          first(params.done) ??
          (facebookResult === "connected" ? "connected" : undefined)
        }
        error={
          first(params.error) ??
          (facebookResult && facebookResult !== "connected"
            ? facebookResult
            : undefined)
        }
      />

      <section className="admin-panel" aria-labelledby="connection-title">
        <h2 id="connection-title">
          <Megaphone size={18} aria-hidden="true" /> ربط الصفحة
        </h2>
        <p className="admin-muted">
          الربط عبر تسجيل دخول فيسبوك الرسمي. لا نطلب ولا نخزّن كلمة مرور فيسبوك
          أبداً؛ نحفظ رمز وصول الصفحة مشفّراً فقط.
        </p>
        {connection ? (
          <dl className="admin-definition-list">
            <div>
              <dt>الحالة</dt>
              <dd>
                {connection.status === "connected" ? (
                  <StatusPill tone="ok" Icon={CheckCircle2}>
                    مربوطة
                  </StatusPill>
                ) : (
                  <StatusPill tone="danger" Icon={XCircle}>
                    انتهت الصلاحية — أعيدي الربط
                  </StatusPill>
                )}
              </dd>
            </div>
            <div>
              <dt>الصفحة</dt>
              <dd>
                {connection.pageName ?? "—"} ·{" "}
                <bdi dir="ltr">{connection.pageId}</bdi>
              </dd>
            </div>
            <div>
              <dt>الرمز</dt>
              <dd>
                <bdi dir="ltr">{connection.tokenHint}</bdi> ·{" "}
                {connection.tokenExpiresAt ? (
                  <>
                    ينتهي <StoreTime value={connection.tokenExpiresAt} />
                  </>
                ) : (
                  "لا ينتهي (أو لم يُفحص)"
                )}
              </dd>
            </div>
            <div>
              <dt>آخر فحص</dt>
              <dd>
                <StoreTime value={connection.lastCheckedAt} />
              </dd>
            </div>
            <div>
              <dt>الصلاحيات</dt>
              <dd>
                {connection.scopes.length ? (
                  missingScopes.length ? (
                    <span className="admin-form-error">
                      ناقصة: <bdi dir="ltr">{missingScopes.join(", ")}</bdi>
                    </span>
                  ) : (
                    <StatusPill tone="ok" Icon={ShieldCheck}>
                      كاملة
                    </StatusPill>
                  )
                ) : (
                  <span className="admin-muted">
                    لم تُفحص (META_APP_ID غير مضبوط)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p>
            <strong>غير مربوطة.</strong> المنشورات الموافق عليها تنتظر حتى يتم
            الربط.
          </p>
        )}

        {owner ? (
          <div className="admin-stack">
            {loginAvailable ? (
              <a
                className="admin-btn admin-btn-primary"
                href="/admin/api/social/meta/connect"
              >
                <Megaphone size={16} aria-hidden="true" />{" "}
                {connection ? "إعادة الربط" : "ربط عبر فيسبوك"}
              </a>
            ) : (
              <p className="admin-muted">
                لتفعيل زر «ربط عبر فيسبوك» اضبطي META_APP_ID وMETA_APP_SECRET
                على الخادم.
              </p>
            )}
            <details className="admin-disclosure">
              <summary>ربط برمز صفحة (مستخدم نظام من Business Manager)</summary>
              <form
                action={connectTokenAction}
                className="admin-form"
                autoComplete="off"
              >
                <label className="admin-field">
                  <span>معرّف الصفحة (Page ID)</span>
                  <input
                    name="pageId"
                    className="admin-input"
                    inputMode="numeric"
                    dir="ltr"
                    required
                    pattern="\d{5,30}"
                    defaultValue={
                      connection?.pageId ?? process.env.SOCIAL_PAGE_ID ?? ""
                    }
                  />
                </label>
                <label className="admin-field">
                  <span>اسم الصفحة</span>
                  <input
                    name="pageName"
                    className="admin-input"
                    defaultValue={connection?.pageName ?? "MAYTHA MARKET"}
                  />
                </label>
                <label className="admin-field">
                  <span>رمز وصول الصفحة</span>
                  <input
                    name="token"
                    type="password"
                    className="admin-input"
                    dir="ltr"
                    required
                    minLength={20}
                    autoComplete="off"
                  />
                </label>
                <button type="submit" className="admin-btn admin-btn-secondary">
                  حفظ مشفّراً
                </button>
              </form>
            </details>
            {connection ? (
              <form action={disconnectAction}>
                <button
                  type="submit"
                  className="admin-btn admin-btn-danger admin-btn-sm"
                >
                  فصل الصفحة
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className="admin-muted">الربط للمالك فقط.</p>
        )}
      </section>

      <section className="admin-panel" aria-labelledby="publisher-title">
        <h2 id="publisher-title">طريقة النشر</h2>
        <dl className="admin-definition-list">
          <div>
            <dt>الناشر</dt>
            <dd>
              {publisher === "make"
                ? "Make.com (سيناريو خارجي)"
                : "فيسبوك مباشرة (Graph API)"}
            </dd>
          </div>
          {publisher === "make" ? (
            <>
              <div>
                <dt>إعداد Make</dt>
                <dd>
                  {makeProblems.length ? (
                    <span className="admin-form-error">
                      ناقص: <bdi dir="ltr">{makeProblems.join(", ")}</bdi>
                    </span>
                  ) : (
                    <StatusPill tone="ok" Icon={CheckCircle2}>
                      مضبوط
                    </StatusPill>
                  )}
                </dd>
              </div>
              <div>
                <dt>الريلز عبر Make</dt>
                <dd>
                  {process.env.MAKE_SUPPORTS_REELS === "on"
                    ? "مفعّل"
                    : "متوقف (الريلز الموافق عليها تنتظر)"}
                </dd>
              </div>
              <div>
                <dt>تأكيد فيسبوك من Make</dt>
                <dd>
                  {makeCallbackSecret(process.env)
                    ? "مفعّل: يرسل Make نتيجة فيسبوك تلقائياً"
                    : "غير مفعّل: تحسمين النتيجة بنفسك بعد مراجعة الصفحة"}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <p className="admin-muted">
          مهما كانت طريقة النشر: لا يُرسل إلا ما وافقتِ عليه، ولا يُعاد إرسال
          منشور قد يكون نُشر.
        </p>
      </section>

      <section className="admin-panel" aria-labelledby="switches-title">
        <h2 id="switches-title">التشغيل التلقائي</h2>
        <form action={saveSocialSettingsAction} className="admin-form">
          <label className="social-toggle">
            <input
              type="checkbox"
              name="autoPublishApproved"
              defaultChecked={settings.autoPublishApproved}
              disabled={!owner}
            />
            <span>
              <strong>انشري الموافق عليه في موعده</strong>
              <br />
              <small className="admin-muted">
                لا يُنشر أي منشور لم توافقي عليه، مهما كان الإعداد.
              </small>
            </span>
          </label>
          <label className="social-toggle">
            <input
              type="checkbox"
              name="autoReplyFaq"
              defaultChecked={settings.autoReplyFaq}
              disabled={!owner}
            />
            <span>
              <strong>ردّي تلقائياً على الأسئلة الموثّقة فقط</strong>
              <br />
              <small className="admin-muted">
                التوصيل داخل ميثلون وأجرته، الدفع عند الاستلام، وطريقة الطلب. لا
                رسائل خاصة ولا رسائل غير مطلوبة.
              </small>
            </span>
          </label>
          <label className="social-toggle">
            <input
              type="checkbox"
              name="paused"
              defaultChecked={settings.paused}
              disabled={!owner}
            />
            <span>
              <strong>إيقاف مؤقت لكل شيء</strong>
              <br />
              <small className="admin-muted">
                لا نشر ولا ردود حتى تلغي الإيقاف.
              </small>
            </span>
          </label>
          {owner ? (
            <button type="submit" className="admin-btn admin-btn-primary">
              حفظ
            </button>
          ) : null}
        </form>
        <p className="admin-muted">
          لا إعلانات مدفوعة: النظام لا يملك أي صلاحية إعلانات.
        </p>
      </section>
      <section className="admin-panel" aria-labelledby="mascot-title">
        <h2 id="mascot-title">ميثو: الوضعيات</h2>
        <p className="admin-muted">
          تُستخدم فقط الوضعيات المعتمدة. الصغيرة تظهر صغيرة ولا تُكبَّر،
          والوضعيات بدون رسم أو الموقوفة تُنشر الحملة بدونها.
        </p>
        <ul className="admin-line-list">
          {mascotPoseIds.map((pose) => {
            const info = mascotLibrary[pose];
            return (
              <li key={pose} className="admin-line">
                <span className="admin-line-main">
                  <strong>{info.labelAr}</strong>
                  {info.note ? (
                    <small className="admin-muted"> · {info.note}</small>
                  ) : null}
                </span>
                <span className="admin-line-side">
                  {mascotStatusLabels[info.status]}
                  {info.sourceHeight ? ` · ${info.sourceHeight}px` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
