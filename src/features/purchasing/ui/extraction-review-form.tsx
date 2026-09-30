"use client";

import { useActionState } from "react";

import {
  confirmExtractionAction,
  discardExtractionAction,
} from "@/features/inventory/application/inventory-actions";
import type { PurchaseSource } from "@/features/purchasing/domain/purchase-constants";
import type { PurchaseDraft } from "@/features/purchasing/domain/purchase-draft";

import { PurchaseForm, type PurchaseVariantOption } from "./purchase-form";

export function ExtractionReviewForm({
  jobId,
  source,
  variants,
  suppliers,
  initialDraft,
}: {
  jobId: string;
  source: PurchaseSource;
  variants: readonly PurchaseVariantOption[];
  suppliers: readonly { id: string; nameAr: string }[];
  initialDraft: PurchaseDraft;
}) {
  return (
    <PurchaseForm
      variants={variants}
      suppliers={suppliers}
      initialDraft={initialDraft}
      source={source}
      extractionJobId={jobId}
      onPosted={async (payload) => {
        const response = await confirmExtractionAction(jobId, payload);
        return response.ok
          ? { ok: true, result: response.result }
          : { ok: false, message: response.message };
      }}
    />
  );
}

export function DiscardExtractionForm({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(
    discardExtractionAction,
    null,
  );
  return (
    <form action={action} className="admin-form">
      <input type="hidden" name="jobId" value={jobId} />
      {state ? (
        <p
          className={state.ok ? "admin-form-success" : "admin-form-error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        className="admin-btn admin-btn-ghost"
        disabled={pending || state?.ok}
      >
        تجاهل هذه المراجعة دون حفظ
      </button>
    </form>
  );
}
