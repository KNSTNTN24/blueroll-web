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
