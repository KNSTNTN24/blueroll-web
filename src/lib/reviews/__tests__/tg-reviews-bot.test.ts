/* eslint-disable @typescript-eslint/no-explicit-any -- loose Telegram/PostgREST payloads in test doubles */
import { describe, it, expect } from 'vitest'
import { parseReviewsUpdate, handleReviewsEvent, checkReviewGroupPermissions, RV_TEXT, type RvEvent } from '../../../../supabase/functions/_shared/reviews/tg-reviews-bot'
import { ACTION_TEXT } from '../../../../supabase/functions/_shared/reviews/actions'
import { fakeGroupDeps } from '../../whatsapp/__tests__/fakes/group-deps'
import { fakeCtx, mkReview, NOW } from './fakes/review-deps'

// The checks-bot fake knows business 'b' only; the reviews fakes use 'b1' (and 'b2' for a relink).
const RV_INIT = { ready: { b1: true, b2: true }, businessNames: { b1: 'Fern & Fig', b2: 'Other Co' } }
const GROUP_ROW = { id: 'gr1', business_id: 'b1', channel: 'telegram' as const, chat_id: '-100', title: 'Managers', alerts: false, unlinked_at: null, linked_by: 'm1', perm_check: null, perm_warn: null }
let n = 0
const id = () => `u${++n}`
const member = (status = 'member') => (m: string) => (m === 'getChatMember' ? { result: { status } } : undefined)
const cb = (data: string, o: Partial<Extract<RvEvent, { kind: 'callback' }>> = {}): RvEvent => ({ kind: 'callback', callbackId: 'cq1', chatId: '-100', messageId: '7', userId: '42', userName: 'Anna S.', data, id: id(), ...o })
const answers = (calls: { method: string; body: any }[]) => calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text ?? '')

function setup(o: { status?: string; replies?: (string | null)[]; tgStatus?: string; tg?: (m: string) => any } = {}) {
  const r = mkReview({ status: (o.status ?? 'drafted') as any })
  const f = fakeCtx({
    reviews: [r], drafts: [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi Sarah', source: 'ai', author_name: null, created_at: '' }],
    cards: [{ review_id: r.id, chat_id: '-100', message_id: '7', group_id: 'gr1' }],
  }, { replies: o.replies, tg: o.tg ?? member(o.tgStatus) })
  const { d: g } = fakeGroupDeps({ ...RV_INIT,  groups: [{ ...GROUP_ROW }] })
  g.now = () => NOW   // the bot reads the clock from GroupDeps; keep it on the reviews fakes' NOW
  return { r, g, ...f }
}

describe('parseReviewsUpdate', () => {
  it('commands for this bot only', () => {
    const msg = (text: string) => ({ update_id: 1, message: { chat: { id: -100, type: 'supergroup', title: 'Managers' }, from: { id: 42, first_name: 'Anna' }, text } })
    expect(parseReviewsUpdate(msg('/link@BluerollReviewsBot 123456'))).toEqual([{ kind: 'command', chatId: '-100', chatTitle: 'Managers', userId: '42', command: 'link', arg: '123456', id: '1' }])
    expect(parseReviewsUpdate(msg('/pending'))[0]).toMatchObject({ command: 'pending' })
    expect(parseReviewsUpdate(msg('/link@BluerollChecksBot 123456'))).toEqual([])
    expect(parseReviewsUpdate(msg('/checks'))).toEqual([])
  })
  it('callback queries from groups', () => {
    const u = { update_id: 2, callback_query: { id: 'cq1', from: { id: 42, first_name: 'Anna', last_name: 'Smith' }, data: 'rv:p:x:1', message: { message_id: 7, chat: { id: -100, type: 'group' } } } }
    expect(parseReviewsUpdate(u)).toEqual([{ kind: 'callback', callbackId: 'cq1', chatId: '-100', messageId: '7', userId: '42', userName: 'Anna S.', data: 'rv:p:x:1', id: '2' }])
  })
  it('replies to a bot message', () => {
    const u = { update_id: 3, message: { message_id: 9, chat: { id: -100, type: 'group' }, from: { id: 42, first_name: 'Anna' }, text: 'New text', reply_to_message: { message_id: 8, from: { is_bot: true, username: 'BluerollReviewsBot' } } } }
    expect(parseReviewsUpdate(u)).toEqual([{ kind: 'reply', chatId: '-100', messageId: '9', replyTo: '8', userId: '42', userName: 'Anna', text: 'New text', id: '3' }])
  })
  it('bot removed, migration, private', () => {
    expect(parseReviewsUpdate({ update_id: 4, my_chat_member: { chat: { id: -100, type: 'group' }, new_chat_member: { status: 'kicked' } } })).toEqual([{ kind: 'bot_removed', chatId: '-100', id: '4' }])
    expect(parseReviewsUpdate({ update_id: 5, message: { chat: { id: -100, type: 'group' }, from: { id: 1 }, migrate_to_chat_id: -1009 } })).toEqual([{ kind: 'migrated', chatId: '-100', newChatId: '-1009', id: '5' }])
    expect(parseReviewsUpdate({ update_id: 6, message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'hi' } })).toEqual([{ kind: 'private', chatId: '42', id: '6' }])
  })
  it('garbage → []', () => expect(parseReviewsUpdate({ nope: 1 })).toEqual([]))
})

