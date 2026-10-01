export type VoiceState =
  | { name: "idle" }
  | { name: "requesting" }
  | { name: "listening"; startedAt: number }
  | { name: "transcribing" }
  | { name: "ready"; transcript: string }
  | { name: "failed"; message: string };

export type VoiceEvent =
  | { type: "start" }
  | { type: "granted"; at: number }
  | { type: "denied" }
  | { type: "unsupported" }
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "transcribed"; transcript: string }
  | { type: "failed"; message: string }
  | { type: "reset" };

export const MAX_RECORDING_MS = 60_000;
export const MIN_RECORDING_BYTES = 1_500;

export const voiceMessages = {
  denied:
    "لم يُسمح باستخدام الميكروفون. فعّليه من إعدادات المتصفح أو اكتبي الطلب.",
  unsupported: "هذا المتصفح لا يدعم التسجيل الصوتي. اكتبي الطلب بدلاً من ذلك.",
  empty: "لم ألتقط صوتاً واضحاً. سجّلي من جديد.",
  tooLarge: "التسجيل طويل جداً. سجّلي رسالة أقصر.",
} as const;

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "start":
      return state.name === "listening" || state.name === "transcribing"
        ? state
        : { name: "requesting" };
    case "granted":
      return state.name === "requesting"
        ? { name: "listening", startedAt: event.at }
        : state;
    case "denied":
      return { name: "failed", message: voiceMessages.denied };
    case "unsupported":
      return { name: "failed", message: voiceMessages.unsupported };
    case "stop":
      return state.name === "listening" ? { name: "transcribing" } : state;
    case "cancel":
    case "reset":
      return { name: "idle" };
    case "transcribed": {
      if (state.name !== "transcribing") return state;
      const transcript = event.transcript.trim();
      return transcript
        ? { name: "ready", transcript }
        : { name: "failed", message: voiceMessages.empty };
    }
    case "failed":
      return { name: "failed", message: event.message };
  }
}

export const voiceStatusLabels: Record<VoiceState["name"], string> = {
  idle: "",
  requesting: "جارٍ طلب إذن الميكروفون…",
  listening: "أستمع… اضغطي مرة ثانية للإيقاف",
  transcribing: "جارٍ تحويل الصوت إلى نص…",
  ready: "راجعي النص ثم أرسليه",
  failed: "",
};
