'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Switch } from '@/components/ui/switch'
import { channelAvailable, syncAllFlows, type Channel } from '@/lib/whatsapp/client'

interface ChannelToggleProps {
  channel: Channel
  column: 'whatsapp_enabled' | 'telegram_enabled'
  title: string
  description: string
}

/** Per-business on/off switch for a chat channel (DB guard: active owners/managers only). */
export function ChannelToggle({ channel, column, title, description }: ChannelToggleProps) {
  const business = useAuthStore((s) => s.business)
  const setBusiness = useAuthStore((s) => s.setBusiness)
  const [busy, setBusy] = useState(false)
  if (!business) return null
  const on = !!business[column]
  const toggle = async (v: boolean) => {
    setBusy(true)
    try {
      const { error } = await supabase.from('businesses').update({ [column]: v }).eq('id', business.id)
      if (error) { toast.error(error.message); return }
      setBusiness({ ...business, [column]: v })
      toast.success(v ? `${title} turned on` : `${title} turned off`)
      // Publish a WhatsApp form for every checklist now, not at the nightly sync (fire-and-forget, best effort).
      if (v && channel === 'whatsapp') void syncAllFlows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update setting')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section data-channel={channel} className="rounded-xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={`${channel}-toggle-title`} className="text-[15px] font-semibold">{title}</h2>
          <p id={`${channel}-toggle-desc`} className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={toggle} aria-labelledby={`${channel}-toggle-title`} aria-describedby={`${channel}-toggle-desc`} />
      </div>
    </section>
  )
}

export function WhatsAppSettings() {
  return (
    <div className="flex flex-col gap-4">
      {/* Hidden until the WhatsApp number is configured (NEXT_PUBLIC_WHATSAPP_NUMBER). */}
      {channelAvailable('whatsapp') && <ChannelToggle
        channel="whatsapp"
        column="whatsapp_enabled"
        title="WhatsApp checks"
        description="Staff get reminders before their checks are due and complete temperatures and opening/closing checks in WhatsApp. Connect people from the Team page."
      />}
      <ChannelToggle
        channel="telegram"
        column="telegram_enabled"
        title="Telegram checks"
        description="Staff get reminders and fill in checks in Telegram. Free."
      />
    </div>
  )
}
