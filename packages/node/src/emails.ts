import type { JsonType, PostHogApiResponse } from '@posthog/core'
import { emailContentHash } from './email-content-hash'
import { type TemplateFileContent, parseTemplateFile } from './email-template-file'

const SEND_EMAIL_PATH = '/api/projects/@current/messaging/send/email/'
const TEMPLATE_BY_KEY_PATH = '/api/projects/@current/messaging_templates/by_key/'

const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/
const DOCS_URL = 'https://posthog.com/docs/workflows/transactional-email-api'

/**
 * A reference to an HTML email template file in your repository, made with `posthog.emails.templateFile()`.
 * Every send reads the file, so an edit shows in the next email.
 */
export interface EmailTemplateFile {
  /** Absolute path of the `.html` file. */
  readonly path: string
  /** The template's key in PostHog: the file name without `.html`, unless you gave one. */
  readonly key: string
  /** The template's name in PostHog. Defaults to the subject. */
  readonly name?: string
}

/** Options for `posthog.emails.templateFile()`. */
export interface EmailTemplateFileOptions {
  /** The template's key in PostHog. Defaults to the file name without `.html`. */
  key?: string
  /** The template's name in the PostHog template library. Defaults to the subject. */
  name?: string
}

/** One email to send with `posthog.emails.send()`. */
export interface SendEmailOptions {
  /** The key of a template uploaded to PostHog, such as `'welcome'`, or a template file from `posthog.emails.templateFile()`. */
  template: string | EmailTemplateFile
  /** The recipient's email address. */
  to: string
  /** Values for the template, read as `{{ variables.* }}`. The template can't read person properties, so pass everything it needs here. */
  data?: Record<string, unknown>
  /** The distinct ID of the recipient's person, to attribute the send and its delivery events. It never loads person properties. */
  distinctId?: string
}

/** Something to know about a queued email, such as `template_superseded`. */
export interface EmailWarning {
  code: string
  message: string
}

/** Why an email call failed. `code` is stable, so branch on it. */
export interface EmailError {
  /**
   * The API's error code, such as `template_not_found`, or one of the SDK's own: `missing_secret_key`,
   * `client_disabled`, `network_error`, `invalid_template_key`, `template_file_unreadable`, `template_missing_subject`,
   * `api_error` for an answer PostHog gave without a code, and `unexpected_error`.
   */
  code: string
  message: string
  /** The HTTP status, when PostHog answered. */
  statusCode?: number
  /** A link to the docs section that explains the fix. */
  docsUrl?: string
  /** The request field the error is about, such as `template__key`. */
  field?: string
}

/** The result of `posthog.emails.send()`: the queued email's `id`, or the `error`. */
export type SendEmailResult =
  | { data: { id: string; warnings: EmailWarning[] }; error: null }
  | { data: null; error: EmailError }

/** Where a template file lives, shown on the template in PostHog. */
export interface EmailTemplateSource {
  /** Host and path of the repository, such as `github.com/example/app`. */
  repository?: string
  /** Path of the file in the repository. Defaults to the file's path relative to the working directory. */
  path?: string
  /** Commit or branch the file is uploaded from. */
  ref?: string
}

/** Options for `posthog.emails.uploadTemplate()`. */
export interface UploadEmailTemplateOptions {
  source?: EmailTemplateSource
}

/** The result of `posthog.emails.uploadTemplate()`. */
export type UploadEmailTemplateResult =
  | {
      data: { id: string; key: string; result: 'created' | 'updated' | 'unchanged'; contentHash: string }
      error: null
    }
  | { data: null; error: EmailError }

