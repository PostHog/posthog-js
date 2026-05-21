import type { Event, RedactFunction, UnredactedEvent } from '../types'

/**
 * Set of field names that should be protected from redaction.
 * These fields contain system-level identifiers and metadata that
 * need to be preserved for analytics tracking.
 */
const PROTECTED_FIELDS = new Set([
  'sessionId',
  'id',
  'apiKey',
  'server',
  'identifyActorGivenId',
  'identifyActorName',
  'identifyData',
  'resourceName',
  'toolDescription',
  'listedToolNames',
  'eventType',
  'actorId',
  'properties',
])

/**
 * Recursively applies a redaction function to all string values in an object.
 * This ensures that sensitive information is removed from all string fields
 * before events are sent to the analytics service.
 *
 * @param obj - The object to redact strings from
 * @param redactFn - The redaction function to apply to each string
 * @param path - The current path in the object tree (used to check protected fields)
 * @param isProtected - Whether the current object/value is within a protected field
 * @returns A new object with all strings redacted
 */
async function redactStringsInObject(
  obj: unknown,
  redactFn: RedactFunction,
  path = '',
  isProtected = false
): Promise<unknown> {
  if (obj === null || obj === undefined) {
    return obj
  }

  // Handle strings
  if (typeof obj === 'string') {
    // Don't redact if this field or any parent field is protected
    if (isProtected) {
      return obj
    }
    return await redactFn(obj)
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return Promise.all(
      obj.map((item, index) => redactStringsInObject(item, redactFn, `${path}[${index}]`, isProtected))
    )
  }

  // Handle dates (don't redact)
  if (obj instanceof Date) {
    return obj
  }

  // Handle objects
  if (typeof obj === 'object') {
    const redactedObj: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      // Skip functions and undefined values
      if (typeof value === 'function' || value === undefined) {
        continue
      }

      // Build the path for nested fields
      const fieldPath = path ? `${path}.${key}` : key
      // Check if this field is protected (only check at top level)
      const isFieldProtected = isProtected || (path === '' && PROTECTED_FIELDS.has(key))
      redactedObj[key] = await redactStringsInObject(value, redactFn, fieldPath, isFieldProtected)
    }

    return redactedObj
  }

  // For all other types (numbers, booleans, etc.), return as-is
  return obj
}

/**
 * Applies the customer's redaction function to all string fields in an Event object.
 * This is the main entry point for redacting sensitive information from events
 * before they are sent to the analytics service.
 *
 * @param event - The event to redact
 * @param redactFn - The customer's redaction function
 * @returns A new event object with all strings redacted
 */
export function redactEvent(event: UnredactedEvent, redactFn: RedactFunction): Promise<Event> {
  return redactStringsInObject(event, redactFn, '', false) as Promise<Event>
}
