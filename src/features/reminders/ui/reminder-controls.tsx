"use client";

import { useActionState } from "react";

import {
  setDisputedAction,
  setSummaryFrequencyAction,
  snoozeReminderAction,
  type ReminderFormState,
} from "@/features/reminders/application/reminder-actions";
import {
  summaryFrequencies,
  summaryFrequencyLabels,
  type SummaryFrequency,
} from "@/features/reminders/domain/schedule-constants";

function Result({ state }: { state: ReminderFormState }) {
  return state ? (
    <p
      className={state.ok ? "admin-form-success" : "admin-form-error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  ) : null;
}

export function ReminderControls({
  customerId,
  snoozed,
  disputed,
}: {
  customerId: string;
  snoozed: boolean;
  disputed: boolean;
}) {
  const [snoozeState, snoozeAction, snoozing] = useActionState(
    snoozeReminderAction,
    null,
  );
  const [disputeState, disputeAction, disputing] = useActionState(
    setDisputedAction,
    null,
  );

  return (
    <div className="admin-stack">
      <form action={snoozeAction} className="admin-form-actions">
        <input type="hidden" name="customerId" value={customerId} />
        {snoozed ? (
          <button
            type="submit"
            name="days"
            value="0"
            className="admin-btn admin-btn-secondary"
            disabled={snoozing}
          >
            إعادة تفعيل التذكير
          </button>
        ) : (
          <>
            <button
              type="submit"
              name="days"
              value="7"
              className="admin-btn admin-btn-secondary"
              disabled={snoozing}
            >
              تأجيل أسبوع
            </button>
            <button
              type="submit"
              name="days"
              value="30"
              className="admin-btn admin-btn-secondary"
              disabled={snoozing}
            >
              تأجيل شهر
            </button>
          </>
        )}
      </form>
      <Result state={snoozeState} />

      <form action={disputeAction} className="admin-form">
        <input type="hidden" name="customerId" value={customerId} />
        <input
          type="hidden"
          name="disputed"
          value={disputed ? "false" : "true"}
        />
        {disputed ? null : (
          <label>
            سبب النزاع (اختياري)
            <input name="note" maxLength={240} />
          </label>
        )}
        <button
          type="submit"
          className="admin-btn admin-btn-ghost"
          disabled={disputing}
        >
          {disputed
            ? "إزالة علامة النزاع"
            : "الرصيد متنازع عليه — أوقفي التذكير"}
        </button>
      </form>
      <Result state={disputeState} />
    </div>
  );
}

export function SummaryFrequencyForm({
  frequency,
}: {
  frequency: SummaryFrequency;
}) {
  const [state, action, pending] = useActionState(
    setSummaryFrequencyAction,
    null,
  );
  return (
    <form action={action} className="admin-form">
      <fieldset className="admin-choice-group">
        <legend className="sr-only">موعد الملخصات</legend>
        {summaryFrequencies.map((item) => (
          <label key={item} className="admin-choice">
            <input
              type="radio"
              name="frequency"
              value={item}
              defaultChecked={item === frequency}
            />
            <span>{summaryFrequencyLabels[item]}</span>
          </label>
        ))}
      </fieldset>
      <Result state={state} />
      <button
        type="submit"
        className="admin-btn admin-btn-secondary"
        disabled={pending}
      >
        حفظ الموعد
      </button>
    </form>
  );
}