/** The `posthog.emails` API: send transactional email from your server. */
export interface Emails {
  /**
   * Send one email from a template.
   *
   * Never throws on API or network errors: it returns `{ data, error }`. A send is not idempotent, so two calls send
   * two emails. The SDK never retries a send that may have queued, after a timeout or a server error, for example.
   *
   * Needs the `secretKey` client option set to a project secret API key (`phs_`) with the `hog_flow:write` scope.
   *
   * @example
   * ```ts
   * const { data, error } = await posthog.emails.send({
   *   template: 'welcome',
   *   to: 'jane@example.com',
   *   data: { first_name: 'Jane' },
   *   distinctId: 'user_42',
   * })
   * ```
   */
  send(options: SendEmailOptions): Promise<SendEmailResult>
}

/** The `posthog.emails` API in Node.js, which also sends HTML template files from your repository. */
export interface NodeEmails extends Emails {
  /**
   * Send one email from a template.
   *
   * With a template file, every send reads the file and sends its content hash. When PostHog never published that
   * content, the SDK uploads the file and sends again, once. When newer content replaced it, PostHog sends the newer
   * content and the result carries a `template_superseded` warning, so an older deploy never brings old content back.
   *
   * Never throws on API or network errors: it returns `{ data, error }`. A send is not idempotent, so two calls send
   * two emails. The SDK never retries a send that may have queued, after a timeout or a server error, for example.
   *
   * Needs the `secretKey` client option set to a project secret API key (`phs_`) with the `hog_flow:write` scope.
   *
   * @example
   * ```ts
   * const welcome = posthog.emails.templateFile(new URL('./emails/welcome.html', import.meta.url))
   *
   * const { data, error } = await posthog.emails.send({
   *   template: welcome,
   *   to: 'jane@example.com',
   *   data: { first_name: 'Jane' },
   *   distinctId: 'user_42',
   * })
   * ```
   */
  send(options: SendEmailOptions): Promise<SendEmailResult>

  /**
   * Reference an HTML email template file. The subject is the file's `<title>`, the inbox preview text is the
   * `content` of `<meta name="preheader">`, and the HTML is the whole file. Nothing is read until a send.
   *
   * The subject and preheader decode numeric character references such as `&#233;` and the named ones `&amp;`,
   * `&lt;`, `&gt;`, `&quot;`, `&apos;` and `&nbsp;`. Write other characters as they are, since the file is UTF-8.
   *
   * Serverless bundlers only ship files your code imports, so include the template files in the deployment.
   *
   * @param file - A `file:` URL, such as `new URL('./emails/welcome.html', import.meta.url)`, or an absolute path.
   * @throws {TypeError} when `file` is not a `file:` URL or an absolute path to an `.html` file.
   */
  templateFile(file: URL | string, options?: EmailTemplateFileOptions): EmailTemplateFile

  /**
   * Upload a template file to PostHog and publish it, even content that newer content replaced. Use it to roll back
   * on purpose: `send` never publishes replaced content on its own.
   */
  uploadTemplate(template: EmailTemplateFile, options?: UploadEmailTemplateOptions): Promise<UploadEmailTemplateResult>
}

/**
 * File system access for template files, which only the Node.js entry has.
 * @internal
 */
export interface TemplateFiles {
  locate(file: URL | string): string
  read(path: string): Promise<string>
  sourcePath(path: string): string
}

/** @internal */
export interface EmailsApi {
  isDisabled(): boolean
  hasSecretKey(): boolean
  warn(message: string): void
  track<T>(work: Promise<T>): Promise<T>
  /** Rejects only when PostHog never answered. */
  request(method: 'POST' | 'PUT', path: string, body: JsonType): Promise<PostHogApiResponse>
}

type Outcome<T> = { data: T; error: null } | { data: null; error: EmailError }

interface LoadedTemplateFile {
  content: TemplateFileContent
  hash: string
  sourcePath: string
}

type Recipient = Omit<SendEmailOptions, 'template'>

/** @internal */
export class PostHogEmails implements NodeEmails {
  private readonly loggedWarnings = new Set<string>()

  constructor(
    private readonly api: EmailsApi,
    private readonly files?: TemplateFiles
  ) {}

  send(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.whenReady(() => this.sendTemplate(options))
  }

