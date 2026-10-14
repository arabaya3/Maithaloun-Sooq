"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";

import { SimulatorSender } from "../infrastructure/cloud-api";
import { liveSender, shopAssistantService } from "./shop-assistant-instance";

const PAGE = "/admin/whatsapp";
const idSchema = z.string().uuid();
const textSchema = z.string().trim().min(1).max(1000);

async function requireOwner() {
  const actor = await requireTrustedAdminMutation();
  if (actor.role !== "owner") redirect("/admin");
  return actor;
}

function back(conversationId?: string, notice?: string): never {
  const params = new URLSearchParams();
  if (conversationId) params.set("c", conversationId);
  if (notice) params.set("notice", notice);
  revalidatePath(PAGE);
  redirect(params.size ? `${PAGE}?${params}` : PAGE);
}

export async function setAssistantPausedAction(formData: FormData) {
  await requireOwner();
  const id = idSchema.safeParse(formData.get("conversationId"));
  if (!id.success) back();
  await shopAssistantService.setPaused(
    id.data,
    formData.get("paused") === "true",
  );
  back(id.data);
}

/** The owner answers a customer personally; the assistant stays paused for that customer. */
export async function ownerReplyAction(formData: FormData) {
  await requireOwner();
  const id = idSchema.safeParse(formData.get("conversationId"));
  const text = textSchema.safeParse(formData.get("text"));
  if (!id.success) back();
  if (!text.success) back(id.data, "empty");
  const conversation = await shopAssistantService.conversation(id.data);
  if (!conversation) back();
  const sender = conversation.isTest ? new SimulatorSender() : liveSender();
  if (!sender) back(id.data, "not-connected");
  await shopAssistantService.ownerReply(id.data, text.data, sender);
  back(id.data);
}

// The simulator talks to the real assistant and the real catalog; its orders are marked as test orders.
const SIMULATOR_CUSTOMER = "sim-owner";

export async function simulatorMessageAction(formData: FormData) {
  await requireOwner();
  const text = textSchema.safeParse(formData.get("text"));
  if (!text.success) back(undefined, "empty");
  await shopAssistantService.handleInbound(
    {
      provider: "simulator",
      providerMessageId: randomUUID(),
      fromE164: SIMULATOR_CUSTOMER,
      text: text.data,
      receivedAt: new Date(),
    },
    new SimulatorSender(),
  );
  const conversation = (await shopAssistantService.conversations(200)).find(
    (row) => row.customerE164 === SIMULATOR_CUSTOMER,
  );
  back(conversation?.id);
}
