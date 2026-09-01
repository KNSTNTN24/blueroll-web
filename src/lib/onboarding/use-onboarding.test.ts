// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { vi, expect, test, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

import { supabase } from '@/lib/supabase'
import { useOnboarding } from './use-onboarding'

beforeEach(() => {
  vi.clearAllMocks()
})

test('runBuild aggregates extracted checklists into onboard-build with no dishes (Phase 1)', async () => {
  ;(supabase.functions.invoke as any)
    .mockResolvedValueOnce({
      data: { checklists: [{ name: 'X', assigned_roles: ['manager'], items: [] }] },
    }) // onboard-extract-checks
    .mockResolvedValueOnce({ data: { templates: 1, dishes: 0 } }) // onboard-build

  const { result } = renderHook(() => useOnboarding())

  expect(result.current.step).toBe('checks')
  expect(result.current.status).toBe('idle')

  act(() => {
    result.current.addChecksText('We use a paper temperature log daily.')
  })

  await act(async () => {
    await result.current.runBuild()
  })

  expect(supabase.functions.invoke).toHaveBeenCalledTimes(2)

  const [firstCall, lastCall] = (supabase.functions.invoke as any).mock.calls
  expect(firstCall[0]).toBe('onboard-extract-checks')
  expect(firstCall[1].body.text).toBe('We use a paper temperature log daily.')

  expect(lastCall[0]).toBe('onboard-build')
  expect(lastCall[1].body.checklists).toHaveLength(1)
  expect(lastCall[1].body.dishes).toHaveLength(0)

  expect(result.current.status).toBe('done')
  expect(result.current.result).toEqual({ templates: 1, dishes: 0 })
})

test('runBuild sets status to error when extract-checks invoke fails', async () => {
  ;(supabase.functions.invoke as any).mockResolvedValueOnce({
    data: null,
    error: new Error('boom'),
  })

  const { result } = renderHook(() => useOnboarding())

  await act(async () => {
    await result.current.runBuild()
  })

  expect(result.current.status).toBe('error')
  expect(result.current.result).toBeNull()
  expect(supabase.functions.invoke).toHaveBeenCalledTimes(1)
})

test('generate → preview holds engine checklists; confirmBuild sends kept ones to onboard-build', async () => {
  (supabase.functions.invoke as any).mockReset()
  ;(supabase.functions.invoke as any)
    .mockResolvedValueOnce({ data: { checklists: [
      { name: 'Fridge & Freezer Temperature Record', frequency: 'daily', assigned_roles: ['manager'], items: [{}] },
      { name: 'Kitchen Opening Checks', frequency: 'daily', assigned_roles: ['manager'], items: [{}, {}] },
    ] } })                                                    // onboard-generate
    .mockResolvedValueOnce({ data: { templates: 1, dishes: 0 } }) // onboard-build
  const { result } = renderHook(() => useOnboarding())
  await act(async () => {
    await result.current.generate({ areas: ['kitchen'], kitchen: {
      fridges: [{ name: 'Fridge 1', kind: 'fridge' }], probeCount: 0, sinkCount: 1, cooking: [],
      routines: { opening: true, closing: false, cleaning: false, allergen: false } } })
  })
  expect(result.current.status).toBe('preview')
  expect(result.current.generated).toHaveLength(2)
  const genCall = (supabase.functions.invoke as any).mock.calls[0]
  expect(genCall[0]).toBe('onboard-generate')
  expect(genCall[1].body.briefs.length).toBeGreaterThan(0)
  await act(async () => { await result.current.confirmBuild([result.current.generated![0]]) })
  const buildCall = (supabase.functions.invoke as any).mock.calls.at(-1)
  expect(buildCall[0]).toBe('onboard-build')
  expect(buildCall[1].body.checklists).toHaveLength(1)
  expect(buildCall[1].body.dishes).toEqual([])
  expect(result.current.status).toBe('done')
})
