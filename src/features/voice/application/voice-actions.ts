"use server";

import { revalidatePath } from "next/cache";

import { voiceService } from "@/features/admin/application/admin-services";
import { allowAdminRequest } from "@/features/admin/auth/admin-rate-limit";
import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import type { VoiceOutcome } from "@/features/voice/application/voice-service";
import {
  voiceTranscriptSources,
  type VoiceTranscriptSource,
} from "@/features/voice/domain/voice-constants";

const RATE_LIMITED: VoiceOutcome = {
  kind: "failed",
  message:
    "عدد الأوامر كبير خلال ساعة. حاولي بعد قليل أو أدخلي العملية يدوياً.",
};

function revalidateAll() {
  revalidatePath("/admin", "layout");
}

export async function interpretVoiceAction(input: {
  transcript: string;
  source: string;
}): Promise<VoiceOutcome> {
  const actor = await requireTrustedAdminMutation();
  if (!(await allowAdminRequest(actor, "admin_voice_ai", 120))) {
    return RATE_LIMITED;
  }
  const source = (voiceTranscriptSources as readonly string[]).includes(
    input.source,
  )
    ? (input.source as VoiceTranscriptSource)
    : "typed";
  return voiceService.interpret(actor, {
    transcript: String(input.transcript ?? ""),
    source,
  });
}

export async function answerVoiceClarificationAction(input: {
  commandId: string;
  field: string;
  value: string;
}): Promise<VoiceOutcome> {
  const actor = await requireTrustedAdminMutation();
  return voiceService.answerClarification(actor, input);
}

export async function confirmVoicePaymentAction(
  commandId: string,
): Promise<VoiceOutcome> {
  const actor = await requireTrustedAdminMutation();
  const outcome = await voiceService.confirmPayment(actor, commandId);
  revalidateAll();
  return outcome;
}

export async function confirmVoiceAdjustmentAction(
  commandId: string,
): Promise<VoiceOutcome> {
  const actor = await requireTrustedAdminMutation();
  const outcome = await voiceService.confirmAdjustment(actor, commandId);
  revalidateAll();
  return outcome;
}

export async function markVoiceConfirmedAction(input: {
  commandId: string;
  entityType: "customer_invoice" | "purchase_invoice";
  entityId: string;
  edited: boolean;
}): Promise<void> {
  const actor = await requireTrustedAdminMutation();
  await voiceService.markConfirmed(actor, input);
}

export async function cancelVoiceCommandAction(
  commandId: string,
): Promise<void> {
  const actor = await requireTrustedAdminMutation();
  await voiceService.cancel(actor, commandId);
}
