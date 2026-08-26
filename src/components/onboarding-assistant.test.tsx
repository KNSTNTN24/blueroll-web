// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'

const runBuild = vi.fn()
let mockState: any = {
  step: 'checks',
  addChecksMedia: vi.fn(),
  addChecksText: vi.fn(),
  runBuild,
  status: 'idle',
  result: null,
}

vi.mock('@/lib/onboarding/use-onboarding', () => ({
  useOnboarding: () => mockState,
}))

import { OnboardingPanel } from './onboarding-assistant'

beforeEach(() => {
  vi.clearAllMocks()
  mockState = {
    step: 'checks',
    addChecksMedia: vi.fn(),
    addChecksText: vi.fn(),
    runBuild,
    status: 'idle',
    result: null,
  }
})

function openPanel() {
  const trigger = screen.queryByRole('button', { name: /set up my checklists|open onboarding|get started/i })
  if (trigger) fireEvent.click(trigger)
}

test('shows checks step, gates Set up my site until a file is chosen, then triggers build', () => {
  render(<OnboardingPanel />)
  openPanel()

  // Throws if not found — asserts the "photos of the checks" heading is present.
  screen.getByText(/photos of the checks/i)

  const submitButton = screen.getByRole('button', { name: /set up my site/i }) as HTMLButtonElement
  expect(submitButton.disabled).toBe(true)

  const file = new File(['dummy'], 'temp-log.jpg', { type: 'image/jpeg' })
  const fileInput = screen.getByLabelText(/upload/i, { selector: 'input[type="file"]' }) as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })

  expect(mockState.addChecksMedia).toHaveBeenCalledWith([file])
  expect(submitButton.disabled).toBe(false)

  fireEvent.click(submitButton)
  expect(runBuild).toHaveBeenCalled()
})

test('success view shows checklist count with no dishes/allergens text', () => {
  mockState = {
    step: 'checks',
    addChecksMedia: vi.fn(),
    addChecksText: vi.fn(),
    runBuild,
    status: 'done',
    result: { templates: 3, dishes: 0 },
  }
  render(<OnboardingPanel />)
  openPanel()

  screen.getByText(/3 checklists/i)
  expect(screen.queryByText(/dishes/i)).toBeNull()
  expect(screen.queryByText(/allergen/i)).toBeNull()
})
