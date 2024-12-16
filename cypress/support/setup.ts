import { Compression, DecideResponse, PostHogConfig, RemoteConfig } from '../../src/types'

import { EventEmitter } from 'events'

export const interceptRemoteConfig = (remoteConfigOverrides: Partial<RemoteConfig>) => {
    cy.intercept('GET', '/array/*/config*', remoteConfigOverrides).as('remote-config')
    // We force the config.js to be a 404 as we don't want to test it
    cy.intercept('GET', '/array/*/config.js', { statusCode: 404 })
}

export const interceptFeatureFlags = (featureFlagsOverrides: Partial<DecideResponse>) => {
    cy.intercept('POST', '/decide/*', featureFlagsOverrides).as('feature-flags')
}

export const start = ({
    waitForRemoteConfig = true,
    waitForFeatureFlags = true,
    initPosthog = true,
    resetOnInit = false,
    options = {},
    remoteConfigOverrides = {
        sessionRecording: undefined,
        capturePerformance: true,
    },
    featureFlagsOverrides = {},
    url = './playground/cypress-full',
}: {
    waitForRemoteConfig?: boolean
    waitForFeatureFlags?: boolean
    initPosthog?: boolean
    resetOnInit?: boolean
    options?: Partial<PostHogConfig>
    featureFlagsOverrides?: Partial<DecideResponse>
    remoteConfigOverrides?: Partial<RemoteConfig>
    url?: string
}) => {
    // sometimes we have too many listeners in this test environment
    // that breaks the event emitter listeners in error tracking tests
    // we don't see the error in production, so it's fine to increase the limit here
    EventEmitter.prototype.setMaxListeners(100)

    const remoteConfigResponse: Partial<RemoteConfig> = {
        supportedCompression: [Compression.GZipJS],
        autocaptureExceptions: false,
        hasFeatureFlags: true,
        ...remoteConfigOverrides,
    }

    const featureFlagsResponse: Partial<DecideResponse> = {
        featureFlags: { 'session-recording-player': true },
        ...featureFlagsOverrides,
    }

    interceptFeatureFlags(featureFlagsResponse)
    interceptRemoteConfig(remoteConfigResponse)

    cy.visit(url)

    if (initPosthog) {
        cy.posthogInit({
            opt_out_useragent_filter: true, // we ARE a bot, so we need to enable this opt-out
            ...options,
        })
    }

    if (resetOnInit) {
        cy.posthog().invoke('reset', true)
    }

    if (waitForRemoteConfig) {
        cy.wait('@remote-config')
    }

    if (waitForFeatureFlags) {
        cy.wait('@feature-flags')
    }
}
