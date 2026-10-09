import { describe, it, expect } from 'vitest'
import { whatsappUI, telegramUI } from '../../../../supabase/functions/_shared/channels/ui'
import { textMessage, buttonsMessage, flowMessage, templateMessage } from '../../../../supabase/functions/_shared/channels/whatsapp'
import { tgText, tgButtons } from '../../../../supabase/functions/_shared/channels/telegram'

const ALERT = { siteName: 'Wharf Side', itemName: 'Walk-in fridge', value: '9 °C', time: '10:42', byName: 'Anna', action: 'Moved food to another fridge' }
const BTNS = [{ id: 'fill:t1:s1', title: 'Fridge temps' }, { id: 'fill:t2:s1', title: 'Opening checks' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }]

describe('whatsappUI', () => {
  const ui = whatsappUI()
  it('text and choices equal the existing builders', () => {
    expect(ui.channel).toBe('whatsapp')
    expect(ui.text('447700900123', 'hello')).toEqual(textMessage('447700900123', 'hello'))
    expect(ui.choices('447700900123', 'Checks due', BTNS)).toEqual(buttonsMessage('447700900123', 'Checks due', BTNS))
  })
  it('form with flowId is the checklist Flow message; without flowId → null', () => {
    expect(ui.form('447700900123', { templateName: 'Fridge temps', token: 'tok', flowId: 'F1' }))
      .toEqual(flowMessage('447700900123', { flowId: 'F1', token: 'tok', cta: 'Fill in', body: 'Fridge temps', screen: 'CHECKLIST' }))
    expect(ui.form('447700900123', { templateName: 'Fridge temps', token: 'tok' })).toBeNull()
  })
  it('corrective is the corrective Flow message', () => {
    expect(ui.corrective('447700900123', { token: 'ct', flowId: 'FC', itemName: 'Walk-in fridge', valueText: '9 °C (limit 0–5 °C)' }))
      .toEqual(flowMessage('447700900123', { flowId: 'FC', token: 'ct', cta: 'Add action', body: 'Walk-in fridge is out of range. Tell us what you did.', screen: 'CORRECTIVE',
        data: { item_name: 'Walk-in fridge', value_text: '9 °C (limit 0–5 °C)' } }))
  })
  it('managerAlert is the manager_alert template (sanitised params)', () => {
    const r = ui.managerAlert('447700900999', { ...ALERT, action: 'Moved\n food' })
    expect(r.templateName).toBe('manager_alert')
    expect(r.msg).toEqual(templateMessage('447700900999', 'manager_alert', ['Wharf Side', 'Walk-in fridge', '9 °C', '10:42', 'Anna', 'Moved\n food'], []))
    expect((r.msg as any).template.components[0].parameters[5].text).toBe('Moved food')
  })
  it('commandWord is upper-case', () => {
    expect(ui.commandWord('checks')).toBe('CHECKS')
    expect(ui.commandWord('stop')).toBe('STOP')
    expect(ui.commandWord('help')).toBe('HELP')
  })
})

describe('telegramUI', () => {
  const ui = telegramUI('https://app.blueroll.app/tg/form')
  it('text and choices (max 3)', () => {
    expect(ui.channel).toBe('telegram')
    expect(ui.text('42', 'hello')).toEqual(tgText('42', 'hello'))
    expect(ui.choices('42', 'Checks due', BTNS)).toEqual(tgButtons('42', 'Checks due', BTNS.slice(0, 3)))
  })
  it('form → web_app button to the Mini App with the token', () => {
    expect(ui.form('42', { templateName: 'Fridge temps', token: 'tok' })).toEqual({
      chat_id: '42', text: 'Fridge temps',
      reply_markup: { inline_keyboard: [[{ text: 'Fill in', web_app: { url: 'https://app.blueroll.app/tg/form?t=tok' } }]] },
    })
  })
  it('corrective → null', () => {
    expect(ui.corrective('42', { token: 'ct', flowId: 'FC', itemName: 'x', valueText: 'y' })).toBeNull()
  })
  it('managerAlert → plain text, no template', () => {
    const r = ui.managerAlert('42', ALERT)
    expect(r.templateName).toBeUndefined()
    expect(r.msg).toEqual({ chat_id: '42', text: '⚠ Wharf Side · Walk-in fridge 9 °C at 10:42 (Anna). Action: Moved food to another fridge. — via Blueroll' })
  })
  it('commandWord is a slash command', () => {
    expect(ui.commandWord('checks')).toBe('/checks')
    expect(ui.commandWord('stop')).toBe('/stop')
    expect(ui.commandWord('help')).toBe('/help')
  })
})
