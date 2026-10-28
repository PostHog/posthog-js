import { sanitizeValues } from './utils'

const DEFAULT_MAX_DEPTH = 3
const MAX_STACK_LINES = 20

// The Vercel AI SDK attaches the full request (prompt, system, tools) here. It duplicates `$ai_input`
// and can grow an event by hundreds of kilobytes.
const OMITTED_FIELD = 'requestBodyValues'

export function serializeError(value: unknown, depth = DEFAULT_MAX_DEPTH): unknown {
  if (depth < 0 || value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: truncateStack(value.stack),
    }
    for (const key of Object.keys(value)) {
      if (key !== OMITTED_FIELD) {
        out[key] = serializeError(Reflect.get(value, key), depth - 1)
      }
    }
    if (value.cause !== undefined) {
      out.cause = serializeError(value.cause, depth - 1)
    }
    return out
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeError(item, depth - 1))
  }
  return value
}

const omitRequestBody = (key: string, value: unknown): unknown => (key === OMITTED_FIELD ? undefined : value)

export function stringifyError(error: unknown): string {
  try {
    return JSON.stringify(sanitizeValues(serializeError(error)), omitRequestBody)
  } catch {
    if (error instanceof Error) {
      return JSON.stringify({ name: error.name, message: error.message })
    }
    return JSON.stringify({ message: String(error) })
  }
}

const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$.]{0,127}$/
const PROVIDER_CODE = /^[A-Za-z0-9_.:-]{1,64}$/
const PARAM = /^[A-Za-z0-9_.[\]-]{1,128}$/
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,128}$/
const MAX_CAUSES = 3

const readField = (value: unknown, key: string): unknown => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined
  }
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

const matching = (value: unknown, grammar: RegExp): string | undefined =>
  typeof value === 'string' && grammar.test(value) ? value : undefined

const firstMatching = (values: unknown[], grammar: RegExp): string | undefined => {
  for (const value of values) {
    const match = matching(value, grammar)
    if (match !== undefined) {
      return match
    }
  }
  return undefined
}

const className = (value: unknown): string => {
  if (!(value instanceof Error)) {
    return 'NonErrorThrown'
  }
  const name = readField(value, 'name')
  // SDKs such as OpenAI's leave `name` as the inherited 'Error' on their subclasses.
  const specificName = name === 'Error' ? undefined : name
  return firstMatching([specificName, readField(readField(value, 'constructor'), 'name'), name], CLASS_NAME) ?? 'Error'
}

const httpStatus = (error: unknown): number | undefined => {
  for (const key of ['status', 'statusCode']) {
    const value = readField(error, key)
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value
    }
  }
  return undefined
}

// Providers nest the detail one level down: OpenAI as `{ error: { code } }`, Anthropic as
// `{ type: 'error', error: { type } }`, Gemini as `{ error: { status } }`.
const unwrapEnvelope = (body: unknown): unknown => {
  const inner = readField(body, 'error')
  return inner !== null && typeof inner === 'object' ? inner : body
}

const parsedResponseBody = (error: unknown): unknown => {
  const responseBody = readField(error, 'responseBody')
  if (typeof responseBody !== 'string') {
    return undefined
  }
  try {
    return unwrapEnvelope(JSON.parse(responseBody))
  } catch {
    return undefined
  }
}

const causeNames = (error: unknown): string[] => {
  const names: string[] = []
  let cause = readField(error, 'cause')
  while (cause !== undefined && cause !== null && names.length < MAX_CAUSES) {
    names.push(className(cause))
    cause = readField(cause, 'cause')
  }
  return names
}

const describeError = (error: unknown): string => {
  const providerBody = unwrapEnvelope(readField(error, 'error'))
  const responseBody = parsedResponseBody(error)
  const sources = [error, providerBody, responseBody]

  const codes = new Set<string>()
  for (const source of sources) {
    for (const key of ['code', 'type', 'status']) {
      const code = matching(readField(source, key), PROVIDER_CODE)
      if (code !== undefined) {
        codes.add(code)
      }
    }
  }
  const status = httpStatus(error)
  const param = firstMatching(
    sources.map((source) => readField(source, 'param')),
    PARAM
  )
  const requestId = firstMatching([readField(error, 'requestID'), readField(error, 'request_id')], REQUEST_ID)
  const causes = causeNames(error)

  let summary = className(error)
  if (status !== undefined) {
    summary += `: ${status}`
  }
  for (const code of codes) {
    summary += ` ${code}`
  }
  if (param !== undefined) {
    summary += ` param=${param}`
  }
  if (requestId !== undefined) {
    summary += ` request_id=${requestId}`
  }
  if (causes.length > 0) {
    summary += ` (caused by ${causes.join(', ')})`
  }
  return summary
}

/**
 * Describes an error for `$ai_error` without its message, stack, or arbitrary fields, which
 * routinely echo the prompt. Only structured fields that pass a strict grammar are kept.
 * The format matches the Python SDK.
 */
export function summarizeErrorForPrivacy(error: unknown): string {
  try {
    return describeError(error)
  } catch {
    return error instanceof Error ? 'Error' : 'NonErrorThrown'
  }
}

export function formatAiError(error: unknown, privacyMode: boolean): string {
  return privacyMode ? summarizeErrorForPrivacy(error) : stringifyError(error)
}

function truncateStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return stack
  }
  const lines = stack.split('\n')
  if (lines.length <= MAX_STACK_LINES) {
    return stack
  }
  return [...lines.slice(0, MAX_STACK_LINES), '... (truncated)'].join('\n')
}
