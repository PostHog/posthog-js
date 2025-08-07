#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-console */
/**
 * Simple test script for PostHog remote config endpoint.
 */

const { PostHog } = require('../../packages/node/lib/node')

// Initialize PostHog client
const posthog = new PostHog('phc_...', {
    personalApiKey: 'phx_...', // or 'phx_...'
    host: 'http://localhost:8000', // or 'https://us.posthog.com'
    debug: true,
})

async function testRemoteConfig() {
    console.log('Testing remote config endpoint...')

    // Test feature flag key - replace with an actual flag key from your project
    const flagKey = 'unencrypted-remote-config-setting'

    try {
        // Get remote config payload
        const payload = await posthog.getRemoteConfigPayload(flagKey)
        console.log(`✅ Success! Remote config payload for '${flagKey}':`, payload)
    } catch (error) {
        console.error(`❌ Error getting remote config:`, error.message)
    } finally {
        // Clean shutdown
        await posthog.shutdown()
    }
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    process.exit(1)
})

// Run the test
if (require.main === module) {
    testRemoteConfig()
}
