"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { assertPermission } from "@/features/admin/domain/permissions";
import { PostTransitionError } from "@/features/social/domain/post-lifecycle";
import { storeInstant } from "@/features/social/domain/content-plan";
import { MetaApiError } from "@/features/social/domain/meta-errors";
import { addDays, todayInStoreZone } from "@/shared/lib/store-time";

import { SocialError } from "./social-service";
import { socialEnabled, socialService } from "./social-instance";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function version(form: FormData): number {
  const value = Number(field(form, "version"));
  return Number.isInteger(value) && value > 0 ? value : -1;
}

function failureCode(error: unknown): string {
  if (error instanceof SocialError) {
    return error.blockers.length
      ? `blocked:${error.blockers.join(",")}`
      : error.code;
  }
  if (error instanceof AuthorizationError) return "forbidden";
  if (error instanceof PostTransitionError) return "invalid";
  if (error instanceof MetaApiError) return `meta_${error.failure.kind}`;
  throw error;
}

async function guarded(
  target: string,
  run: () => Promise<unknown>,
  done: string,
): Promise<never> {
  if (!socialEnabled()) notFound();
  let result = `done=${done}`;
  try {
    await run();
  } catch (error) {
    result = `error=${encodeURIComponent(failureCode(error))}`;
  }
  revalidatePath("/admin/social", "layout");
  redirect(`${target}${target.includes("?") ? "&" : "?"}${result}`);
}

const postPath = (id: string) =>
  `/admin/social/posts/${encodeURIComponent(id)}`;

export async function approvePostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () => socialService.approve(actor, id, version(form)),
    "approved",
  );
}

export async function unapprovePostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () => socialService.unapprove(actor, id, version(form)),
    "unapproved",
  );
}

export async function rejectPostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () => socialService.reject(actor, id, version(form)),
    "rejected",
  );
}

export async function reopenPostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () => socialService.reopen(actor, id, version(form)),
    "reopened",
  );
}

export async function retryPostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () =>
      socialService.retryFailed(actor, id, version(form), {
        confirmedAbsent: form.get("confirmedAbsent") === "on",
      }),
    "retrying",
  );
}

/** The owner settles a post whose Facebook result is unknown, after checking the Page. */
export async function resolveUncertainAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  const published = field(form, "outcome") === "published";
  return guarded(
    postPath(id),
    () =>
      socialService.resolveUncertain(
        actor,
        id,
        version(form),
        published
          ? { published: true, facebookPostId: field(form, "facebookPostId") }
          : { published: false },
      ),
    published ? "resolved_published" : "resolved_not_published",
  );
}

export async function rerenderPostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () => socialService.rerender(actor, id, version(form)),
    "rerender",
  );
}

export async function editCaptionAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  return guarded(
    postPath(id),
    () =>
      socialService.editCaption(
        actor,
        id,
        version(form),
        field(form, "caption"),
      ),
    "caption",
  );
}

export async function reschedulePostAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  const id = field(form, "id");
  const date = field(form, "date");
  const time = field(form, "time");
  return guarded(
    postPath(id),
    async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
        throw new SocialError("invalid");
      await socialService.reschedule(
        actor,
        id,
        version(form),
        storeInstant(date, time),
      );
    },
    "scheduled",
  );
}

export async function draftTwoWeeksAction() {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social",
    () =>
      socialService.draftPlan(actor, {
        startDate: addDays(todayInStoreZone(), 1),
        days: 14,
      }),
    "drafted",
  );
}

export async function renderPendingAction() {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social",
    async () => {
      // Rendering is a preparation step; viewing rights are not enough.
      assertPermission(actor, "social.prepare");
      await socialService.renderPending(6);
    },
    "rendered",
  );
}

export async function resolveCommentAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social/inbox",
    () => socialService.resolveComment(actor, field(form, "id")),
    "resolved",
  );
}

export async function sendHeldReplyAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social/inbox",
    () => socialService.sendHeldReply(actor, field(form, "id")),
    "replied",
  );
}

export async function saveSocialSettingsAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social/settings",
    () =>
      socialService.updateSettings(actor, {
        autoPublishApproved: form.get("autoPublishApproved") === "on",
        autoReplyFaq: form.get("autoReplyFaq") === "on",
        paused: form.get("paused") === "on",
      }),
    "settings",
  );
}

export async function connectTokenAction(form: FormData) {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social/settings",
    () =>
      socialService.connectPage(actor, {
        pageId: field(form, "pageId"),
        pageName: field(form, "pageName"),
        token: field(form, "token"),
      }),
    "connected",
  );
}

export async function disconnectAction() {
  const actor = await requireTrustedAdminMutation();
  return guarded(
    "/admin/social/settings",
    () => socialService.disconnect(actor),
    "disconnected",
  );
}
