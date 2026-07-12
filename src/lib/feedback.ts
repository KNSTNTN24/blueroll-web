export const FEEDBACK_KINDS = ['question', 'feature', 'bug', 'feedback'] as const

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FEEDBACK_COPY: Record<FeedbackKind, {
  label: string
  description: string
  prompt: string
  placeholder: string
  success: string
}> = {
  question: {
    label: 'Ask a question',
    description: 'Get help from the Blueroll team',
    prompt: 'What can we help you with?',
    placeholder: 'Tell us what you are trying to do…',
    success: 'Your question is with the Blueroll team.',
  },
  feature: {
    label: 'Request a feature',
    description: 'Suggest an improvement or new tool',
    prompt: 'What would you like Blueroll to do?',
    placeholder: 'Describe the problem this feature would solve…',
    success: 'Your idea has been added to our product feedback.',
  },
  bug: {
    label: 'Report a problem',
    description: 'Tell us when something is not working',
    prompt: 'What went wrong?',
    placeholder: 'What happened, and what did you expect instead?',
    success: 'Your report has been sent with technical context.',
  },
  feedback: {
    label: 'Share feedback',
    description: 'Tell us what to keep or improve',
    prompt: 'How is Blueroll working for you?',
    placeholder: 'Share anything that would make your work easier…',
    success: 'Thank you for helping us improve Blueroll.',
  },
}

export function feedbackMessageError(message: string): string | null {
  const length = message.trim().length
  if (length < 5) return 'Please add a little more detail.'
  if (length > 4000) return 'Please keep your message under 4,000 characters.'
  return null
}
