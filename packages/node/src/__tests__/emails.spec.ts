import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { FakeEmailsApi } from './utils/fake-emails-api'

vi.mock('../version', () => ({ version: '1.2.3' }))

const JANE = 'jane@example.com'
const SECRET_KEY = 'phs_secret'
const SEND = 'POST /api/projects/@current/messaging/send/email/'
const UPLOAD_WELCOME = 'PUT /api/projects/@current/messaging_templates/by_key/welcome/'

const welcomeHtml = (subject: string): string =>
  [
    '<!doctype html>',
    '<html>',
    '<head>',
    `  <title>\n    ${subject}\n  </title>`,
    '  <meta name="preheader" content="Your account is ready &amp; waiting">',
    '</head>',
    '<body><p>Hi {{ variables.first_name }}</p></body>',
    '</html>',
    '',
  ].join('\r\n')

describe('emails', () => {
  let api: FakeEmailsApi
  const clients: PostHog[] = []

  const createClient = (options: PostHogOptions = {}): PostHog => {
    const client = new PostHog('phc_project_token', {
      host: 'http://example.com',
      secretKey: SECRET_KEY,
      enableLocalEvaluation: false,
      fetch: api.fetch,
      ...options,
    })
    clients.push(client)
    return client
  }

  let directory: string

  const templatePath = (relativePath: string, html = welcomeHtml('Welcome')): string =>
    writeTemplate(relativePath, html)

  const writeTemplate = (relativePath: string, html: string): string => {
    const path = join(directory, relativePath)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, html)
    return path
  }

  const sendWelcome = (posthog: PostHog, file: string) =>
    posthog.emails.send({
      template: posthog.emails.templateFile(pathToFileURL(file)),
      to: JANE,
      data: { first_name: 'Jane' },
    })

  beforeEach(() => {
    api = new FakeEmailsApi({ secretKey: SECRET_KEY })
    directory = mkdtempSync(join(tmpdir(), 'posthog-emails-'))
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    rmSync(directory, { recursive: true, force: true })
  })

  describe('send by key', () => {
    it('sends the published template with the data and distinct id, authenticated by the secret key', async () => {
      await api.publish('welcome', { subject: 'Welcome, {{ variables.first_name }}', html: '<p>Hi</p>' })

      const result = await createClient().emails.send({
        template: 'welcome',
        to: JANE,
        data: { first_name: 'Jane' },
        distinctId: 'user_42',
      })

      expect(result).toEqual({ data: { id: api.delivered[0].messageId, warnings: [] }, error: null })
      expect(api.delivered).toEqual([
        expect.objectContaining({
          to: JANE,
          key: 'welcome',
          subject: 'Welcome, {{ variables.first_name }}',
          variables: { first_name: 'Jane' },
          distinctId: 'user_42',
        }),
      ])
      expect(api.received).toEqual([expect.objectContaining({ authorization: `Bearer ${SECRET_KEY}` })])
    })

    it.each([
      [
        'an unknown key, without uploading anything',
        undefined,
        {
          code: 'template_not_found',
          message: 'Refused with template_not_found.',
          statusCode: 404,
          docsUrl: 'https://posthog.com/docs/workflows/transactional-email-api#template_not_found',
          field: 'template__key',
        },
      ],
      [
        'the API turned off for the project',
        {
          status: 404,
          body: { type: 'invalid_request', code: 'not_found', detail: 'Endpoint not found.', attr: null },
        },
        { code: 'not_found', message: 'Endpoint not found.', statusCode: 404 },
      ],
      [
        'a throttled send',
        { status: 429, body: { type: 'throttled_error', code: 'throttled', detail: 'Request was throttled.' } },
        { code: 'throttled', message: 'Request was throttled.', statusCode: 429 },
      ],
      [
        'a server error with an unreadable body, without retrying',
        { status: 500, body: '<html>oops</html>' },
        { code: 'api_error', message: 'PostHog answered HTTP 500.', statusCode: 500 },
      ],
    ])('returns %s as the error', async (_, fault, error) => {
      if (fault) {
        api.failWhen(() => true, fault)
      }

      const result = await createClient().emails.send({ template: 'welcome', to: JANE })

      expect(result).toEqual({ data: null, error })
      expect(api.requestLog).toEqual([SEND])
    })

    it('drops warnings it cannot read instead of throwing', async () => {
      api.failWhen(() => true, {
        status: 202,
        body: { message_id: 'message-1', warnings: [{ code: { toString: null }, detail: 'x' }, 'oops', null] },
      })

      const result = await createClient().emails.send({ template: 'welcome', to: JANE })

      expect(result).toEqual({ data: { id: 'message-1', warnings: [] }, error: null })
    })

    it('returns a network failure without retrying, and hands the original error to the error event', async () => {
      const networkError = new Error('getaddrinfo ENOTFOUND example.com')
      api.failWhen(() => true, { networkError })
      const posthog = createClient()
      const errors: unknown[] = []
      posthog.on('error', (error) => errors.push(error))

      const result = await posthog.emails.send({ template: 'welcome', to: JANE })

      expect(result).toEqual({ data: null, error: { code: 'network_error', message: 'Request failed' } })
      expect(api.requestLog).toEqual([SEND])
      expect(errors).toEqual([expect.objectContaining({ error: networkError })])
    })
  })

  describe('refusals before any request', () => {
    it.each([
      ['missing_secret_key', { secretKey: undefined }, () => 'welcome'],
      ['client_disabled', { disabled: true }, () => 'welcome'],
      ['invalid_template_key', {}, () => 'welcome email'],
      [
        'invalid_template_key',
        {},
        (posthog: PostHog) => posthog.emails.templateFile(templatePath('welcome email.html')),
      ],
      [
        'template_file_unreadable',
        {},
        (posthog: PostHog) => posthog.emails.templateFile(join(directory, 'missing.html')),
      ],
      [
        'template_missing_subject',
        {},
        (posthog: PostHog) => posthog.emails.templateFile(templatePath('welcome.html', '<p>No title</p>')),
      ],
    ])('returns %s', async (code, options: PostHogOptions, template) => {
      const posthog = createClient(options)

      const result = await posthog.emails.send({ template: template(posthog), to: JANE })

      expect(result).toEqual({ data: null, error: expect.objectContaining({ code }) })
      expect(api.received).toEqual([])
    })

    it('throws a TypeError for a template file that is not a file URL or an absolute .html path', () => {
      const emails = createClient().emails

      expect(() => emails.templateFile('emails/welcome.html')).toThrow(TypeError)
      expect(() => emails.templateFile(new URL('https://example.com/welcome.html'))).toThrow(TypeError)
      expect(() => emails.templateFile(join(directory, 'welcome.txt'))).toThrow(TypeError)
    })
  })

  describe('send from a template file', () => {
    it('publishes a file PostHog has never seen, then sends it, with no upload step', async () => {
      const file = writeTemplate('emails/welcome.html', welcomeHtml('Welcome, {{ variables.first_name }}'))

      const result = await sendWelcome(createClient(), file)

      expect(result).toEqual({ data: { id: api.delivered[0].messageId, warnings: [] }, error: null })
      expect(api.requestLog).toEqual([SEND, UPLOAD_WELCOME, SEND])
      expect(api.delivered).toEqual([
        expect.objectContaining({
          key: 'welcome',
          subject: 'Welcome, {{ variables.first_name }}',
          preheader: 'Your account is ready & waiting',
          html: welcomeHtml('Welcome, {{ variables.first_name }}'),
          variables: { first_name: 'Jane' },
        }),
      ])
      expect(api.template('welcome')).toMatchObject({ name: 'Welcome, {{ variables.first_name }}', text: undefined })
    })

    it('sends a file PostHog already holds in one request', async () => {
      const posthog = createClient()
      const file = writeTemplate('welcome.html', welcomeHtml('Welcome'))
      await sendWelcome(posthog, file)
      api.received.length = 0

      await sendWelcome(posthog, file)

      expect(api.requestLog).toEqual([SEND])
      expect(api.delivered).toHaveLength(2)
    })

    it('publishes an edited file on the next send', async () => {
      const posthog = createClient()
      const file = writeTemplate('welcome.html', welcomeHtml('Welcome'))
      await sendWelcome(posthog, file)
      writeTemplate('welcome.html', welcomeHtml('Welcome aboard'))
      api.received.length = 0

      await sendWelcome(posthog, file)

      expect(api.requestLog).toEqual([SEND, UPLOAD_WELCOME, SEND])
      expect(api.delivered.map(({ subject }) => subject)).toEqual(['Welcome', 'Welcome aboard'])
    })

    it('sends the newer content when an older copy of the file sends, and warns once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const older = createClient()
      older.debug(true)
      const olderFile = writeTemplate('old/welcome.html', welcomeHtml('Welcome'))
      await sendWelcome(older, olderFile)
      await sendWelcome(createClient(), writeTemplate('new/welcome.html', welcomeHtml('Welcome aboard')))
      api.received.length = 0

      const first = await sendWelcome(older, olderFile)
      const second = await sendWelcome(older, olderFile)

      expect(api.requestLog).toEqual([SEND, SEND])
      expect(api.delivered.map(({ subject }) => subject)).toEqual([
        'Welcome',
        'Welcome aboard',
        'Welcome aboard',
        'Welcome aboard',
      ])
      expect(api.template('welcome')?.subject).toBe('Welcome aboard')
      for (const result of [first, second]) {
        expect(result.data?.warnings).toEqual([
          { code: 'template_superseded', message: 'The email was sent with the template’s current content.' },
        ])
      }
      expect(warn.mock.calls.filter((call) => call.join(' ').includes('"welcome"'))).toHaveLength(1)
    })

    it('returns a second template_outdated as the error', async () => {
      const file = writeTemplate('welcome.html', welcomeHtml('Welcome'))
      api.failWhen((request) => request.path.endsWith('/send/email/'), outdated(), 2)

      const result = await sendWelcome(createClient(), file)

      expect(api.requestLog).toEqual([SEND, UPLOAD_WELCOME, SEND])
      expect(result).toEqual({
        data: null,
        error: expect.objectContaining({ code: 'template_outdated', statusCode: 409 }),
      })
      expect(api.delivered).toEqual([])
    })

    it('never uploads or sends again after a server error, whatever code its body carries', async () => {
      const file = writeTemplate('welcome.html', welcomeHtml('Welcome'))
      api.failWhen((request) => request.method === 'POST', { status: 503, body: outdated().body })

      const result = await sendWelcome(createClient(), file)

      expect(api.requestLog).toEqual([SEND])
      expect(result.error).toMatchObject({ code: 'template_outdated', statusCode: 503 })
    })

    it.each([
      [
        'a commented-out title and preheader',
        '<!-- <title>Draft</title><meta name="preheader" content="Old"> --><title>Welcome</title><meta name="preheader" content="New">',
        { subject: 'Welcome', preheader: 'New' },
      ],
      [
        'a comment marker inside a quoted attribute',
        '<meta name="preheader" content="Use <!-- marker"><title>Welcome</title>',
        { subject: 'Welcome', preheader: 'Use <!-- marker' },
      ],
      [
        'a quoted > in the preheader',
        '<title>Welcome</title><meta content="Save > spend" name="preheader">',
        { subject: 'Welcome', preheader: 'Save > spend' },
      ],
      [
        'character references in the subject',
        '<title>Caf&#233; &amp; &#x2014; bar</title>',
        { subject: 'Café & — bar', preheader: undefined },
      ],
    ])('reads the subject and preheader from %s', async (_, head, expected) => {
      const file = writeTemplate('welcome.html', `<html><head>${head}</head><body>Hi</body></html>`)

      await sendWelcome(createClient(), file)

      expect(api.template('welcome')).toMatchObject(expected)
    })

    it('returns a failed upload and sends nothing', async () => {
      const file = writeTemplate('welcome.html', welcomeHtml('Welcome'))
      api.failWhen((request) => request.method === 'PUT', {
        status: 400,
        body: {
          type: 'invalid_request',
          code: 'sender_unavailable',
          detail: 'This project has no verified default sender.',
          attr: null,
        },
      })

      const result = await sendWelcome(createClient(), file)

      expect(api.requestLog).toEqual([SEND, UPLOAD_WELCOME])
      expect(result).toEqual({
        data: null,
        error: { code: 'sender_unavailable', message: 'This project has no verified default sender.', statusCode: 400 },
      })
      expect(api.delivered).toEqual([])
    })
  })

  describe('uploadTemplate', () => {
    it('publishes replaced content on purpose, so later sends of the newer file carry the warning', async () => {
      const posthog = createClient()
      const olderFile = writeTemplate('old/welcome.html', welcomeHtml('Welcome'))
      await sendWelcome(posthog, olderFile)
      const firstHash = api.template('welcome')!.contentHash
      const newerFile = writeTemplate('new/welcome.html', welcomeHtml('Welcome aboard'))
      await sendWelcome(posthog, newerFile)

      const uploaded = await posthog.emails.uploadTemplate(posthog.emails.templateFile(olderFile), {
        source: { repository: 'github.com/example/app', ref: '3f2c1ab' },
      })
      const sent = await sendWelcome(posthog, newerFile)

      expect(uploaded).toEqual({
        data: { id: api.template('welcome')!.id, key: 'welcome', result: 'updated', contentHash: firstHash },
        error: null,
      })
      expect(api.template('welcome')?.source).toMatchObject({ repository: 'github.com/example/app', ref: '3f2c1ab' })
      expect(sent.data?.warnings).toEqual([expect.objectContaining({ code: 'template_superseded' })])
      expect(api.delivered.at(-1)?.subject).toBe('Welcome')
    })

    it('uploads under the key and name given to templateFile', async () => {
      const posthog = createClient()
      const file = posthog.emails.templateFile(templatePath('welcome.html'), { key: 'signup', name: 'Signup' })

      const uploaded = await posthog.emails.uploadTemplate(file)

      expect(uploaded.data).toMatchObject({ key: 'signup', result: 'created' })
      expect(api.template('signup')).toMatchObject({ name: 'Signup', subject: 'Welcome' })
    })
  })
})

function outdated() {
  return {
    status: 409,
    body: {
      type: 'invalid_request',
      code: 'template_outdated',
      detail: 'PostHog does not hold the content this hash describes, so nothing was sent.',
      attr: 'template__hash',
    },
  }
}