  templateFile(file: URL | string, options: EmailTemplateFileOptions = {}): EmailTemplateFile {
    if (!this.files) {
      throw new Error('Template files need the Node.js entry of posthog-node')
    }
    const path = this.files.locate(file)
    return {
      path,
      key: options.key ?? keyFromFileName(path),
      ...(options.name !== undefined && { name: options.name }),
    }
  }

  uploadTemplate(
    template: EmailTemplateFile,
    options: UploadEmailTemplateOptions = {}
  ): Promise<UploadEmailTemplateResult> {
    return this.whenReady(async () => {
      const loaded = await this.load(template)
      return loaded.error ? loaded : this.upload(template, loaded.data, options.source)
    })
  }

  private whenReady<T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    if (this.api.isDisabled()) {
      return Promise.resolve(failure('client_disabled', 'The PostHog client is disabled, so nothing was sent.'))
    }
    if (!this.api.hasSecretKey()) {
      return Promise.resolve(
        failure('missing_secret_key', 'Sending email needs the secretKey client option, a project secret API key.')
      )
    }
    return this.api.track(work().catch(unexpectedFailure))
  }

  private async sendTemplate({ template, ...recipient }: SendEmailOptions): Promise<SendEmailResult> {
    if (typeof template === 'string') {
      return isTemplateKey(template) ? this.post({ key: template }, recipient) : invalidTemplateKey(template)
    }
    return this.sendFile(template, recipient)
  }

  private async sendFile(template: EmailTemplateFile, recipient: Recipient): Promise<SendEmailResult> {
    const loaded = await this.load(template)
    if (loaded.error) {
      return loaded
    }
    const reference = { key: template.key, hash: loaded.data.hash }
    const sent = await this.post(reference, recipient)
    if (!needsUpload(sent)) {
      return this.logWarnings(reference, sent)
    }
    const uploaded = await this.upload(template, loaded.data)
    if (uploaded.error) {
      return uploaded
    }
    return this.logWarnings(reference, await this.post(reference, recipient))
  }

  private async load(template: EmailTemplateFile): Promise<Outcome<LoadedTemplateFile>> {
    if (!isTemplateKey(template.key)) {
      return invalidTemplateKey(template.key)
    }
    if (!this.files) {
      return failure('template_file_unreadable', 'Template files need the Node.js entry of posthog-node.')
    }
    let html: string
    try {
      html = await this.files.read(template.path)
    } catch {
      return failure(
        'template_file_unreadable',
        `Could not read the template file ${template.path}. Make sure the deployment ships it.`
      )
    }
    const content = parseTemplateFile(html)
    if (!content.subject) {
      return failure(
        'template_missing_subject',
        `The template file ${template.path} has no <title> to use as the subject.`
      )
    }
    return {
      data: { content, hash: await emailContentHash(content), sourcePath: this.files.sourcePath(template.path) },
      error: null,
    }
  }

  private async post(reference: { key: string; hash?: string }, recipient: Recipient): Promise<SendEmailResult> {
    const response = await this.request('POST', SEND_EMAIL_PATH, sendBody(reference, recipient))
    if (response.error) {
      return response
    }
    const { status, body } = response.data
    if (!isSuccess(status)) {
      return { data: null, error: apiError(response.data) }
    }
    if (!isRecord(body) || typeof body.message_id !== 'string') {
      return unexpectedResponse(status)
    }
    return { data: { id: body.message_id, warnings: warningsOf(body.warnings) }, error: null }
  }

  private async upload(
    template: EmailTemplateFile,
    { content, sourcePath }: LoadedTemplateFile,
    source: EmailTemplateSource = {}
  ): Promise<UploadEmailTemplateResult> {
    const body = {
      name: template.name ?? content.subject,
      ...content,
      source: { path: sourcePath, ...source },
    }
    const response = await this.request('PUT', `${TEMPLATE_BY_KEY_PATH}${template.key}/`, body)
    if (response.error) {
      return response
    }
    const { status, body: uploaded } = response.data
    if (!isSuccess(status)) {
      return { data: null, error: apiError(response.data) }
    }
    if (!isRecord(uploaded) || typeof uploaded.id !== 'string' || typeof uploaded.content_hash !== 'string') {
      return unexpectedResponse(status)
    }
    return {
      data: {
        id: uploaded.id,
        key: template.key,
        result: uploaded.result as 'created' | 'updated' | 'unchanged',
        contentHash: uploaded.content_hash,
      },
      error: null,
    }
  }

  private async request(method: 'POST' | 'PUT', path: string, body: JsonType): Promise<Outcome<PostHogApiResponse>> {
    try {
      return { data: await this.api.request(method, path, body), error: null }
    } catch (error) {
      return failure('network_error', error instanceof Error ? error.message : 'Request failed')
    }
  }

  private logWarnings(reference: { key: string; hash: string }, result: SendEmailResult): SendEmailResult {
    for (const warning of result.data?.warnings ?? []) {
      const seen = `${reference.key}\n${reference.hash}\n${warning.code}`
      if (warning.code === 'template_superseded' && !this.loggedWarnings.has(seen)) {
        this.loggedWarnings.add(seen)
        this.api.warn(
          `The email template "${reference.key}" was sent with newer content than this file (${reference.hash}). ` +
            'Deploy the newer file, or call posthog.emails.uploadTemplate() to publish this one again.'
        )
      }
    }
    return result
  }
}

