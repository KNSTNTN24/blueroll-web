// supabase/functions/_shared/reviews/web-api.ts
// reviews-action (spec §11 "Reviews page … same actions as the chat card"). The caller already holds manage_reviews in
// their business (caller.ts); every review is checked against that business. Pure over Ctx.
import { ACTION_TEXT, doAnother, doEdit, doPublish, doSkip, latestDraft, makeDraft, type ActionResult } from './actions.ts'
import type { Caller, ApiRes } from './connect.ts'
import type { Ctx } from './deps.ts'
import type { Actor } from './types.ts'

const res = (status: number, body: Record<string, unknown>): ApiRes => ({ status, body })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const STATUS: Record<string, number> = { failed: 502, draft_failed: 502, gone: 404, deleted: 410, cap: 429, too_long: 400, empty: 400 }

export async function handleReviewAction(ctx: Ctx, me: Caller, body: unknown): Promise<ApiRes> {
  if (!isObj(body) || typeof body.review_id !== 'string') return res(400, { error: 'body' })
  const r = await ctx.d.review(body.review_id)
  if (!r || r.business_id !== me.business_id) return res(404, { error: 'review' })
  const actor: Actor = { channel: 'web', profile_id: me.profile_id, external_id: null, name: me.name }
  let out: ActionResult
  switch (body.action) {
    case 'publish':
      if (typeof body.draft_version !== 'number') return res(400, { error: 'draft_version' })
      out = await doPublish(ctx, r.id, body.draft_version, actor)
      break
    case 'skip': out = await doSkip(ctx, r.id, actor); break
    case 'another': out = await doAnother(ctx, r.id, actor); break
    case 'edit':
      if (typeof body.text !== 'string' || typeof body.review_version !== 'number') return res(400, { error: 'text' })
      out = await doEdit(ctx, r.id, body.review_version, body.text, actor)
      break
    case 'draft': {
      if (await latestDraft(ctx, r)) return res(200, { ok: true, outcome: 'exists', text: '' })
      const d = await makeDraft(ctx, r, { actor })
      out = d && d !== 'cap' ? { ok: true, outcome: 'drafted', text: 'Draft ready' } : { ok: false, outcome: 'draft_failed', text: ACTION_TEXT.draftFailed }
      break
    }
    default: return res(400, { error: 'action' })
  }
  return res(out.ok ? 200 : STATUS[out.outcome] ?? 409, { ...out })
}
