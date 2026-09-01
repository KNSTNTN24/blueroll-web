// @vitest-environment jsdom
import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
afterEach(cleanup)
const generate = vi.fn().mockResolvedValue(undefined)
const confirmBuild = vi.fn().mockResolvedValue(undefined)
let hook: any = { generate, confirmBuild, generated: null, status: 'idle', result: null, errorMessage: null }
vi.mock('@/lib/onboarding/use-onboarding', () => ({ useOnboarding: () => hook }))
import { OnboardingQuestionnaire } from './onboarding-questionnaire'

test('pick kitchen, set a fridge count, continue → generate called with answers', async () => {
  render(<OnboardingQuestionnaire onBack={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /kitchen/i }))
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  // kitchen mini-questionnaire: bump fridges to 1 then continue through to generate
  fireEvent.click(screen.getByRole('button', { name: /create my checklists/i }))
  await act(async () => {})
  expect(generate).toHaveBeenCalled()
  const answers = generate.mock.calls[0][0]
  expect(answers.areas).toContain('kitchen')
})

test('preview lists generated checklists and Build calls confirmBuild with kept ones', async () => {
  hook = { generate, confirmBuild, status: 'preview', result: null, errorMessage: null,
    generated: [ { name: 'Fridge & Freezer Temperature Record', items: [{},{}] },
                 { name: 'Kitchen Opening Checks', items: [{}] } ] }
  render(<OnboardingQuestionnaire onBack={() => {}} />)
  expect(screen.getByText(/Fridge & Freezer Temperature Record/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /build/i }))
  await act(async () => {})
  expect(confirmBuild).toHaveBeenCalled()
  expect(confirmBuild.mock.calls[0][0]).toHaveLength(2)
})

test('preview drop path: unchecking a row builds only the kept checklists', async () => {
  confirmBuild.mockClear()
  hook = { generate, confirmBuild, status: 'preview', result: null, errorMessage: null,
    generated: [ { name: 'Fridge & Freezer Temperature Record', items: [{},{}] },
                 { name: 'Kitchen Opening Checks', items: [{}] } ] }
  render(<OnboardingQuestionnaire onBack={() => {}} />)
  const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
  // Drop the first checklist by unticking its keep-checkbox.
  fireEvent.click(checkboxes[0])
  fireEvent.click(screen.getByRole('button', { name: /build/i }))
  await act(async () => {})
  expect(confirmBuild).toHaveBeenCalled()
  const kept = confirmBuild.mock.calls[0][0]
  expect(kept).toHaveLength(1)
  expect(kept[0].name).toBe('Kitchen Opening Checks')
})

test('building state shows a loader and no interactive form', () => {
  hook = { generate, confirmBuild, status: 'building', result: null, errorMessage: null, generated: null }
  const { container } = render(<OnboardingQuestionnaire onBack={() => {}} />)
  // A spinner is present (LoaderCircle renders with the animate-spin class).
  expect(container.querySelector('.animate-spin')).toBeTruthy()
  // The stale mini-questionnaire must NOT render during the build request.
  expect(screen.queryByRole('button', { name: /create my checklists/i })).toBeNull()
})
