import { sanitizeValues } from './utils'

const DEFAULT_MAX_DEPTH = 3
const MAX_STACK_LINES = 20

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
      out[key] = serializeError((value as unknown as Record<string, unknown>)[key], depth - 1)
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

export function stringifyError(error: unknown): string {
  try {
    return JSON.stringify(sanitizeValues(serializeError(error)))
  } catch {
    if (error instanceof Error) {
      return JSON.stringify({ name: error.name, message: error.message })
    }
    return JSON.stringify({ message: String(error) })
  }
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
