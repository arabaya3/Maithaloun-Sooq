export const voiceCommandStatuses = [
  "needs_clarification",
  "review",
  "answered",
  "confirmed",
  "cancelled",
  "failed",
] as const;
export type VoiceCommandStatus = (typeof voiceCommandStatuses)[number];

export const voiceTranscriptSources = ["browser", "server", "typed"] as const;
export type VoiceTranscriptSource = (typeof voiceTranscriptSources)[number];

export const VOICE_PROMPT_VERSION = "voice-command-2026-09-30";
export const MAX_TRANSCRIPT_LENGTH = 600;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
