import { EmailError } from './errors'
import type { EmailWarning } from './types'

/** What PostHog or its file storage answered to one request. */
export interface Reply {
  status: number
  text: string
  retryAfterMs?: number
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function replyFields(payload: unknown): Record<string, unknown> {
  return isRecord(payload) ? payload : {}
}

export function warningsOf(fields: Record<string, unknown>): EmailWarning[] {
  const warnings: EmailWarning[] = []
  if (Array.isArray(fields.warnings)) {
    for (const warning of fields.warnings) {
      if (isRecord(warning)) {
        warnings.push({
          code: text(warning.code) ?? 'warning',
          message: text(warning.detail) ?? text(warning.message) ?? '',
          fix: text(warning.fix),
        })
      }
    }
  }
  return warnings
}

export function replyError(
  fields: Record<string, unknown>,
  status: number,
  retryAfterMs: number | undefined
): EmailError {
  return new EmailError({
    code: text(fields.code) ?? 'api_error',
    message: text(fields.detail) ?? `PostHog answered HTTP ${status}.`,
    statusCode: status,
    why: text(fields.why),
    fix: text(fields.fix),
    docsUrl: text(fields.docs_url),
    field: text(fields.attr),
    retryAfterMs,
  })
}
