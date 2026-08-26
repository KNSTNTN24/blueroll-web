// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'

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

afterEach(() => {
  // vitest `globals` is off in this repo, so RTL's auto-cleanup isn't
  // registered — unmount between tests to avoid multiple panels in the DOM.
  cleanup()
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

test('commits notes text exactly once across a retry-after-error (no duplication)', () => {
  const addChecksText = vi.fn()
  mockState = {
    step: 'checks',
    addChecksMedia: vi.fn(),
    addChecksText,
    runBuild,
    status: 'idle',
    result: null,
  }
  render(<OnboardingPanel />)
  openPanel()

  const notes = screen.getByLabelText(/anything else/i) as HTMLTextAreaElement
  fireEvent.change(notes, { target: { value: '  note1  ' } })

  const file = new File(['dummy'], 'temp-log.jpg', { type: 'image/jpeg' })
  const fileInput = screen.getByLabelText(/upload/i, { selector: 'input[type="file"]' }) as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })

  const submitButton = screen.getByRole('button', { name: /set up my site/i })
  // First submit commits the note; simulate the extract call having failed
  // (status stays 'idle' here so the button remains enabled for a bare retry).
  fireEvent.click(submitButton)
  // Retry without retyping the note.
  fireEvent.click(submitButton)

  // Committed exactly once, trimmed — the retry must NOT re-append "note1".
  expect(addChecksText).toHaveBeenCalledTimes(1)
  expect(addChecksText).toHaveBeenCalledWith('note1')
  expect(runBuild).toHaveBeenCalledTimes(2)
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
