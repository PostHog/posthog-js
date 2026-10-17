import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const SOURCE_VARIABLES = [
  'GITHUB_SERVER_URL',
  'GITHUB_REPOSITORY',
  'GITHUB_SHA',
  'GITHUB_WORKSPACE',
  'CI_SERVER_HOST',
  'CI_PROJECT_PATH',
  'CI_COMMIT_SHA',
  'CI_PROJECT_DIR',
  'VERCEL_GIT_PROVIDER',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_GIT_COMMIT_SHA',
  'RAILWAY_GIT_REPO_OWNER',
  'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_COMMIT_SHA',
]
const DEPLOYED = '3f2c1ab9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3'

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

    it('never publishes content that newer content replaced while its first send was answered', async () => {
      const older = createClient()
      const olderFile = writeTemplate('old/welcome.html', welcomeHtml('Welcome'))
      await sendWelcome(older, olderFile)
      await sendWelcome(createClient(), writeTemplate('new/welcome.html', welcomeHtml('Welcome aboard')))
      api.failWhen((request) => request.path.endsWith('/send/email/'), outdated(), 1)
      api.received.length = 0

      const result = await sendWelcome(older, olderFile)

      expect(api.requestLog).toEqual([SEND, UPLOAD_WELCOME, SEND])
      expect(api.template('welcome')?.subject).toBe('Welcome aboard')
      expect(api.delivered.at(-1)?.subject).toBe('Welcome aboard')
      expect(result).toEqual({
        data: {
          id: api.delivered.at(-1)?.messageId,
          warnings: [
            { code: 'template_superseded', message: 'The email was sent with the template’s current content.' },
          ],
        },
        error: null,
      })
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
        'a second title, whose text holds no tags',
        '<title>Welcome</title><title><meta name=preheader content=Wrong></title><meta name=preheader content=Right>',
        { subject: 'Welcome', preheader: 'Right' },
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
        'a file of unclosed tags, in linear time',
        '<title>Welcome</title><meta name=preheader content=Preview>' + '<title>'.repeat(120000),
        { subject: 'Welcome', preheader: 'Preview' },
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

  describe('the source an upload carries', () => {
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      }).trim()

    const checkout = (relativePath: string, remote: string): { root: string; head: string } => {
      const root = join(directory, relativePath)
      mkdirSync(root, { recursive: true })
      git(root, 'init', '--quiet', '--initial-branch=main')
      git(root, 'remote', 'add', 'origin', remote)
      git(root, 'commit', '--quiet', '--allow-empty', '--message=first')
      return { root, head: git(root, 'rev-parse', 'HEAD') }
    }

    const uploadedSource = (): Record<string, unknown> | undefined =>
      api.received.find((request) => request.method === 'PUT')?.body.source

    beforeEach(() => {
      for (const variable of SOURCE_VARIABLES) {
        vi.stubEnv(variable, '')
      }
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('names the repository without credentials, the path in it and the commit, from a git checkout', async () => {
      const { head } = checkout('app', 'https://x-access-token:ghp_secret@github.com/example/app.git')

      const result = await sendWelcome(createClient(), writeTemplate('app/emails/welcome.html', welcomeHtml('Hi')))

      expect(result.error).toBeNull()
      expect(uploadedSource()).toEqual({ repository: 'github.com/example/app', path: 'emails/welcome.html', ref: head })
      expect(JSON.stringify(api.received)).not.toContain('ghp_secret')
    })

    it.each([
      [
        'an SSH remote and a detached head',
        'git@github.com:example/app.git',
        (root: string) => git(root, 'checkout', '--quiet', '--detach'),
        'github.com/example/app',
      ],
      [
        'an ssh:// remote with a port, and the branch only in packed-refs',
        'ssh://git@gitlab.example.com:2222/group/sub/app.git',
        (root: string) => git(root, 'pack-refs', '--all'),
        'gitlab.example.com/group/sub/app',
      ],
      [
        'a quoted remote followed by a comment in the config',
        'https://github.com/example/app.git',
        (root: string) => {
          const config = join(root, '.git', 'config')
          writeFileSync(
            config,
            readFileSync(config, 'utf8').replace(/url = .*/, 'url = "https://github.com/example/app.git" # the app')
          )
        },
        'github.com/example/app',
      ],
    ])('reads a checkout with %s', async (_, remote, prepare, repository) => {
      const { root, head } = checkout('app', remote)
      prepare(root)

      await sendWelcome(createClient(), writeTemplate('app/emails/welcome.html', welcomeHtml('Hi')))

      expect(uploadedSource()).toEqual({ repository, path: 'emails/welcome.html', ref: head })
    })

    it('reads a worktree through its .git file, with the path inside the worktree and its own commit', async () => {
      const { root } = checkout('app', 'https://github.com/example/app.git')
      const worktree = join(directory, 'app-feature')
      git(root, 'worktree', 'add', '--quiet', '-b', 'feature', worktree)
      git(worktree, 'commit', '--quiet', '--allow-empty', '--message=second')

      await sendWelcome(createClient(), writeTemplate('app-feature/emails/welcome.html', welcomeHtml('Hi')))

      expect(uploadedSource()).toEqual({
        repository: 'github.com/example/app',
        path: 'emails/welcome.html',
        ref: git(worktree, 'rev-parse', 'HEAD'),
      })
    })

    it.each([
      [
        'GitHub Actions',
        { GITHUB_SERVER_URL: 'https://github.example.com', GITHUB_REPOSITORY: 'example/app', GITHUB_SHA: DEPLOYED },
        { repository: 'github.example.com/example/app', ref: DEPLOYED },
      ],
      [
        'GitLab CI',
        { CI_SERVER_HOST: 'gitlab.example.com', CI_PROJECT_PATH: 'group/app', CI_COMMIT_SHA: DEPLOYED },
        { repository: 'gitlab.example.com/group/app', ref: DEPLOYED },
      ],
      [
        'Vercel',
        {
          VERCEL_GIT_PROVIDER: 'bitbucket',
          VERCEL_GIT_REPO_OWNER: 'example',
          VERCEL_GIT_REPO_SLUG: 'app',
          VERCEL_GIT_COMMIT_SHA: DEPLOYED,
        },
        { repository: 'bitbucket.org/example/app', ref: DEPLOYED },
      ],
      [
        'Railway',
        { RAILWAY_GIT_REPO_OWNER: 'example', RAILWAY_GIT_REPO_NAME: 'app', RAILWAY_GIT_COMMIT_SHA: DEPLOYED },
        { repository: 'github.com/example/app', ref: DEPLOYED },
      ],
      [
        'GitHub Actions over GitLab CI',
        {
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'example/app',
          CI_SERVER_HOST: 'gitlab.com',
          CI_PROJECT_PATH: 'example/other',
        },
        { repository: 'github.com/example/app' },
      ],
      [
        'nothing from a Vercel provider without a known host',
        { VERCEL_GIT_PROVIDER: 'other', VERCEL_GIT_REPO_OWNER: 'example', VERCEL_GIT_REPO_SLUG: 'app' },
        {},
      ],
      [
        'nothing from a Vercel provider named like an object property',
        { VERCEL_GIT_PROVIDER: 'constructor', VERCEL_GIT_REPO_OWNER: 'example', VERCEL_GIT_REPO_SLUG: 'app' },
        {},
      ],
      [
        'nothing from a repository too long to store',
        { VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'example', VERCEL_GIT_REPO_SLUG: 'a'.repeat(400) },
        {},
      ],
    ])('takes %s from the environment, before the checkout', async (_, variables, expected) => {
      const { head } = checkout('app', 'https://github.com/example/checkout.git')
      for (const [variable, value] of Object.entries(variables)) {
        vi.stubEnv(variable, value)
      }

      await sendWelcome(createClient(), writeTemplate('app/emails/welcome.html', welcomeHtml('Hi')))

      expect(uploadedSource()).toEqual({
        repository: 'github.com/example/checkout',
        path: 'emails/welcome.html',
        ref: head,
        ...expected,
      })
    })

    it.each([
      ['the path in GITHUB_WORKSPACE', 'GITHUB_WORKSPACE'],
      ['the path in CI_PROJECT_DIR', 'CI_PROJECT_DIR'],
    ])('sends %s without a checkout', async (_, variable) => {
      vi.stubEnv(variable, directory)

      await sendWelcome(createClient(), writeTemplate('emails/welcome.html', welcomeHtml('Hi')))

      expect(uploadedSource()).toEqual({ path: 'emails/welcome.html' })
    })

    it('sends only the path from the working directory when nothing names the repository', async () => {
      const file = writeTemplate('emails/welcome.html', welcomeHtml('Hi'))

      await sendWelcome(createClient(), file)

      expect(uploadedSource()).toEqual({ path: file })
    })

    it('lets each part of an explicit source win, and detects the others', async () => {
      const { head } = checkout('app', 'https://github.com/example/app.git')
      vi.stubEnv('GITHUB_SHA', DEPLOYED)
      const posthog = createClient()
      const file = posthog.emails.templateFile(writeTemplate('app/emails/welcome.html', welcomeHtml('Hi')))

      await posthog.emails.uploadTemplate(file, { source: { path: 'templates/welcome.html', ref: head } })

      expect(uploadedSource()).toEqual({
        repository: 'github.com/example/app',
        path: 'templates/welcome.html',
        ref: head,
      })
    })

    it.each([
      [
        'a .git directory whose files are unreadable',
        (dotGit: string) => {
          mkdirSync(join(dotGit, 'config'), { recursive: true })
          mkdirSync(join(dotGit, 'HEAD'), { recursive: true })
        },
      ],
      ['a .git file that points nowhere', (dotGit: string) => writeFileSync(dotGit, 'gitdir: ./missing\n')],
      ['a .git file that is not a link', (dotGit: string) => writeFileSync(dotGit, 'not a link\n')],
      [
        'a .git directory whose files are pipes nobody writes to',
        (dotGit: string) => {
          mkdirSync(dotGit)
          execFileSync('mkfifo', [join(dotGit, 'config'), join(dotGit, 'HEAD')])
        },
      ],
    ])('still sends from %s', async (_, makeDotGit) => {
      mkdirSync(join(directory, 'app'))
      makeDotGit(join(directory, 'app', '.git'))

      const result = await sendWelcome(createClient(), writeTemplate('app/emails/welcome.html', welcomeHtml('Hi')))

      expect(result.error).toBeNull()
      expect(uploadedSource()).toEqual({ path: 'emails/welcome.html' })
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