describe('/link', () => {
  const CODE = { code: '482913', business_id: 'b1', issued_by: 'm1', expires_at: '2026-10-15T13:40:00Z', used_at: null }
  const cmd = (arg: string): RvEvent => ({ kind: 'command', chatId: '-100', chatTitle: 'Managers', userId: '42', command: 'link', arg, id: id() })
  it('valid code → linked as a reviews group, reply, permission check', async () => {
    const { ctx, calls } = fakeCtx({}, { tg: (m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: false } } } : undefined) })
    const { d: g, s } = fakeGroupDeps({ ...RV_INIT,  groups: [], codes: [{ ...CODE }] })
    g.now = () => NOW
    await handleReviewsEvent(cmd('482913'), g, ctx)
    expect(s.groups).toEqual([expect.objectContaining({ business_id: 'b1', chat_id: '-100', title: 'Managers' })])
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text)).toEqual([RV_TEXT.linked('Fern & Fig')])
  })
  it('/link to another business drops old routes (Review Focus 3)', async () => {
    // The fake's default group 'g1' (chat -1001) belongs to business 'b'; the code is for business 'b2'.
    const { ctx, s: rs } = fakeCtx({ routes: [{ site_id: 's1', group_id: 'g1' }] })
    const { d: g } = fakeGroupDeps({ ...RV_INIT,  codes: [{ ...CODE, business_id: 'b2' }] })
    g.now = () => NOW
    await handleReviewsEvent({ kind: 'command', chatId: '-1001', chatTitle: 'Managers', userId: '42', command: 'link', arg: '482913', id: id() }, g, ctx)
    expect(rs.routes).toEqual([])
  })
  it('bad usage and invalid code', async () => {
    const { ctx, calls } = fakeCtx()
    const { d: g } = fakeGroupDeps({ ...RV_INIT,  groups: [], codes: [] })
    await handleReviewsEvent(cmd('12'), g, ctx)
    await handleReviewsEvent(cmd('999999'), g, ctx)
    expect(calls.map((c) => c.body.text)).toEqual([RV_TEXT.linkUsage, RV_TEXT.linkInvalid])
  })
})

