#!/usr/bin/env node
/**
 * Memory Leak Diagnostic Script for PostHog Node.js SDK
 *
 * This script tests individual methods in isolation to pinpoint
 * the exact source of memory leaks in feature flag functionality.
 *
 * Usage:
 * - node --expose-gc memory-leak-diagnostic.js
 * - node --inspect --expose-gc memory-leak-diagnostic.js
 */

const { PostHog } = require('../../../packages/node/dist/node/index.cjs')
const { readFileSync, existsSync, writeFileSync } = require('fs')
const { join } = require('path')

function loadEnvFile() {
    const envPath = join(__dirname, '..', '.env')
    if (existsSync(envPath)) {
        const envFile = readFileSync(envPath, 'utf8')
        for (const line of envFile.split('\n')) {
            const trimmedLine = line.trim()
            if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
                const [key, ...valueParts] = trimmedLine.split('=')
                const value = valueParts.join('=')
                if (key && value && !process.env[key.trim()]) {
                    process.env[key.trim()] = value.trim()
                }
            }
        }
    }
}

loadEnvFile()

const CONFIG = {
    PROJECT_API_KEY: process.env.POSTHOG_PROJECT_API_KEY || '',
    PERSONAL_API_KEY: process.env.POSTHOG_PERSONAL_API_KEY || '',
    HOST: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    FLAG_KEY: process.env.POSTHOG_TEST_FLAG_KEY || 'beta-feature',
    TEST_ITERATIONS: 5000, // Smaller iterations for isolated testing
}

class MemoryLeakDiagnostic {
    constructor() {
        this.memorySnapshots = []
        this.testResults = []

        this.posthog = new PostHog(CONFIG.PROJECT_API_KEY, {
            personalApiKey: CONFIG.PERSONAL_API_KEY,
            host: CONFIG.HOST,
            maxCacheSize: 1000,
            debug: false,
        })

        // Generate test data
        this.distinctIds = Array.from({ length: 1000 }, (_, i) => `user_${i}`)
        this.personProperties = [
            { plan: 'free', tier: 'basic' },
            { plan: 'pro', tier: 'premium' },
            { plan: 'enterprise', tier: 'enterprise' },
            { location: 'US', segment: 'B2B' },
            { location: 'EU', segment: 'B2C' },
        ]

        process.on('SIGINT', this.cleanup.bind(this))
        process.on('SIGTERM', this.cleanup.bind(this))
    }

    getMemoryUsage() {
        const usage = process.memoryUsage()
        return {
            rss: Math.round(usage.rss / 1024 / 1024),
            heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
            external: Math.round(usage.external / 1024 / 1024),
        }
    }

    forceGC() {
        if (global.gc) {
            global.gc()
            global.gc() // Run twice for better cleanup
            // Wait a bit for GC to complete
            return new Promise((resolve) => setTimeout(resolve, 100))
        }
        return Promise.resolve()
    }

    takeMemorySnapshot(label) {
        const memory = this.getMemoryUsage()
        this.memorySnapshots.push({
            label,
            timestamp: Date.now(),
            ...memory,
        })
        console.log(
            `[${label}] Memory - RSS: ${memory.rss}MB, Heap: ${memory.heapUsed}MB/${memory.heapTotal}MB, External: ${memory.external}MB`
        )
        return memory
    }

    async runDiagnosticTests() {
        console.log('🔬 Starting Memory Leak Diagnostic Tests')
        console.log('Configuration:', {
            host: CONFIG.HOST,
            projectApiKey: CONFIG.PROJECT_API_KEY.substring(0, 9) + '...',
            personalApiKey: CONFIG.PERSONAL_API_KEY ? '[REDACTED]' : '[NOT PROVIDED]',
            flagKey: CONFIG.FLAG_KEY,
            iterations: CONFIG.TEST_ITERATIONS,
        })

        // Wait for local evaluation to be ready
        if (CONFIG.PERSONAL_API_KEY) {
            console.log('\n⏳ Waiting for local evaluation to be ready...')
            const isReady = await this.posthog.waitForLocalEvaluationReady(10000)
            console.log(`Local evaluation ready: ${isReady}`)
        }

        await this.forceGC()
        this.takeMemorySnapshot('BASELINE')

        // Test each method in isolation
        await this.testGetFeatureFlag()
        await this.testIsFeatureEnabled()
        await this.testGetAllFlags()
        await this.testGetFeatureFlagPayload()
        await this.testGetAllFlagsAndPayloads()
        await this.testDistinctIdCache()
        await this.testConcurrentCalls()

        this.generateDiagnosticReport()
    }

