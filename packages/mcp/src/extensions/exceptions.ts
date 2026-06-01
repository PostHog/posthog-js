import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

/**
 * Builds PostHog error-tracking properties (`$exception_list`) from arbitrary
 * thrown values, reusing `@posthog/core`'s shared coercers + stack parser
 * instead of a bespoke V8 parser. Mirrors how `posthog-node` constructs its
 * builder, minus the Node-only frame modifiers (source context, relative
 * paths) which live in the `posthog-node` package and require async fs access.
 */
const errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
  [
    new CoreErrorTracking.EventCoercer(),
    new CoreErrorTracking.ErrorCoercer(),
    new CoreErrorTracking.ObjectCoercer(),
    new CoreErrorTracking.StringCoercer(),
    new CoreErrorTracking.PrimitiveCoercer(),
  ],
  CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser)
)

interface CallToolContentPart {
  text?: unknown
  type?: unknown
}

interface CallToolResult {
  content: unknown[]
  isError: unknown
}

/**
 * Captures structured exception properties from any thrown value.
 *
 * Returns the `$exception_list` shape PostHog error tracking expects, so MCP
 * tool failures group and (with uploaded source maps) symbolicate the same way
 * as exceptions from any other PostHog SDK.
 *
 * @param error - The thrown value (Error, string, object, CallToolResult, or anything).
 * @returns Core `ErrorProperties` ready to spread onto a `$exception` event.
 */
export function captureException(error: unknown): CoreErrorTracking.ErrorProperties {
  // MCP SDK 1.21.0+ converts tool errors to CallToolResult, which the core
  // coercers don't recognize. Extract the human-readable message first so the
  // exception still carries something useful.
  const normalized = isCallToolResult(error) ? extractCallToolResultMessage(error) : error
  return errorPropertiesBuilder.buildFromUnknown(normalized)
}

/**
 * Detects a CallToolResult error object (SDK 1.21.0+ format):
 * `{ content: [{ type: "text", text: "..." }], isError: true }`.
 */
function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    value !== null &&
    typeof value === 'object' &&
    'isError' in value &&
    'content' in value &&
    Array.isArray((value as { content?: unknown }).content)
  )
}

function isTextContentPart(value: unknown): value is { text: string } {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const contentPart = value as CallToolContentPart
  return contentPart.type === 'text' && typeof contentPart.text === 'string'
}

/**
 * Extracts the concatenated text from a CallToolResult's content array.
 * The SDK strips the original Error, so only the message survives.
 */
function extractCallToolResultMessage(result: CallToolResult): string {
  return (
    result.content
      .filter(isTextContentPart)
      .map((contentPart) => contentPart.text)
      .join(' ')
      .trim() || 'Unknown error'
  )
}
