export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string; callbackId?: string }   // callbackId: Telegram callback_query id (for answerCallbackQuery)
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
export type OutboundMessage = Record<string, unknown>   // Cloud API /messages body
export interface SendResult { id: string | null; ok: boolean; status: number }
export type SendFn = (msg: OutboundMessage) => Promise<SendResult>