    async testGetFeatureFlag() {
        console.log('\n🧪 Test: getFeatureFlag() method')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('getFeatureFlag-START')

        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getFeatureFlag(CONFIG.FLAG_KEY, distinctId, {
                    personProperties: personProps,
                    sendFeatureFlagEvents: false, // Isolate from event cache
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('getFeatureFlag-END')

        this.testResults.push({
            test: 'getFeatureFlag',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testIsFeatureEnabled() {
        console.log('\n🧪 Test: isFeatureEnabled() method')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('isFeatureEnabled-START')

        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.isFeatureEnabled(CONFIG.FLAG_KEY, distinctId, {
                    personProperties: personProps,
                    sendFeatureFlagEvents: false,
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('isFeatureEnabled-END')

        this.testResults.push({
            test: 'isFeatureEnabled',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testGetAllFlags() {
        console.log('\n🧪 Test: getAllFlags() method')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('getAllFlags-START')

        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getAllFlags(distinctId, {
                    personProperties: personProps,
                    onlyEvaluateLocally: true,
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('getAllFlags-END')

        this.testResults.push({
            test: 'getAllFlags',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testGetFeatureFlagPayload() {
        console.log('\n🧪 Test: getFeatureFlagPayload() method')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('getFeatureFlagPayload-START')

        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getFeatureFlagPayload(CONFIG.FLAG_KEY, distinctId, undefined, {
                    personProperties: personProps,
                    onlyEvaluateLocally: true,
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('getFeatureFlagPayload-END')

        this.testResults.push({
            test: 'getFeatureFlagPayload',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testGetAllFlagsAndPayloads() {
        console.log('\n🧪 Test: getAllFlagsAndPayloads() method')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('getAllFlagsAndPayloads-START')

        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getAllFlagsAndPayloads(distinctId, {
                    personProperties: personProps,
                    onlyEvaluateLocally: true,
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('getAllFlagsAndPayloads-END')

        this.testResults.push({
            test: 'getAllFlagsAndPayloads',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testDistinctIdCache() {
        console.log('\n🧪 Test: distinctIdHasSentFlagCalls cache behavior')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('distinctIdCache-START')

        // Test the cache that tracks which flags have been called for each distinct ID
        for (let i = 0; i < CONFIG.TEST_ITERATIONS; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]

            try {
                // This should populate the distinctIdHasSentFlagCalls cache
                await this.posthog.getFeatureFlag(CONFIG.FLAG_KEY, distinctId, {
                    sendFeatureFlagEvents: true, // Enable event reporting to populate cache
                })
            } catch (error) {
                // Ignore errors for diagnostic purposes
            }
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('distinctIdCache-END')

        this.testResults.push({
            test: 'distinctIdCache',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    async testConcurrentCalls() {
        console.log('\n🧪 Test: Concurrent flag calls (Promise accumulation)')
        await this.forceGC()
        const startMemory = this.takeMemorySnapshot('concurrent-START')

        const batchSize = 100
        const batches = CONFIG.TEST_ITERATIONS / batchSize

        for (let batch = 0; batch < batches; batch++) {
            const promises = []

            for (let i = 0; i < batchSize; i++) {
                const distinctId = this.distinctIds[(batch * batchSize + i) % this.distinctIds.length]
                const personProps = this.personProperties[i % this.personProperties.length]

                const promise = this.posthog
                    .getFeatureFlag(CONFIG.FLAG_KEY, distinctId, {
                        personProperties: personProps,
                        sendFeatureFlagEvents: false,
                    })
                    .catch(() => {}) // Ignore errors

                promises.push(promise)
            }

            await Promise.allSettled(promises)
        }

        await this.forceGC()
        const endMemory = this.takeMemorySnapshot('concurrent-END')

        this.testResults.push({
            test: 'concurrent',
            memoryGrowth: endMemory.heapUsed - startMemory.heapUsed,
            iterations: CONFIG.TEST_ITERATIONS,
        })
    }

    generateDiagnosticReport() {
        console.log('\n' + '='.repeat(80))
        console.log('🔬 MEMORY LEAK DIAGNOSTIC REPORT')
        console.log('='.repeat(80))

        // Sort by memory growth (worst first)
        const sortedResults = [...this.testResults].sort((a, b) => b.memoryGrowth - a.memoryGrowth)

        console.log('\n📊 Memory Growth by Test (MB):')
        console.log('-'.repeat(50))
        sortedResults.forEach((result, index) => {
            const growthPerIteration = ((result.memoryGrowth / result.iterations) * 1000).toFixed(3)
            const severity = result.memoryGrowth > 20 ? '🚨' : result.memoryGrowth > 5 ? '⚠️' : '✅'
            console.log(
                `${index + 1}. ${severity} ${result.test}: ${result.memoryGrowth}MB (${growthPerIteration}KB/call)`
            )
        })

        // Analysis
        const worstLeaker = sortedResults[0]
        console.log('\n🔍 ANALYSIS:')
        if (worstLeaker.memoryGrowth > 20) {
            console.log(`🚨 MAJOR LEAK: "${worstLeaker.test}" shows ${worstLeaker.memoryGrowth}MB growth`)
            console.log('   This method is the primary source of the memory leak.')
        } else if (worstLeaker.memoryGrowth > 5) {
            console.log(`⚠️  MODERATE LEAK: "${worstLeaker.test}" shows ${worstLeaker.memoryGrowth}MB growth`)
            console.log('   This method contributes to memory growth but may be acceptable.')
        } else {
            console.log('✅ No significant memory leaks detected in individual methods.')
            console.log('   The leak may be cumulative or interaction-based.')
        }

        // Specific recommendations based on findings
        console.log('\n💡 SPECIFIC RECOMMENDATIONS:')
        if (sortedResults.find((r) => r.test === 'distinctIdCache' && r.memoryGrowth > 5)) {
            console.log('- 🎯 CACHE ISSUE: distinctIdHasSentFlagCalls cache is growing unbounded')
            console.log('  Fix: Implement proper cache eviction or reduce maxCacheSize')
            console.log('  Location: packages/node/src/client.ts:712-719')
        }

        if (
            sortedResults.find(
                (r) => (r.test === 'getFeatureFlagPayload' || r.test === 'getAllFlagsAndPayloads') && r.memoryGrowth > 5
            )
        ) {
            console.log('- 🎯 PAYLOAD ISSUE: Payload operations are leaking memory')
            console.log('  Fix: Check payload caching/storage in feature flags poller')
            console.log('  Location: packages/node/src/extensions/feature-flags/feature-flags.ts')
        }

        if (sortedResults.find((r) => r.test === 'concurrent' && r.memoryGrowth > 5)) {
            console.log('- 🎯 CONCURRENCY ISSUE: Promise accumulation or event listener buildup')
            console.log('  Fix: Review promise chains and event listener cleanup')
        }

        // Save detailed report
        const reportData = {
            timestamp: new Date().toISOString(),
            config: CONFIG,
            memorySnapshots: this.memorySnapshots,
            testResults: sortedResults,
            nodeVersion: process.version,
            platform: process.platform,
        }

        const reportPath = join(__dirname, 'memory-leak-diagnostic-report.json')
        writeFileSync(reportPath, JSON.stringify(reportData, null, 2))
        console.log(`\n📋 Detailed report saved to: ${reportPath}`)

        console.log('\n🧪 Next Steps:')
        console.log('1. Focus on the method with highest memory growth')
        console.log('2. Use Chrome DevTools (node --inspect) to analyze heap snapshots')
        console.log('3. Add logging to the identified leak source')
        console.log('4. Consider running with smaller iterations to isolate the exact leak point')

        console.log('\nDiagnostic completed. 🔬')
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...')
        try {
            await this.posthog._shutdown(5000)
            console.log('PostHog client shut down successfully.')
        } catch (error) {
            console.error('Error during cleanup:', error)
        }
        process.exit(0)
    }
}

// Run diagnostics
if (require.main === module) {
    if (!CONFIG.PROJECT_API_KEY) {
        console.error('❌ Missing PostHog Project API Key!')
        console.log('   Please set POSTHOG_PROJECT_API_KEY environment variable')
        console.log('   or copy .env.example to .env and fill in your values')
        process.exit(1)
    }

    if (!global.gc) {
        console.log('⚠️  For best results, run with: node --expose-gc memory-leak-diagnostic.js')
        console.log('   This enables garbage collection for more accurate memory measurements')
        console.log('   Continuing without forced GC...\n')
    }

    const diagnostic = new MemoryLeakDiagnostic()
    diagnostic.runDiagnosticTests().catch(console.error)
}

module.exports = MemoryLeakDiagnostic
