"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  MAX_RECORDING_MS,
  MIN_RECORDING_BYTES,
  voiceMessages,
  voiceReducer,
} from "../domain/voice-state";

const MAX_UPLOAD_BYTES = 4_000_000;

export function useVoiceRecorder(onTranscript: (transcript: string) => void) {
  const [state, dispatch] = useReducer(voiceReducer, { name: "idle" });
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const release = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    if (blob.size < MIN_RECORDING_BYTES) {
      dispatch({ type: "failed", message: voiceMessages.empty });
      return;
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      dispatch({ type: "failed", message: voiceMessages.tooLarge });
      return;
    }
    abortRef.current = new AbortController();
    try {
      const response = await fetch("/admin/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
        signal: abortRef.current.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        transcript?: string;
        message?: string;
      };
      if (!response.ok || !body.ok) {
        dispatch({
          type: "failed",
          message:
            body.message ??
            (response.status === 429
              ? "طلبات تسجيل كثيرة. انتظري قليلاً."
              : "تعذّر تحويل الصوت إلى نص. أعيدي المحاولة أو اكتبي الطلب."),
        });
        return;
      }
      const transcript = (body.transcript ?? "").trim();
      dispatch({ type: "transcribed", transcript });
      // The text goes into the editable composer; nothing is sent until the person sends it.
      if (transcript) {
        onTranscriptRef.current(transcript);
        dispatch({ type: "reset" });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      dispatch({
        type: "failed",
        message: navigator.onLine
          ? "تعذّر الوصول إلى الخادم. أعيدي المحاولة."
          : "لا يوجد اتصال بالإنترنت.",
      });
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      dispatch({ type: "stop" });
      recorder.stop();
    }
  }, []);

  // Permission is requested only here, after the person taps the microphone.
  const start = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      dispatch({ type: "unsupported" });
      return;
    }
    dispatch({ type: "start" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      dispatch({ type: "denied" });
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      release();
      recorderRef.current = null;
      if (discardRef.current) return;
      void transcribe(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorderRef.current = recorder;
    recorder.start();
    dispatch({ type: "granted", at: Date.now() });
    timerRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
  }, [release, stop, transcribe]);

  const cancel = useCallback(() => {
    discardRef.current = true;
    abortRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    release();
    dispatch({ type: "cancel" });
  }, [release]);

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  // The microphone never stays open in the background or after the panel closes.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      discardRef.current = true;
      abortRef.current?.abort();
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      release();
    };
  }, [cancel, release]);

  return { state, start, stop, cancel, reset };
}
