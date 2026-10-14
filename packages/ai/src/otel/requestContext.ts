import type { AttributeValue, Attributes } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { withAttributes } from './spans'

export type CapturedContext = {
  distinctId?: string
  sessionId?: string
  properties?: Record<string, unknown>
}

// Structural so declarations type-check against posthog-node versions that have no getContext.
export type PostHogContextSource = {
  getContext?(): CapturedContext | undefined
}

const DISTINCT_ID_ATTRIBUTE = 'posthog.distinct_id'
const SESSION_ID_ATTRIBUTE = '$session_id'

// Ingestion prefers posthog.distinct_id, so adding it would override the user a span already names.
const IDENTITY_ATTRIBUTES = [
  DISTINCT_ID_ATTRIBUTE,
  'user.id',
  'ai.telemetry.metadata.posthog_distinct_id',
  'ai.settings.context.posthog_distinct_id',
]

type Primitive = string | number | boolean

function isPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  )
}

function isHomogeneousPrimitiveArray(value: unknown): value is string[] | number[] | boolean[] {
  return Array.isArray(value) && value.every((item) => isPrimitive(item) && typeof item === typeof value[0])
}

function rejectNonFinite(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('non-finite number')
  }
  return value
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (isPrimitive(value) || isHomogeneousPrimitiveArray(value)) {
    return value
  }
  try {
    const json = JSON.stringify(value, rejectNonFinite)
    if (json === undefined || json === 'null') {
      return undefined
    }
    return json.startsWith('"') ? String(JSON.parse(json)) || undefined : json
  } catch {
    return undefined
  }
}

function hasValues(context: CapturedContext): boolean {
  return Boolean(context.distinctId || context.sessionId || Object.keys(context.properties ?? {}).length > 0)
}

export function captureContext(client: PostHogContextSource): CapturedContext | undefined {
  try {
    // posthog-node versions before getContext existed are still within the peer range.
    if (typeof client.getContext !== 'function') {
      return undefined
    }
    const context = client.getContext()
    return context && hasValues(context) ? context : undefined
  } catch {
    // Capturing is best effort and must never break the instrumented call.
    return undefined
  }
}

function toAttributes(context: CapturedContext, spanAttributes: Attributes): Attributes {
  const hasIdentity = IDENTITY_ATTRIBUTES.some((key) => spanAttributes[key] !== undefined)
  const values: Record<string, unknown> = {
    ...(context.distinctId && !hasIdentity ? { [DISTINCT_ID_ATTRIBUTE]: context.distinctId } : {}),
    ...(context.sessionId ? { [SESSION_ID_ATTRIBUTE]: context.sessionId } : {}),
    ...context.properties,
  }
  const attributes: Attributes = {}
  for (const [key, value] of Object.entries(values)) {
    if (hasIdentity && key === DISTINCT_ID_ATTRIBUTE) {
      continue
    }
    const attribute = toAttributeValue(value)
    if (attribute !== undefined) {
      attributes[key] = attribute
    }
  }
  return attributes
}

export function withRequestContext(span: ReadableSpan, context: CapturedContext): ReadableSpan {
  try {
    const attributes = toAttributes(context, span.attributes)
    if (Object.keys(attributes).length === 0) {
      return span
    }
    return withAttributes(span, { ...attributes, ...span.attributes })
  } catch {
    // Conversion runs inside span.end() and must never break the instrumented call.
    return span
  }
}
