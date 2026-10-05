import "server-only";

import {
  amountProblemMessages,
  analyzeAmounts,
  checkStatedAmounts,
  suppliedAmounts,
} from "../domain/amount-guard";
import type { PrepareResult } from "./assistant-operations";
import type { AssistantToolContext } from "./assistant-tools";

// Conflicting, negative, uncertain, zero or unstated amounts never reach a card or a draft.
export function amountRefusal(
  context: AssistantToolContext,
  input: unknown,
): Extract<PrepareResult, { status: "rejected" }> | null {
  const found = checkStatedAmounts(
    context.ownerText?.() ?? "",
    suppliedAmounts(input),
  );
  if (!found) return null;
  const listed = found.values.length ? ` (${found.values.join(" أو ")})` : "";
  return {
    status: "rejected",
    code: found.problem,
    message: `${amountProblemMessages[found.problem]}${found.problem === "amount_conflict" ? listed : ""}`,
    values: found.values,
  };
}

export function missingAmountClarification(
  context: AssistantToolContext,
  question: string,
): Extract<PrepareResult, { status: "rejected" }> {
  const stated = analyzeAmounts(context.ownerText?.() ?? "");
  const values = [...new Set(stated.amounts.map((row) => row.agorot))].map(
    (agorot) =>
      `${agorot % 100 === 0 ? agorot / 100 : (agorot / 100).toFixed(2)} ₪`,
  );
  const problem = stated.negative
    ? "amount_negative"
    : stated.conflicting
      ? "amount_conflict"
      : stated.uncertain
        ? "amount_uncertain"
        : null;
  if (problem) {
    return {
      status: "rejected",
      code: problem,
      message: `${amountProblemMessages[problem]}${problem === "amount_conflict" && values.length ? ` (${values.join(" أو ")})` : ""}`,
      values,
    };
  }
  return {
    status: "rejected",
    code: "missing_required_field",
    message: question,
  };
}
