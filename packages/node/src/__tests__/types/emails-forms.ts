import type { SendEmailOptions } from '../../exports'

const to = 'jane@example.com'

export const forms: SendEmailOptions[] = [
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', templateData: { name: 'Jane' } },
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', replyTo: ['help@example.com'] },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', from: 'security@example.com' },
  { to, templateKey: 'welcome', subject: 'Hi {{ variables.name }}', html: '<p>Hi</p>', templateData: { name: 'J' } },
  {
    to,
    templateKey: 'receipt',
    subject: 'Receipt',
    html: '<p>Thanks</p>',
    cc: 'finance@example.com',
    bcc: ['audit@example.com'],
    headers: { 'X-Entity-Ref-ID': 'order-123' },
    tags: [{ name: 'category', value: 'receipt' }],
    attachments: [
      { filename: 'receipt.pdf', content: Buffer.from('pdf') },
      { filename: 'logo.png', content: new Uint8Array([1]), contentType: 'image/png', contentId: 'logo' },
      { filename: 'invite.ics', content: 'QkVHSU4=' },
    ],
  },
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
  // @ts-expect-error a template made in PostHog keeps its own copies
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', cc: 'finance@example.com' },
  // @ts-expect-error a template made in PostHog keeps its own attachments
  { to, templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b', attachments: [{ filename: 'a.txt', content: 'YQ==' }] },
  {
    to,
    templateKey: 'invoice',
    subject: 'Invoice',
    html: '<p>I</p>',
    // @ts-expect-error PostHog can't fetch an attachment from a path
    attachments: [{ filename: 'a.pdf', path: '/a.pdf' }],
  },
]
