// These properties are also used by separately emitted legacy extension bundles.
const globallyReservedPrivateProperties = ['_addCaptureHook', '_send_request']

const crossBundlePrivateProperties = [
    ...globallyReservedPrivateProperties,
    '_internalEventEmitter',
    '_isFeatureFlagCacheStale',
    '_onIdentityChanged',
    '_onIdentityCleared',
    '_originatedFromCaptureException',
    '_shouldDisableFlags',
].sort()

// These names occur independently in both artifacts but are not exchanged across
// their boundary. Keep them classified so a new, unreviewed overlap fails the build.
const knownNonAbiOverlaps = [
    '_POSTHOG_REMOTE_CONFIG',
    '_batchKey',
    '_buffer',
    '_config',
    '_enqueue',
    '_events',
    '_extends',
    '_flush',
    '_instance',
    '_is_bot',
    '_loadRemoteConfigJSON',
    '_loadRemoteConfigJs',
    '_loadScript',
    '_log',
    '_noTruncate',
    '_onRemoteConfig',
    '_persistence',
    '_queue',
    '_refreshInterval',
    '_runBeforeSend',
    '_startRefreshInterval',
]

module.exports = {
    crossBundlePrivateProperties,
    globallyReservedPrivateProperties,
    knownNonAbiOverlaps,
}
