import type { Metadata } from "next";
import { AlertTriangle, Clapperboard, Download, RotateCcw } from "lucide-react";

import { requireAdminSession } from "@/features/admin/auth/admin-session";
import { can } from "@/features/admin/domain/permissions";
import { PageHeader, StatusPill } from "@/features/admin/ui/kit";
import {
  requestReelRenderAction,
  retryReelRenderAction,
} from "@/features/social/application/social-actions";
import { socialService } from "@/features/social/application/social-instance";
import { MAX_RENDER_ATTEMPTS } from "@/features/social/application/reel-render-queue";
import { SocialError } from "@/features/social/application/social-service";
import {
  reelConceptLabels,
  reelConcepts,
  reelLengths,
  MAX_REEL_TEXT,
  type StoryScene,
} from "@/features/social/domain/reels";
import {
  mascotLibrary,
  mascotPoseIds,
  poseIsUsable,
} from "@/features/social/domain/mascot";
import { RenderRefresh } from "@/features/social/ui/render-refresh";
import {
  SocialNav,
  SocialNotice,
  StoreTime,
} from "@/features/social/ui/social-ui";

export const metadata: Metadata = { title: "فيسبوك — الريلز" };

const roleLabels: Record<StoryScene["role"], string> = {
  hook: "الافتتاحية",
  problem: "المشكلة",
  product: "المنتج",
  detail: "تفصيل",
  cta: "الدعوة للطلب",
};

const statusText: Record<string, string> = {
  queued: "بانتظار عامل الفيديو",
  rendering: "قيد التجهيز",
  ready: "جاهز",
  failed: "فشل التجهيز",
};

/** Another try draws the same old prices; the owner asks for a new Reel instead. */
const FINAL_ERRORS = new Set(["CATALOG_CHANGED", "PRODUCT_UNAVAILABLE"]);

