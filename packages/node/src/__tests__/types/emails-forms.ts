import type { SendEmailOptions } from '../../exports'

const to = 'jane@example.com'
const templateId = '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b'

export const forms: SendEmailOptions[] = [
  { to, templateId, templateData: { name: 'Jane' } },
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', replyTo: ['help@example.com'] },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', from: 'security@example.com', captureEngagement: false },
  { to, templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>', tracking: false },
  { to, templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>', tracking: { clicks: true } },
  { to, templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>', sensitive: false },
]

export const wrongCombinations: SendEmailOptions[] = [
  // @ts-expect-error a send takes exactly one form
  { to, templateId, templateKey: 'reset', subject: 'Reset', html: '<p>R</p>' },
  // @ts-expect-error a template made in PostHog follows the project's engagement capture setting
  { to, templateId, captureEngagement: false },
  // @ts-expect-error a template made in PostHog keeps its own tracking
  { to, templateId, tracking: false },
  // @ts-expect-error a template made in PostHog keeps its own sensitive setting
  { to, templateId, sensitive: false },
  // @ts-expect-error tracking takes only opens, clicks and engagement
  { to, templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>', tracking: { open: false } },
  // @ts-expect-error a template made in PostHog keeps its own sender
  { to, templateId, from: 'security@example.com' },
  // @ts-expect-error the code form needs html, text or both
  { to, templateKey: 'reset', subject: 'Reset' },
  // @ts-expect-error the code form needs a subject
  { to, templateKey: 'reset', html: '<p>Reset</p>' },
  // @ts-expect-error content from code takes no template data
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', templateData: { name: 'J' } },
]
