export interface AudioType {
  mimeType: string;
  extension: string;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

// Recorder output is identified from its container signature, not from the browser's label.
export function detectAudioType(bytes: Uint8Array): AudioType | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mimeType: "audio/webm", extension: "webm" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }
  if (ascii(bytes, 0, 4) === "OggS") {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  return null;
}
