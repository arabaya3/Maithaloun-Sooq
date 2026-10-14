/** One customer message as delivered by a WhatsApp provider (or the simulator). */
export interface InboundMessage {
  provider: string;
  providerMessageId: string;
  fromE164: string;
  text: string;
  receivedAt: Date;
}

/** Sends a text reply. Implementations: the simulator (stores only) and a Cloud API compatible sender. */
export interface MessageSender {
  readonly provider: string;
  sendText(
    toE164: string,
    text: string,
  ): Promise<{ providerMessageId: string | null }>;
}
