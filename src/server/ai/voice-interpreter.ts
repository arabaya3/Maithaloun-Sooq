import "server-only";

import {
  VOICE_INSTRUCTIONS,
  voiceJsonSchema,
  type VoiceInterpretation,
} from "@/features/voice/domain/voice-command";
import { normalizeArabicText } from "@/shared/lib/normalize-arabic";

import { isFakeAiEnabled } from "./fake-mode";
import { requestStructuredJson, transcribeAudio } from "./openai-client";

export interface VoiceInterpreter {
  readonly model: string;
  interpret(transcript: string): Promise<unknown>;
}

export interface SpeechTranscriber {
  transcribe(audio: {
    bytes: Buffer;
    mimeType: string;
    extension: string;
  }): Promise<string>;
}

function openAiInterpreter(): VoiceInterpreter {
  const model = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
  return {
    model,
    // Only the spoken sentence is sent: no catalog, prices, balances or customer list.
    interpret: (transcript) =>
      requestStructuredJson({
        model,
        schemaName: "voice_command",
        schema: voiceJsonSchema,
        instructions: VOICE_INSTRUCTIONS,
        content: [{ type: "input_text", text: transcript }],
        timeoutMs: 20_000,
      }),
  };
}

const numberWords: Record<string, string> = {
  واحد: "1",
  واحده: "1",
  عبوه: "1",
  اثنين: "2",
  ثنتين: "2",
  عبوتين: "2",
  كرتونتين: "2",
  ثلاث: "3",
  ثلاثه: "3",
  اربع: "4",
  اربعه: "4",
  خمس: "5",
  خمسه: "5",
  عشر: "10",
  عشره: "10",
  عشرين: "20",
  اربعين: "40",
};

const empty: VoiceInterpretation = {
  intent: "unknown",
  customerName: null,
  supplierName: null,
  items: [],
  payment: null,
  amount: null,
  adjustmentReason: null,
  reportMetric: null,
  period: null,
  clarification: null,
};

function fakePeriod(text: string): VoiceInterpretation["period"] {
  if (text.includes("اليوم")) return "today";
  if (text.includes("الشهر")) return "month";
  return "week";
}

function fakeItems(text: string): VoiceInterpretation["items"] {
  return text
    .split(/\s+و(?=\S)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [first = "", ...rest] = part.split(" ");
      const quantity = /^\d+$/.test(first)
        ? first
        : (numberWords[normalizeArabicText(first)] ?? null);
      return {
        name: (quantity ? rest : [first, ...rest]).join(" "),
        quantity,
        unit: null,
        unitPrice: null,
      };
    })
    .filter((item) => item.name);
}

// Small deterministic stand-in so development and browser tests run without an AI key.
const fakeInterpreter: VoiceInterpreter = {
  model: "fake-voice-model",
  async interpret(transcript) {
    const text = transcript
      .replace(/[.،؟?!]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/كم ربحت|الربح/.test(text)) {
      return {
        ...empty,
        intent: "query_report",
        reportMetric: "profit",
        period: fakePeriod(text),
      };
    }
    if (/اكثر منتج|أكثر منتج/.test(text)) {
      return {
        ...empty,
        intent: "query_report",
        reportMetric: "top_product",
        period: fakePeriod(text),
      };
    }
    if (/مين عليه|ديون/.test(text)) {
      return { ...empty, intent: "query_customer_balance" };
    }
    const payment = /^(?:سجلي?|سجّلي?) دفعة من (.+?) (\d+)/.exec(text);
    if (payment) {
      return {
        ...empty,
        intent: "record_payment",
        customerName: payment[1]!,
        amount: payment[2]!,
      };
    }
    const sale = /^بعت(?: ل(.+?))? (\S+ .+?)(?: و(دفع كامل|على الحساب))?$/.exec(
      text,
    );
    if (sale) {
      return {
        ...empty,
        intent: "create_sale",
        customerName: sale[1] ?? null,
        items: fakeItems(sale[2]!),
        payment: sale[3] === "على الحساب" ? "none" : "full",
      };
    }
    return {
      ...empty,
      clarification: "لم أفهم العملية. أعيدي قولها بجملة قصيرة.",
    };
  },
};

export function getVoiceInterpreter(): VoiceInterpreter {
  return isFakeAiEnabled() ? fakeInterpreter : openAiInterpreter();
}

export function getSpeechTranscriber(): SpeechTranscriber {
  if (isFakeAiEnabled()) {
    return { transcribe: async () => "كم ربحت هذا الأسبوع؟" };
  }
  return {
    // Audio is forwarded for transcription and discarded; it is never written to storage.
    transcribe: (audio) =>
      transcribeAudio({
        bytes: audio.bytes,
        mimeType: audio.mimeType,
        filename: `command.${audio.extension}`,
        model: process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
        language: "ar",
        timeoutMs: 30_000,
      }),
  };
}
