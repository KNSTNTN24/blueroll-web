// supabase/functions/_shared/channels/service-window.ts
// WhatsApp customer-service window: business-initiated messages are free (and free-form text is allowed) within 24 h
// of the person's last inbound message.
export const SERVICE_WINDOW_MS = 24 * 3600 * 1000
export const isBillable = (lastInboundAt: string | null | undefined, now: Date) =>
  !lastInboundAt || now.getTime() - new Date(lastInboundAt).getTime() >= SERVICE_WINDOW_MS
