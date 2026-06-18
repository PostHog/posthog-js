import { ErrorTracking as CoreErrorTracking } from '@posthog/core'

/**
 * Builds PostHog error-tracking properties (`$exception_list`) from arbitrary
 * thrown values, reusing `@posthog/core`'s shared coercers + stack parser
 * (the same builder the MCP and Node SDKs use) instead of a bespoke parser.
 * Node-only frame modifiers (source context, relative paths) live in
 * `posthog-node` and require async fs access, so they're intentionally omitted.
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

/**
 * Captures structured exception properties from any thrown value, returning the
 * `$exception_list` shape PostHog error tracking expects — so CLI command
 * failures group and symbolicate like exceptions from every other PostHog SDK.
 */
export function captureException(error: unknown): CoreErrorTracking.ErrorProperties {
    return errorPropertiesBuilder.buildFromUnknown(error)
}
