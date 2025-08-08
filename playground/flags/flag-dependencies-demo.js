#!/usr/bin/env node

/**
 * Test script for flag dependencies against a local PostHog instance
 *
 * Usage:
 *   POSTHOG_PROJECT_KEY=your-key POSTHOG_PERSONAL_TOKEN=your-token node flag-dependencies-demo.js
 *
 * Or set environment variables in a .env file:
 *   POSTHOG_PROJECT_KEY=phc_1234567890abcdef
 *   POSTHOG_PERSONAL_TOKEN=phx_abcdef1234567890
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

// Configuration
const config = {
    projectKey: process.env.POSTHOG_PROJECT_KEY,
    personalToken: process.env.POSTHOG_PERSONAL_TOKEN,
    host: process.env.POSTHOG_HOST || 'http://localhost:8000',
    userId: process.env.TEST_USER_ID || 'test-user-' + Math.random().toString(36).substr(2, 9),
    flagKey: process.env.FLAG_KEY || 'test-dependent-flag',
}

function validateConfig() {
    console.log('🔍 Debug: Environment variables loaded:')
    console.log(
        `   POSTHOG_PROJECT_KEY: ${process.env.POSTHOG_PROJECT_KEY ? process.env.POSTHOG_PROJECT_KEY.substring(0, 8) + '...' : 'NOT SET'}`
    )
    console.log(
        `   POSTHOG_PERSONAL_TOKEN: ${process.env.POSTHOG_PERSONAL_TOKEN ? process.env.POSTHOG_PERSONAL_TOKEN.substring(0, 8) + '...' : 'NOT SET'}`
    )
    console.log(`   POSTHOG_HOST: ${process.env.POSTHOG_HOST || 'NOT SET'}`)
    console.log('')

    const missing = []
    if (!config.projectKey) missing.push('POSTHOG_PROJECT_KEY')
    if (!config.personalToken) missing.push('POSTHOG_PERSONAL_TOKEN')

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:')
        missing.forEach((key) => console.error(`   ${key}`))
        console.error('\nUsage:')
        console.error('  POSTHOG_PROJECT_KEY=your-key POSTHOG_PERSONAL_TOKEN=your-token node flag-dependencies-demo.js')
        console.error('\nOr create a .env file with these variables.')
        process.exit(1)
    }
}

async function testFlagDependencies() {
    console.log('🚀 Testing Flag Dependencies with Local PostHog Instance\n')

    console.log('🔧 Configuration:')
    console.log(`   Host: ${config.host}`)
    console.log(`   Project Key: ${config.projectKey.substring(0, 8)}...`)
    console.log(`   Personal Token: ${config.personalToken.substring(0, 8)}...`)
    console.log(`   Test User ID: ${config.userId}\n`)

    // Initialize PostHog client
    const posthog = new PostHog(config.projectKey, {
        host: config.host,
        personalApiKey: config.personalToken,
        fetchRetryCount: 0,
    })

    // Enable debug mode to see what's happening
    posthog.debug(true)

    try {
        console.log('⏳ Waiting for flags to load...')

        // Wait for flags to load
        let attempts = 0
        const maxAttempts = 10
        while (!posthog.featureFlagsPoller?.isLocalEvaluationReady() && attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 500))
            attempts++
        }

        if (!posthog.featureFlagsPoller?.isLocalEvaluationReady()) {
            console.warn('⚠️  Local evaluation not ready after 5 seconds. Continuing anyway...\n')
        } else {
            console.log('✅ Flags loaded successfully!\n')
        }

        // Test the specific flag
        console.log(`🎯 Testing ${config.flagKey}:`)

        try {
            const flagResult = await posthog.getFeatureFlag(config.flagKey, config.userId, {
                personProperties: {
                    $virt_revenue: 1000001,
                    email: 'test@example.com',
                },
            })

            console.log(`   Result: ${flagResult}`)

            if (flagResult === undefined) {
                console.log("   ℹ️  Flag not found or couldn't be evaluated locally")
                console.log('   This could mean:')
                console.log("     • Flag doesn't exist in your PostHog instance")
                console.log('     • Local evaluation failed and fell back to remote')
                console.log('     • Flag has unsupported conditions for local eval')
            } else {
                console.log(`   ✅ Flag evaluated successfully: ${flagResult}`)
            }
        } catch (error) {
            console.error(`   ❌ Error evaluating ${config.flagKey}:`, error.message)
        }

        // Test with different user properties
        console.log('\n🧪 Testing with different user properties:')

        const testScenarios = [
            {
                name: 'Basic user',
                properties: { $virt_revenue: 1000, email: 'basic@example.com' },
            },
            {
                name: 'Premium user',
                properties: { $virt_revenue: 10000001, email: 'premium@example.com' },
            },
        ]

        for (const scenario of testScenarios) {
            try {
                const result = await posthog.getFeatureFlag('test-dependent-flag', config.userId, {
                    personProperties: scenario.properties,
                })
                console.log(`   ${scenario.name}: ${result}`)
            } catch (error) {
                console.log(`   ${scenario.name}: Error - ${error.message}`)
            }
        }

        console.log('\n📊 Flag dependency information:')

        if (posthog.featureFlagsPoller?.dependencyGraph) {
            const graph = posthog.featureFlagsPoller.dependencyGraph
            const allFlags = graph.getAllFlags()

            console.log(`   Total flags in dependency graph: ${allFlags.size}`)

            if (allFlags.has(config.flagKey)) {
                const dependencies = graph.getDependencies(config.flagKey)
                console.log(`   ${config.flagKey} dependencies: [${Array.from(dependencies).join(', ') || 'none'}]`)
            } else {
                console.log(`   ${config.flagKey} not found in dependency graph`)
            }

            // Check for cycles
            const cycles = graph.detectCycles()
            if (cycles.length > 0) {
                console.log(`   ⚠️  Cyclic dependencies detected: ${cycles.join(', ')}`)
            } else {
                console.log('   ✅ No cyclic dependencies detected')
            }
        } else {
            console.log('   ℹ️  Dependency graph not available (might be building or disabled)')
        }

        console.log('\n🎉 Test completed!')
    } catch (error) {
        console.error('❌ Unexpected error:', error)
    } finally {
        await posthog.shutdown()
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...')
    process.exit(0)
})

// Main execution
if (require.main === module) {
    validateConfig()
    testFlagDependencies().catch((error) => {
        console.error('💥 Fatal error:', error)
        process.exit(1)
    })
}

module.exports = { testFlagDependencies }
