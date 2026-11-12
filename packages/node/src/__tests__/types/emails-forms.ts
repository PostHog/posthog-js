import type { PostHog } from '../../entrypoints/index.node'
import type { EmailDeliveryStatus, ScheduledEmail, SendEmailOptions } from '../../exports'

const react = { type: 'p', props: { children: 'Reset' }, key: null }

const to = 'jane@example.com'
const templateId = '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b'

export const forms: SendEmailOptions[] = [
  { to, templateId, templateData: { name: 'Jane' } },
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', replyTo: ['help@example.com'] },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', from: 'security@example.com', captureEngagement: false },
  { to, templateKey: 'reset', subject: 'Reset', react },
  { to, templateKey: 'reset', subject: 'Reset', react, text: 'Reset' },
  { to, templateId, scheduledAt: new Date('2026-12-01T09:00:00Z') },
  { to, templateKey: 'reset', subject: 'Reset', text: 'Reset', scheduledAt: '2026-12-01T09:00:00Z' },
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
  // @ts-expect-error content from code takes no template data
  { to, templateKey: 'reset', subject: 'Reset', html: '<p>Reset</p>', templateData: { name: 'J' } },
  // @ts-expect-error react renders its own html
  { to, templateKey: 'reset', subject: 'Reset', react, html: '<p>Reset</p>' },
  // @ts-expect-error a template made in PostHog sets its own content
  { to, templateId, react },
  // @ts-expect-error scheduledAt takes a Date or an ISO 8601 string, not a timestamp in milliseconds
  { to, templateId, scheduledAt: 1_796_115_600_000 },
]

export async function manageScheduledEmails(posthog: PostHog): Promise<void> {
  const { data } = await posthog.emails.send({ to, templateId, scheduledAt: new Date('2026-12-01T09:00:00Z') })
  const status: 'queued' | 'scheduled' | (string & {}) | undefined = data?.status
  const scheduledAt: string | null | undefined = data?.scheduledAt
  void [status, scheduledAt]

  const moved = await posthog.emails.update({ id: 'msg', scheduledAt: '2026-12-02T09:00:00Z' })
  const movedTo: string | undefined = moved.data?.scheduledAt
  void movedTo
  // @ts-expect-error update needs the new time
  await posthog.emails.update({ id: 'msg' })
  // @ts-expect-error update changes only the time
  await posthog.emails.update({ id: 'msg', scheduledAt: '2026-12-02T09:00:00Z', subject: 'Hi' })

  const canceled = await posthog.emails.cancel('msg')
  const canceledStatus: 'canceled' | undefined = canceled.data?.status
  void canceledStatus

  const page = await posthog.emails.list({ status: 'scheduled', cursor: 'next', limit: 10 })
  const first: ScheduledEmail | undefined = page.data?.results[0]
  const next: string | null | undefined = page.data?.next
  void [first, next]
  // @ts-expect-error only scheduled emails can be listed
  await posthog.emails.list({ status: 'sent' })

  const read = await posthog.emails.get('msg')
  const readStatus: EmailDeliveryStatus | (string & {}) | undefined = read.data?.status
  const known: EmailDeliveryStatus[] = ['scheduled', 'canceled']
  void [readStatus, known]
}
