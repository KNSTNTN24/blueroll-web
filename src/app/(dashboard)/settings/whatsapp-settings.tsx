'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { Switch } from '@/components/ui/switch'
import type { Channel } from '@/lib/whatsapp/client'

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
  const on = !!(business as unknown as Record<string, unknown>)[column]
  const toggle = async (v: boolean) => {
    setBusy(true)
    const { error } = await supabase.from('businesses').update({ [column]: v }).eq('id', business.id)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setBusiness({ ...business, [column]: v })
    toast.success(v ? `${title} turned on` : `${title} turned off`)
  }
  return (
    <section data-channel={channel} className="rounded-xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={toggle} />
      </div>
    </section>
  )
}

export function WhatsAppSettings() {
  return (
    <ChannelToggle
      channel="whatsapp"
      column="whatsapp_enabled"
      title="WhatsApp checks"
      description="Staff get reminders before their checks are due and complete temperatures and opening/closing checks in WhatsApp. Connect people from the Team page."
    />
  )
}
