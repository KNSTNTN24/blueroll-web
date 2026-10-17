/// <reference lib="deno.ns" />
// One-off: point @BluerollReviewsBot at its webhook and set its commands.
// TELEGRAM_REVIEWS_BOT_TOKEN=… TELEGRAM_REVIEWS_WEBHOOK_SECRET=… deno run --allow-env --allow-net scripts/setup-reviews-bot.ts
import { setupReviewsBot } from '../supabase/functions/_shared/reviews/tg-reviews-bot.ts'

const token = Deno.env.get('TELEGRAM_REVIEWS_BOT_TOKEN') ?? ''
const secret = Deno.env.get('TELEGRAM_REVIEWS_WEBHOOK_SECRET') ?? ''
if (!token || !secret) { console.error('set TELEGRAM_REVIEWS_BOT_TOKEN and TELEGRAM_REVIEWS_WEBHOOK_SECRET'); Deno.exit(1) }
const r = await setupReviewsBot({ token, secret, webhookUrl: 'https://rszrggreuarvodcqeqrj.supabase.co/functions/v1/telegram-reviews-webhook' })
console.log(r.ok ? 'ok' : r.errors.join('\n'))