const errorText: Record<string, string> = {
  WORKER_LOST: "توقف عامل الفيديو أثناء التجهيز.",
  FFMPEG_FAILED: "تعذّر تركيب الفيديو.",
  PRODUCT_PHOTO_MISSING: "صورة منتج غير متوفرة.",
  PRODUCT_UNAVAILABLE: "منتج لم يعد في المتجر.",
  UPLOAD_FAILED: "تعذّر حفظ الفيديو.",
  CATALOG_CHANGED:
    "تغيّر سعر أو منتج منذ الطلب؛ اطلبي الريل من جديد بأسعار اليوم.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export default async function SocialReelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdminSession();
  const params = await searchParams;
  const request = {
    concept: first(params.concept) ?? "meet-meetho",
    seconds: Number(first(params.seconds) ?? 10),
    productIds: all(params.product).filter(Boolean).slice(0, 3),
    dropScenes: all(params.drop).map(Number).filter(Number.isInteger),
    pose: first(params.pose) || undefined,
    hookText: first(params.hookText) || undefined,
    ctaText: first(params.ctaText) || undefined,
  };
  const [products, renders] = await Promise.all([
    socialService.reelProducts(actor),
    socialService.reelRenders(actor),
  ]);
  let board = null;
  let stills: string[] = [];
  let boardError: string | null = null;
  try {
    board = await socialService.reelStoryboard(actor, request);
    stills = await socialService.reelStoryboardStills(board);
  } catch (error) {
    if (!(error instanceof SocialError)) throw error;
    boardError = error.code;
  }
  // The full storyboard, before any scene was left out or reworded, so edits can be undone.
  const fullBoard = await socialService
    .reelStoryboard(actor, {
      concept: request.concept,
      seconds: request.seconds,
      productIds: request.productIds,
    })
    .catch(() => null);
  const defaultHook =
    fullBoard?.scenes[0]?.layers.find(
      (layer) => layer.kind === "text" && layer.size === "hook",
    ) ?? null;
  const defaultCta =
    fullBoard?.scenes.at(-1)?.layers.find((layer) => layer.kind === "cta") ??
    null;
  const poses = mascotPoseIds.filter((pose) => poseIsUsable(pose));
  const canPrepare = can(actor, "social.prepare");
  const busy = renders.some(
    (render) => render.status === "queued" || render.status === "rendering",
  );

  return (
    <main className="admin-page">
      <PageHeader
        title="الريلز"
        lede="اختاري الفكرة والمنتجات والمدة والمشاهد، شوفي اللوحة، ثم اطلبي التجهيز. الفيديو يبقى عندك للمشاهدة والتنزيل؛ لا يُنشر شيء من هنا."
      />
      <SocialNav current="/admin/social/reels" />
      <SocialNotice done={first(params.done)} error={first(params.error)} />
      <RenderRefresh active={busy} />

      <div className="social-studio">
        <aside
          className="admin-panel social-side"
          aria-labelledby="reel-settings-title"
        >
          <h2 id="reel-settings-title">إعدادات الريل</h2>
          <form method="get" className="admin-form social-side-form">
            <label className="admin-field">
              <span>الفكرة</span>
              <select
                name="concept"
                className="admin-input"
                defaultValue={request.concept}
              >
                {reelConcepts.map((concept) => (
                  <option key={concept} value={concept}>
                    {reelConceptLabels[concept]}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>المدة</span>
              <select
                name="seconds"
                className="admin-input"
                defaultValue={String(request.seconds)}
              >
                {reelLengths.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} ثانية
                  </option>
                ))}
              </select>
            </label>
            {[0, 1, 2].map((slot) => (
              <label key={slot} className="admin-field">
                <span>منتج {slot + 1}</span>
                <select
                  name="product"
                  className="admin-input"
                  defaultValue={request.productIds[slot] ?? ""}
                >
                  <option value="">بدون</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="admin-field">
              <span>وضعية ميثو</span>
              <select
                name="pose"
                className="admin-input"
                defaultValue={request.pose ?? ""}
              >
                <option value="">كما في الفكرة</option>
                {poses.map((pose) => (
                  <option key={pose} value={pose}>
                    {mascotLibrary[pose].labelAr}
                    {mascotLibrary[pose].status === "small_only"
                      ? " (صغير)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>جملة الافتتاح</span>
              <input
                name="hookText"
                className="admin-input"
                maxLength={MAX_REEL_TEXT}
                defaultValue={request.hookText ?? ""}
                placeholder={
                  defaultHook && defaultHook.kind === "text"
                    ? defaultHook.text
                    : ""
                }
              />
            </label>
            <label className="admin-field">
              <span>الدعوة للطلب</span>
              <input
                name="ctaText"
                className="admin-input"
                maxLength={MAX_REEL_TEXT}
                defaultValue={request.ctaText ?? ""}
                placeholder={
                  defaultCta && defaultCta.kind === "cta" ? defaultCta.text : ""
                }
              />
              <small className="admin-muted">
                بدون أسعار أو أرقام أو عروض؛ الأسعار تأتي من المتجر.
              </small>
            </label>
            {fullBoard && fullBoard.scenes.length > 3 ? (
              <fieldset className="admin-field social-scenes">
                <legend>المشاهد الوسطى</legend>
                {fullBoard.scenes.map((scene, index) =>
                  index === 0 ||
                  index === fullBoard.scenes.length - 1 ? null : (
                    <label key={index}>
                      <input
                        type="checkbox"
                        name="drop"
                        value={index}
                        defaultChecked={request.dropScenes.includes(index)}
                      />{" "}
                      احذفي المشهد {index + 1} ({roleLabels[scene.role]})
                    </label>
                  ),
                )}
              </fieldset>
            ) : null}
            <button type="submit" className="admin-btn admin-btn-secondary">
              اعرضي اللوحة
            </button>
          </form>
        </aside>

        <section
          className="admin-panel social-studio-main"
          aria-labelledby="reel-plan-title"
        >
          <h2 id="reel-plan-title">لوحة الريل</h2>

          {boardError || !board ? (
            <p className="admin-note" role="status">
              <AlertTriangle size={16} aria-hidden="true" />{" "}
              {boardError === "reel_text_rejected"
                ? "النص المكتوب غير مقبول: بحدود ٦٠ حرفاً، بدون أسعار أو أرقام أو عروض أو ادعاءات."
                : boardError === "reel_pose_unavailable"
                  ? "وضعية ميثو هذه غير معتمدة للريل بعد."
                  : "لا يمكن بناء هذه اللوحة: هذه الفكرة تحتاج منتجاً، أو منتج غير متوفر."}
            </p>
          ) : (
            <>
              <p className="admin-muted">
                {board.titleAr} · {board.seconds} ثانية · {board.scenes.length}{" "}
                مشاهد · 1080×1920 · بدون صوت معلّق
              </p>
              <ol className="social-storyboard">
                {board.scenes.map((scene, index) => (
                  <li key={index}>
                    {stills[index] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
                      <img
                        src={stills[index]}
                        alt={`المشهد ${index + 1}`}
                        width={270}
                        height={480}
                      />
                    ) : null}
                    <span>
                      {index + 1}. {roleLabels[scene.role]} ·{" "}
                      {scene.seconds.toFixed(1)} ث
                    </span>
                  </li>
                ))}
              </ol>
              {canPrepare ? (
                <form action={requestReelRenderAction}>
                  <input type="hidden" name="concept" value={board.concept} />
                  <input type="hidden" name="seconds" value={board.seconds} />
                  {request.productIds.map((id) => (
                    <input key={id} type="hidden" name="product" value={id} />
                  ))}
                  {request.dropScenes.map((index) => (
                    <input
                      key={index}
                      type="hidden"
                      name="drop"
                      value={index}
                    />
                  ))}
                  {(["pose", "hookText", "ctaText"] as const).map((name) =>
                    request[name] ? (
                      <input
                        key={name}
                        type="hidden"
                        name={name}
                        value={request[name]}
                      />
                    ) : null,
                  )}
                  <button type="submit" className="admin-btn admin-btn-primary">
                    <Clapperboard size={16} aria-hidden="true" /> اطلبي تجهيز
                    الفيديو
                  </button>
                </form>
              ) : null}
            </>
          )}
        </section>
      </div>

      <section className="admin-panel" aria-labelledby="reel-renders-title">
        <h2 id="reel-renders-title">الريلز المطلوبة</h2>
        {renders.length ? (
          <ul className="social-renders">
            {renders.map((render) => (
              <li key={render.id} className="social-render">
                {render.status === "ready" &&
                render.videoUrl &&
                !render.outdated ? (
                  <video
                    src={render.videoUrl}
                    poster={render.frameUrls[1] ?? render.frameUrls[0]}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    width={270}
                    height={480}
                  />
                ) : null}
                <div>
                  <strong>
                    {reelConceptLabels[
                      render.concept as keyof typeof reelConceptLabels
                    ] ?? render.concept}
                  </strong>{" "}
                  · {render.seconds} ثانية{" "}
                  <StatusPill
                    tone={
                      render.status === "ready"
                        ? "ok"
                        : render.status === "failed"
                          ? "danger"
                          : "info"
                    }
                    Icon={Clapperboard}
                  >
                    {statusText[render.status] ?? render.status}
                  </StatusPill>
                  <p className="admin-muted">
                    طُلب <StoreTime value={render.createdAt} />
                    {render.status === "rendering" || render.attempts > 0
                      ? ` · المحاولة ${render.attempts} من ${MAX_RENDER_ATTEMPTS}`
                      : ""}
                  </p>
                  {render.errorCode ? (
                    <p className="admin-muted">
                      {errorText[render.errorCode] ?? render.errorCode}
                    </p>
                  ) : null}
                  {render.outdated ? (
                    <p className="admin-form-warning" role="status">
                      تغيّر سعر أو منتج بهالريل بعد ما تجهّز، فوقفناه عشان ما
                      يطلع بأسعار قديمة. اطلبي ريل جديد من اللوحة.
                    </p>
                  ) : null}
                  {render.status === "ready" &&
                  render.videoUrl &&
                  !render.outdated ? (
                    <a
                      className="admin-btn admin-btn-secondary"
                      href={`/admin/api/social/reels/${render.id}/video`}
                      download
                    >
                      <Download size={16} aria-hidden="true" /> نزّلي الفيديو
                    </a>
                  ) : null}
                  {render.status === "failed" &&
                  canPrepare &&
                  !FINAL_ERRORS.has(render.errorCode ?? "") ? (
                    <form action={retryReelRenderAction}>
                      <input type="hidden" name="id" value={render.id} />
                      <button
                        type="submit"
                        className="admin-btn admin-btn-secondary"
                      >
                        <RotateCcw size={16} aria-hidden="true" /> أعيدي
                        المحاولة
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">
            لا ريلز مطلوبة بعد. عامل الفيديو يعمل فقط عندما تشغّلينه.
          </p>
        )}
      </section>
    </main>
  );
}
