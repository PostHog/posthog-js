import { TRANSACTIONAL_EMAIL_CATEGORY, type SendEmailOptions } from '../../exports'

const to = 'jane@example.com'
const templateId = '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b'

export const forms: SendEmailOptions[] = [
  { to, templateId, templateData: { name: 'Jane' } },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', category: TRANSACTIONAL_EMAIL_CATEGORY },
  {
    to,
    templateKey: 'digest',
    subject: 'Your week',
    html: '<a href="{{ unsubscribe_url }}">Unsubscribe</a>',
    category: { key: 'digest', type: 'marketing', name: 'Weekly digest', description: 'News every Monday' },
  },
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', replyTo: ['help@example.com'] },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', from: 'security@example.com', captureEngagement: false },
]

export const wrongCombinations: SendEmailOptions[] = [
  // @ts-expect-error a send takes exactly one form
  { to, templateId, templateKey: 'reset', subject: 'Reset', html: '<p>R</p>' },
  // @ts-expect-error a template made in PostHog follows the project's engagement capture setting
  { to, templateId, captureEngagement: false },
  // @ts-expect-error a template made in PostHog keeps its own sender
  { to, templateId, from: 'security@example.com' },
  // @ts-expect-error the code form needs html, text or both
  { to, templateKey: 'reset', subject: 'Reset' },
  // @ts-expect-error the code form needs a subject
  { to, templateKey: 'reset', html: '<p>Reset</p>' },
  // @ts-expect-error a template made in PostHog sends in its own category
  { to, templateId, category: TRANSACTIONAL_EMAIL_CATEGORY },
  // @ts-expect-error a category other than the built-in one is defined by an object, not its key
  { to, templateKey: 'digest', subject: 'Your week', html: '<p>Hi</p>', category: 'digest' },
  // @ts-expect-error content from code takes no template data
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', templateData: { name: 'J' } },
]
