#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-console */
/**
 * Simple test script for PostHog remote config endpoint.
 */

// Load environment variables from .env file
try {
    require('dotenv').config()
} catch (e) {
    // dotenv not available, try to read .env manually
    try {
        const fs = require('fs')
        const path = require('path')
        const envPath = path.join(__dirname, '.env')
        const envFile = fs.readFileSync(envPath, 'utf8')

        envFile.split('\n').forEach((line) => {
            const [key, ...valueParts] = line.split('=')
            if (key && !key.startsWith('#') && valueParts.length > 0) {
                const value = valueParts.join('=').trim()
                if (!process.env[key]) {
                    process.env[key] = value
                }
            }
        })
    } catch (err) {
        console.warn('⚠️  Could not load .env file:', err.message)
    }
}

// Try to load PostHog from built version, with helpful error if not built yet
let PostHog
try {
    PostHog = require('../../packages/node/dist/node/index.cjs').PostHog
} catch (err) {
    console.error('❌ PostHog Node.js package not built yet.')
    console.error('   Please run: pnpm build')
    console.error('   Or from the packages/node directory: pnpm build')
    process.exit(1)
}

// Configuration from environment
const config = {
    projectKey: process.env.POSTHOG_PROJECT_KEY,
    personalToken: process.env.POSTHOG_PERSONAL_TOKEN,
    host: process.env.POSTHOG_HOST || 'http://localhost:8000',
    flagKey: process.env.REMOTE_CONFIG_FLAG_KEY || 'unencrypted-remote-config-setting',
}

function validateConfig() {
    const missing = []
    if (!config.projectKey) missing.push('POSTHOG_PROJECT_KEY')
    if (!config.personalToken) missing.push('POSTHOG_PERSONAL_TOKEN')

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:')
        missing.forEach((key) => console.error(`   ${key}`))
        console.error('\nCreate a .env file with these variables or set them directly.')
        process.exit(1)
    }
}

// Initialize PostHog client
const posthog = new PostHog(config.projectKey, {
    personalApiKey: config.personalToken,
    host: config.host,
    debug: true,
})

async function testRemoteConfig() {
    console.log('🧪 Testing PostHog Remote Config\n')

    console.log('🔧 Configuration:')
    console.log(`   Host: ${config.host}`)
    console.log(`   Project Key: ${config.projectKey.substring(0, 8)}...`)
    console.log(`   Personal Token: ${config.personalToken.substring(0, 8)}...`)
    console.log(`   Flag Key: ${config.flagKey}\n`)

    console.log('⏳ Testing remote config endpoint...')

    try {
        // Get remote config payload
        const payload = await posthog.getRemoteConfigPayload(config.flagKey)
        console.log(`✅ Success! Remote config payload for '${config.flagKey}':`, payload)
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
    validateConfig()
    testRemoteConfig().catch((error) => {
        console.error('💥 Fatal error:', error)
        process.exit(1)
    })
}