function sendBody(reference: { key: string; hash?: string }, { to, data, distinctId }: Recipient): JsonType {
  return {
    template: reference,
    to,
    ...(data !== undefined && { message_data: data as JsonType }),
    ...(distinctId !== undefined && { identifiers: { distinct_id: distinctId } }),
  }
}

/** Only answers that queued nothing: a server error may have queued the email, whatever code its body carries. */
function needsUpload({ error }: SendEmailResult): boolean {
  return (
    (error?.statusCode === 409 && error.code === 'template_outdated') ||
    (error?.statusCode === 404 && error.code === 'template_not_found')
  )
}

function isTemplateKey(key: unknown): key is string {
  return typeof key === 'string' && TEMPLATE_KEY_PATTERN.test(key)
}

function keyFromFileName(path: string): string {
  return path.replace(/^.*[\\/]/, '').replace(/\.html$/i, '')
}

function invalidTemplateKey(key: string): { data: null; error: EmailError } {
  return failure(
    'invalid_template_key',
    `The template key "${key}" can only have letters, digits, hyphens (-) and underscores (_), at most 400.`,
    { docsUrl: `${DOCS_URL}#invalid_template_key`, field: 'template' }
  )
}

function failure(code: string, message: string, details: Partial<EmailError> = {}): { data: null; error: EmailError } {
  return { data: null, error: { code, message, ...details } }
}

function unexpectedFailure(error: unknown): { data: null; error: EmailError } {
  return failure('unexpected_error', error instanceof Error ? error.message : 'The email call failed unexpectedly.')
}

function unexpectedResponse(statusCode: number): { data: null; error: EmailError } {
  return failure('api_error', `PostHog answered HTTP ${statusCode} with an unexpected body.`, { statusCode })
}

function apiError({ status, body }: PostHogApiResponse): EmailError {
  const fields = isRecord(body) ? body : {}
  return {
    code: typeof fields.code === 'string' ? fields.code : 'api_error',
    message: typeof fields.detail === 'string' ? fields.detail : `PostHog answered HTTP ${status}.`,
    statusCode: status,
    ...(typeof fields.docs_url === 'string' && { docsUrl: fields.docs_url }),
    ...(typeof fields.attr === 'string' && { field: fields.attr }),
  }
}

function warningsOf(warnings: unknown): EmailWarning[] {
  return (Array.isArray(warnings) ? warnings : []).flatMap((warning) =>
    isRecord(warning) && typeof warning.code === 'string' && typeof warning.detail === 'string'
      ? [{ code: warning.code, message: warning.detail }]
      : []
  )
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