describe('callbacks', () => {
  it('Publish → confirm on this card only; Yes within 60 s publishes', async () => {
    const { r, g, ctx, s, calls } = setup()
    await handleReviewsEvent(cb(`rv:p:${r.id}:1`), g, ctx)
    const confirm = calls.find((c) => c.method === 'editMessageText')!
    expect(confirm.body.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['✅ Yes, publish', 'Cancel'])
    const yes = confirm.body.reply_markup.inline_keyboard[0][0].callback_data
    await handleReviewsEvent(cb(yes), g, ctx)
    expect(s.reviews[0]).toMatchObject({ status: 'published', published_by_name: 'Anna S.' })
    expect(answers(calls)).toEqual(['', ACTION_TEXT.published])
  })
  it('Yes after 60 s → card back to normal, alert', async () => {
    const { r, g, ctx, s, calls } = setup()
    const old = Math.floor(NOW.getTime() / 1000) - 61
    await handleReviewsEvent(cb(`rv:y:${r.id}:1:${old}`), g, ctx)
    expect(s.reviews[0].status).toBe('drafted')
    expect(answers(calls)).toEqual([RV_TEXT.confirmTimeout])
  })
  it('Cancel → card back to normal', async () => {
    const { r, g, ctx, calls } = setup()
    await handleReviewsEvent(cb(`rv:c:${r.id}:1`), g, ctx)
    expect(calls.find((c) => c.method === 'editMessageText')!.body.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['✅ Publish', '✏️ Edit'])
  })
  it('press for an old draft version → stale alert, nothing changes', async () => {
    const { r, g, ctx, s, calls } = setup()
    await handleReviewsEvent(cb(`rv:p:${r.id}:0`), g, ctx)
    expect(answers(calls)).toEqual([ACTION_TEXT.stale])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('someone who left the group is refused', async () => {
    const { r, g, ctx, s, calls } = setup({ tgStatus: 'left' })
    await handleReviewsEvent(cb(`rv:s:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([RV_TEXT.notMember])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('restricted but still a member may press', async () => {
    const { r, g, ctx, s } = fakeCtxWithRestricted()
    await handleReviewsEvent(cb(`rv:s:${r.id}:1`), g, ctx)
    expect(s.reviews[0].status).toBe('skipped')
  })
  it('a review of another business is never touched from this group', async () => {
    const { r, g, ctx, s, calls } = setup()
    s.reviews[0].business_id = 'OTHER'
    await handleReviewsEvent(cb(`rv:s:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([ACTION_TEXT.gone])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('Skip, Another', async () => {
    const a = setup()
    await handleReviewsEvent(cb(`rv:s:${a.r.id}:1`), a.g, a.ctx)
    expect(a.s.reviews[0]).toMatchObject({ status: 'skipped', skipped_by_name: 'Anna S.' })
    const b = setup({ replies: ['Second take'] })
    await handleReviewsEvent(cb(`rv:a:${b.r.id}:1`), b.g, b.ctx)
    expect(b.s.drafts.at(-1)).toMatchObject({ draft_version: 2, text: 'Second take' })
  })
  it('Edit → force-reply prompt; the author\'s reply becomes draft n+1; someone else\'s reply is ignored', async () => {
    const { r, g, ctx, s, calls } = setup()
    await handleReviewsEvent(cb(`rv:e:${r.id}:1`), g, ctx)
    const prompt = calls.find((c) => c.method === 'sendMessage')!
    expect(prompt.body).toMatchObject({ chat_id: '-100', text: RV_TEXT.editPrompt('Sarah K.'), reply_markup: { force_reply: true, selective: true }, reply_parameters: { message_id: 7 } })
    expect(s.prompts).toEqual([expect.objectContaining({ chat_id: '-100', review_id: r.id, user_id: '42', card_message_id: '7' })])
    const promptId = s.prompts[0].prompt_message_id
    await handleReviewsEvent({ kind: 'reply', chatId: '-100', messageId: '20', replyTo: promptId, userId: '99', userName: 'Bob', text: 'Hijack', id: id() }, g, ctx)
    expect(s.drafts).toHaveLength(1)
    await handleReviewsEvent({ kind: 'reply', chatId: '-100', messageId: '21', replyTo: promptId, userId: '42', userName: 'Anna S.', text: 'Hi Sarah — sorry about the wait.', id: id() }, g, ctx)
    expect(s.drafts.at(-1)).toMatchObject({ draft_version: 2, source: 'edited', text: 'Hi Sarah — sorry about the wait.', author_name: 'Anna S.' })
    expect(s.prompts).toEqual([])
    expect(calls.filter((c) => c.method === 'deleteMessage').map((c) => c.body.message_id)).toEqual([Number(promptId), 21])
  })
  it('an expired edit prompt says so', async () => {
    const { r, g, ctx, s, calls } = setup()
    s.prompts.push({ chat_id: '-100', prompt_message_id: '50', card_message_id: '7', review_id: r.id, review_version: 1, user_id: '42', expires_at: '2026-10-15T13:00:00Z' })
    await handleReviewsEvent({ kind: 'reply', chatId: '-100', messageId: '21', replyTo: '50', userId: '42', userName: 'Anna', text: 'x', id: id() }, g, ctx)
    expect(calls.at(-1)!.body.text).toBe(RV_TEXT.editTimeout)
    expect(s.drafts).toHaveLength(1)
  })
  it('unknown callback data → quiet answer', async () => {
    const { g, ctx, calls } = setup()
    await handleReviewsEvent(cb('cl:junk'), g, ctx)
    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery'])
  })
})

describe('/pending, bot removed, migration, permissions', () => {
  it('/pending reposts open reviews of the routed sites to this chat', async () => {
    const { g, ctx, s, calls } = setup()
    await handleReviewsEvent({ kind: 'command', chatId: '-100', chatTitle: 'Managers', userId: '42', command: 'pending', arg: '', id: id() }, g, ctx)
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
    expect(s.cards).toHaveLength(2)
  })
  it('/pending with nothing open', async () => {
    const { g, ctx, s, calls } = setup({ status: 'published' })
    s.reviews[0].published_by_name = 'Anna'
    await handleReviewsEvent({ kind: 'command', chatId: '-100', chatTitle: 'Managers', userId: '42', command: 'pending', arg: '', id: id() }, g, ctx)
    expect(calls.map((c) => c.body.text)).toEqual([RV_TEXT.nothingPending])
  })
  it('bot removed → unlinked and routes gone; migration moves cards', async () => {
    const { g, ctx, s } = setup()
    await handleReviewsEvent({ kind: 'migrated', chatId: '-100', newChatId: '-1009', id: id() }, g, ctx)
    expect(s.cards[0].chat_id).toBe('-1009')
    const h = setup()
    await handleReviewsEvent({ kind: 'bot_removed', chatId: '-100', id: id() }, h.g, h.ctx)
    expect(h.s.routes).toEqual([])
  })
  it('daily permission warning uses the reviews wording and notifies review managers', async () => {
    const { g, ctx, s, calls } = fakeCtxWithInvite()
    expect(await checkReviewGroupPermissions(g, ctx, { id: 'gr1', business_id: 'b1', channel: 'telegram_reviews', chat_id: '-100', title: 'Managers', alerts: false }, NOW)).toBe('warned')
    expect(calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text)).toEqual([RV_TEXT.permissionWarning])
    expect(s.notes).toEqual([expect.objectContaining({ user_id: 'm1', title: 'Reviews group is open to new members' })])
  })
})

describe('callback guards (fix round 1)', () => {
  it('Telegram error on getChatMember → telegramDown alert, nothing changes', async () => {
    const { r, g, ctx, s, calls } = setup({ tg: (m) => (m === 'getChatMember' ? { ok: false, status: 500, description: 'boom' } : undefined) })
    await handleReviewsEvent(cb(`rv:s:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([RV_TEXT.telegramDown])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('kicked member → notMember', async () => {
    const { r, g, ctx, s, calls } = setup({ tgStatus: 'kicked' })
    await handleReviewsEvent(cb(`rv:s:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([RV_TEXT.notMember])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('the same update handled twice acts once', async () => {
    const { r, g, ctx, s, calls } = setup()
    const e = cb(`rv:s:${r.id}:1`)
    await handleReviewsEvent(e, g, ctx)
    await handleReviewsEvent(e, g, ctx)
    expect(s.audits.filter((a) => a.action === 'skipped')).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'editMessageText')).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'answerCallbackQuery')).toHaveLength(1)
  })
  it('stale draft version is refused for Another and Edit', async () => {
    const a = setup()
    await handleReviewsEvent(cb(`rv:a:${a.r.id}:0`), a.g, a.ctx)
    expect(answers(a.calls)).toEqual([ACTION_TEXT.stale])
    expect(a.s.drafts).toHaveLength(1)
    const e = setup()
    await handleReviewsEvent(cb(`rv:e:${e.r.id}:0`), e.g, e.ctx)
    expect(answers(e.calls)).toEqual([ACTION_TEXT.stale])
    expect(e.s.prompts).toEqual([])
  })
  it('Yes within 60 s with a stale draft version → stale, review unchanged', async () => {
    const { r, g, ctx, s, calls } = setup()
    await handleReviewsEvent(cb(`rv:y:${r.id}:0:${Math.floor(NOW.getTime() / 1000)}`), g, ctx)
    expect(answers(calls)).toEqual([ACTION_TEXT.stale])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('Yes without a timestamp → confirmTimeout, nothing published', async () => {
    const { r, g, ctx, s, calls } = setup()
    await handleReviewsEvent(cb(`rv:y:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([RV_TEXT.confirmTimeout])
    expect(s.reviews[0].status).toBe('drafted')
  })
  it('force-reply prompt that fails to send → telegramDown alert, no prompt saved', async () => {
    const { r, g, ctx, s, calls } = setup({ tg: (m) => (m === 'getChatMember' ? { result: { status: 'member' } } : m === 'sendMessage' ? { ok: false, status: 500, description: 'x', result: undefined } : undefined) })
    await handleReviewsEvent(cb(`rv:e:${r.id}:1`), g, ctx)
    expect(answers(calls)).toEqual([RV_TEXT.telegramDown])
    expect(s.prompts).toEqual([])
  })
  const prompt = (r: { id: string }) => ({ chat_id: '-100', prompt_message_id: '50', card_message_id: '7', review_id: r.id, review_version: 1, user_id: '42', expires_at: '2026-10-15T14:00:00Z' })
  const reply = (): RvEvent => ({ kind: 'reply', chatId: '-100', messageId: '21', replyTo: '50', userId: '42', userName: 'Anna', text: 'New text', id: id() })
  it('edit reply for a review of another business is ignored', async () => {
    const { r, g, ctx, s } = setup()
    s.prompts.push(prompt(r)); s.reviews[0].business_id = 'OTHER'
    await handleReviewsEvent(reply(), g, ctx)
    expect(s.drafts).toHaveLength(1)
  })
  it('edit reply after the review moved to a new version → stale sent to the chat, no draft', async () => {
    const { r, g, ctx, s, calls } = setup()
    s.prompts.push(prompt(r)); s.reviews[0].version = 2
    await handleReviewsEvent(reply(), g, ctx)
    expect(s.drafts).toHaveLength(1)
    expect(calls.at(-1)!.body.text).toBe(ACTION_TEXT.stale)
  })
})

function fakeCtxWithRestricted() {
  const r = mkReview({ status: 'drafted' })
  const f = fakeCtx({ reviews: [r], drafts: [{ id: 'd1', review_id: r.id, review_version: 1, draft_version: 1, text: 'Hi', source: 'ai', author_name: null, created_at: '' }] },
    { tg: (m) => (m === 'getChatMember' ? { result: { status: 'restricted', is_member: true } } : undefined) })
  const { d: g } = fakeGroupDeps({ ...RV_INIT,  groups: [{ ...GROUP_ROW }] })
  return { r, g, ...f }
}
function fakeCtxWithInvite() {
  const f = fakeCtx({}, { tg: (m) => (m === 'getChat' ? { result: { permissions: { can_invite_users: true } } } : undefined) })
  const { d: g } = fakeGroupDeps({ ...RV_INIT,  groups: [{ ...GROUP_ROW }] })
  return { g, ...f }
}

describe('entitlement on every bot action (I4)', () => {
  const notReady = (o: Parameters<typeof setup>[0] = {}) => { const a = setup(o); a.g.ready = async () => false; return a }
  it('a card press for a business that is not ready → unavailable alert, nothing else', async () => {
    for (const act of ['p', 'y', 'c', 's', 'a', 'e']) {
      const { r, g, ctx, s, calls, inputs } = notReady({ replies: ['Second take'] })
      const at = Math.floor(NOW.getTime() / 1000)
      await handleReviewsEvent(cb(act === 'y' ? `rv:y:${r.id}:1:${at}` : `rv:${act}:${r.id}:1`), g, ctx)
      expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery'])
      expect(calls[0].body).toMatchObject({ text: RV_TEXT.unavailable, show_alert: true })
      expect(s.reviews[0].status).toBe('drafted')
      expect(s.drafts).toHaveLength(1)
      expect(s.prompts).toEqual([])
      expect(inputs).toEqual([])
    }
  })
  it('an edit reply for a business that is not ready → unavailable, no new draft', async () => {
    const { r, g, ctx, s, calls } = notReady()
    s.prompts.push({ chat_id: '-100', prompt_message_id: '50', card_message_id: '7', review_id: r.id, review_version: 1, user_id: '42', expires_at: '2026-10-15T14:00:00Z' })
    await handleReviewsEvent({ kind: 'reply', chatId: '-100', messageId: '21', replyTo: '50', userId: '42', userName: 'Anna', text: 'New text', id: id() }, g, ctx)
    expect(calls.map((c) => c.body.text)).toEqual([RV_TEXT.unavailable])
    expect(s.drafts).toHaveLength(1)
  })
  it('/pending for a business that is not ready → unavailable before any drafting', async () => {
    const { g, ctx, s, calls, inputs } = notReady({ status: 'new' })
    s.drafts = []
    await handleReviewsEvent({ kind: 'command', chatId: '-100', chatTitle: 'Managers', userId: '42', command: 'pending', arg: '', id: id() }, g, ctx)
    expect(calls.map((c) => c.body.text)).toEqual([RV_TEXT.unavailable])
    expect(inputs).toEqual([])
  })
})
