'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CHANNELS, issueLinkCode, revokeIdentity, type Channel } from '@/lib/whatsapp/client'

type ChannelProp = Channel

export function ChannelStatus({ channel, identity, onChanged, onConnect }: {
  channel: ChannelProp; identity: { id: string; external_id: string } | undefined; onChanged: () => void; onConnect: () => void
}) {
  const label = CHANNELS[channel].label
  if (!identity) return <button className="text-[12px] font-medium text-primary underline" onClick={onConnect}>Connect {label}</button>
  return (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{label} {CHANNELS[channel].displayId(identity.external_id)}</span>
      <button className="text-muted-foreground underline" onClick={async () => {
        try { await revokeIdentity(identity.id); toast.success(`${label} disconnected`); onChanged() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
      }}>Disconnect</button>
    </span>
  )
}

export function ChannelConnectDialog({ channel, member, siteId, onClose }: {
  channel: ChannelProp; member: { id: string; full_name: string | null }; siteId: string | null; onClose: () => void
}) {
  const cfg = CHANNELS[channel]
  const [code, setCode] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [left, setLeft] = useState(15 * 60)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    issueLinkCode({ profileId: member.id, siteId })
      .then(async (c) => {
        if (!alive) return
        setCode(c)
        const link = cfg.buildLink(c)
        if (!link) { setNotConfigured(true); return }
        const url = await QRCode.toDataURL(link, { margin: 1, width: 240 })
        if (alive) setQr(url)
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [cfg, member.id, siteId, attempt])

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div role="alertdialog" aria-labelledby="channel-connect-error" className="w-[360px] rounded-2xl bg-card p-6 text-center shadow-xl">
          <h2 id="channel-connect-error" className="text-[17px] font-semibold">Couldn&apos;t create a {cfg.label} code</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">{error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => { setError(null); setCode(null); setQr(null); setNotConfigured(false); setLeft(15 * 60); setAttempt((n) => n + 1) }}>Retry</Button>
          </div>
        </div>
      </div>
    )
  }

  // No backdrop close: a stray click must not lose the QR code mid-scan — only Done closes it.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div role="dialog" aria-modal="true" className="w-[360px] rounded-2xl bg-card p-6 text-center shadow-xl">
        <h2 className="text-[17px] font-semibold">Connect {member.full_name || 'team member'} to {cfg.label}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {notConfigured ? cfg.codeInstruction : cfg.scanInstruction}
        </p>
        {qr ? <img src={qr} alt={`${cfg.label} connect QR code`} className="mx-auto my-4 h-[240px] w-[240px]" /> : notConfigured ? <div className="my-4" /> : <div className="my-4 h-[240px]" />}
        {code && <p className="font-mono text-[15px]">{cfg.codeText(code)}</p>}
        {notConfigured && <p className="mt-2 text-[12px] text-amber-700">{cfg.notConfiguredNote}</p>}
        <p className="mt-1 text-[12px] text-muted-foreground">
          {left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — close and try again'}
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">By connecting, they agree to receive checklist reminders from Blueroll on {cfg.label}. They can reply STOP at any time.</p>
        <Button className="mt-4" variant="outline" onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
