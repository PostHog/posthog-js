import type { SendEmailOptions } from '../../exports'

const to = 'jane@example.com'

export const forms: SendEmailOptions[] = [
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', templateData: { name: 'Jane' } },
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', replyTo: ['help@example.com'] },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', from: 'security@example.com' },
  { to, templateKey: 'welcome', subject: 'Hi {{ variables.name }}', html: '<p>Hi</p>', templateData: { name: 'J' } },
]

export const wrongCombinations: SendEmailOptions[] = [
  // @ts-expect-error a send takes exactly one form
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', templateKey: 'reset', subject: 'Reset', html: '<p>R</p>' },
  // @ts-expect-error a template made in PostHog keeps its own sender
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', from: 'security@example.com' },
  // @ts-expect-error the code form needs html, text or both
  { to, templateKey: 'reset', subject: 'Reset' },
  // @ts-expect-error the code form needs a subject
  { to, templateKey: 'reset', html: '<p>Reset</p>' },
]
