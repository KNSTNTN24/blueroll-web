export type InboundEvent =
  | { kind: 'text'; from: string; text: string; id: string }
  | { kind: 'button'; from: string; payload: string; id: string }
  | { kind: 'flow'; from: string; token: string; response: Record<string, unknown>; id: string }
  /** A contact card shared with the bot: the first contact with a usable number (E.164 digits). */
  | { kind: 'contact'; from: string; name: string; phone: string; id: string }
export type OutboundMessage = Record<string, unknown>   // Cloud API /messages body
/** `errorCode`: Meta's `error.code` when the send failed (e.g. 131026 undeliverable, 132001 template missing). */
export interface SendResult { id: string | null; ok: boolean; status: number; errorCode?: number }
export type SendFn = (msg: OutboundMessage) => Promise<SendResult>
/** One entry of a webhook `statuses` array (sent / delivered / read / failed). */
export interface DeliveryStatus { id: string; recipient: string; status: string; errorCode: number | null }
