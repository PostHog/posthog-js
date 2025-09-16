#!/usr/bin/env node
/**
 * Heap Snapshot Helper for PostHog Memory Leak Analysis
 *
 * This script takes heap snapshots before/after operations to help
 * identify what objects are being retained in memory.
 *
 * Usage:
 * 1. node --inspect heap-snapshot-helper.js
 * 2. Open chrome://inspect in Chrome
 * 3. Click "Open dedicated DevTools for Node"
 * 4. Go to Memory tab and take heap snapshots manually
 *
 * Or use programmatic snapshots:
 * node --expose-gc heap-snapshot-helper.js
 */

const { PostHog } = require('../../../packages/node/dist/node/index.cjs')
const { readFileSync, existsSync, writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const v8 = require('v8')

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
}

class HeapSnapshotHelper {
    constructor() {
        this.snapshotDir = join(__dirname, 'heap-snapshots')
        this.ensureSnapshotDir()

        this.posthog = new PostHog(CONFIG.PROJECT_API_KEY, {
            personalApiKey: CONFIG.PERSONAL_API_KEY,
            host: CONFIG.HOST,
            maxCacheSize: 1000,
            debug: false,
        })

        this.distinctIds = Array.from({ length: 100 }, (_, i) => `user_${i}`)
        this.personProperties = [
            { plan: 'free', tier: 'basic' },
            { plan: 'pro', tier: 'premium' },
            { plan: 'enterprise', tier: 'enterprise' },
        ]
    }

    ensureSnapshotDir() {
        if (!existsSync(this.snapshotDir)) {
            mkdirSync(this.snapshotDir, { recursive: true })
        }
    }

    takeHeapSnapshot(label) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `${timestamp}-${label}.heapsnapshot`
        const filepath = join(this.snapshotDir, filename)

        console.log(`📸 Taking heap snapshot: ${filename}`)
        const snapshot = v8.writeHeapSnapshot(filepath)
        console.log(`   Saved to: ${filepath}`)
        return filepath
    }

    async forceGC() {
        if (global.gc) {
            global.gc()
            global.gc()
            await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }

    logMemory(label) {
        const usage = process.memoryUsage()
        const heap = Math.round(usage.heapUsed / 1024 / 1024)
        const total = Math.round(usage.heapTotal / 1024 / 1024)
        const rss = Math.round(usage.rss / 1024 / 1024)
        console.log(`[${label}] Memory - RSS: ${rss}MB, Heap: ${heap}MB/${total}MB`)
        return { heap, total, rss }
    }

    async runSnapshotAnalysis() {
        console.log('📸 Starting Heap Snapshot Analysis for PostHog Memory Leaks')
        console.log('Configuration:', {
            flagKey: CONFIG.FLAG_KEY,
            snapshotDir: this.snapshotDir,
        })

        if (CONFIG.PERSONAL_API_KEY) {
            console.log('\n⏳ Waiting for local evaluation to be ready...')
            await this.posthog.waitForLocalEvaluationReady(10000)
        }

        await this.forceGC()
        this.logMemory('BASELINE')
        this.takeHeapSnapshot('00-baseline')

        console.log('\n🧪 Running operations that caused memory leaks...')

        // Based on our earlier test, payload operations were the worst
        console.log('\n1️⃣  Testing getFeatureFlagPayload (suspected leak source)')
        await this.testFeatureFlagPayloads()

        console.log('\n2️⃣  Testing getAllFlagsAndPayloads (suspected leak source)')
        await this.testGetAllFlagsAndPayloads()

        console.log('\n3️⃣  Testing distinctId cache (suspected leak source)')
        await this.testDistinctIdCache()

        await this.forceGC()
        this.logMemory('FINAL')
        this.takeHeapSnapshot('99-final')

        this.generateAnalysisInstructions()
    }

    async testFeatureFlagPayloads() {
        await this.forceGC()
        this.logMemory('Payloads-START')
        this.takeHeapSnapshot('01-before-payloads')

        // Run 1000 payload operations
        for (let i = 0; i < 1000; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getFeatureFlagPayload(CONFIG.FLAG_KEY, distinctId, undefined, {
                    personProperties: personProps,
                    onlyEvaluateLocally: true,
                })
            } catch (error) {
                // Ignore errors
            }
        }

        await this.forceGC()
        this.logMemory('Payloads-END')
        this.takeHeapSnapshot('02-after-payloads')
    }

    async testGetAllFlagsAndPayloads() {
        await this.forceGC()
        this.logMemory('AllPayloads-START')
        this.takeHeapSnapshot('03-before-all-payloads')

        // Run 1000 getAllFlagsAndPayloads operations
        for (let i = 0; i < 1000; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]
            const personProps = this.personProperties[i % this.personProperties.length]

            try {
                await this.posthog.getAllFlagsAndPayloads(distinctId, {
                    personProperties: personProps,
                    onlyEvaluateLocally: true,
                })
            } catch (error) {
                // Ignore errors
            }
        }

        await this.forceGC()
        this.logMemory('AllPayloads-END')
        this.takeHeapSnapshot('04-after-all-payloads')
    }

    async testDistinctIdCache() {
        await this.forceGC()
        this.logMemory('Cache-START')
        this.takeHeapSnapshot('05-before-cache')

        // Run 1000 operations with event reporting enabled to populate cache
        for (let i = 0; i < 1000; i++) {
            const distinctId = this.distinctIds[i % this.distinctIds.length]

            try {
                await this.posthog.getFeatureFlag(CONFIG.FLAG_KEY, distinctId, {
                    sendFeatureFlagEvents: true, // This populates the cache
                })
            } catch (error) {
                // Ignore errors
            }
        }

        await this.forceGC()
        this.logMemory('Cache-END')
        this.takeHeapSnapshot('06-after-cache')
    }

    generateAnalysisInstructions() {
        console.log('\n' + '='.repeat(80))
        console.log('📸 HEAP SNAPSHOT ANALYSIS INSTRUCTIONS')
        console.log('='.repeat(80))

        console.log('\n📁 Snapshots saved to:', this.snapshotDir)
        console.log('\n🔍 How to analyze the snapshots:')
        console.log('1. Open Chrome DevTools')
        console.log('2. Go to Memory tab')
        console.log('3. Load snapshots by clicking "Load" button')
        console.log('4. Compare snapshots to see what objects are accumulating')

        console.log('\n📊 Recommended analysis workflow:')
        console.log('1. Compare "00-baseline" with "02-after-payloads"')
        console.log('   - Look for objects that increased significantly')
        console.log('   - Focus on PostHog-related objects and arrays')

        console.log('\n2. Compare "03-before-all-payloads" with "04-after-all-payloads"')
        console.log('   - Check if getAllFlagsAndPayloads leaks more than individual calls')

        console.log('\n3. Compare "05-before-cache" with "06-after-cache"')
        console.log('   - Look for distinctIdHasSentFlagCalls cache growth')
        console.log('   - Check for string accumulation patterns')

        console.log('\n🎯 What to look for:')
        console.log('- Arrays or objects with increasing element counts')
        console.log('- String accumulation (cache keys, distinct IDs)')
        console.log("- Closure/function references that aren't being released")
        console.log('- Promise chains or event listeners that persist')

        console.log('\n💡 Key objects to investigate:')
        console.log('- distinctIdHasSentFlagCalls (should be in PostHog client)')
        console.log('- featureFlags arrays (in FeatureFlagsPoller)')
        console.log('- cohorts objects (cached cohort data)')
        console.log('- Promise objects (unresolved promises)')

        console.log('\n🛠️  Alternative heap analysis tools:')
        console.log('- clinic.js heap profiler: npm install -g clinic')
        console.log('- memwatch-next: npm install memwatch-next')
        console.log('- Node.js --inspect flag for Chrome DevTools')

        console.log('\nHeap snapshot analysis ready. 📸')
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...')
        try {
            await this.posthog._shutdown(5000)
        } catch (error) {
            console.error('Error during cleanup:', error)
        }
        process.exit(0)
    }
}

// Quick memory leak reproduction script
async function quickMemoryLeakRepro() {
    console.log('🚀 Quick Memory Leak Reproduction')
    console.log('This will reproduce the memory leak in a simplified way for analysis')

    const posthog = new PostHog(CONFIG.PROJECT_API_KEY, {
        personalApiKey: CONFIG.PERSONAL_API_KEY,
        host: CONFIG.HOST,
        maxCacheSize: 1000,
        debug: false,
    })

    if (CONFIG.PERSONAL_API_KEY) {
        await posthog.waitForLocalEvaluationReady(10000)
    }

    console.log('\n📊 Memory before operations:')
    console.log(process.memoryUsage())

    // Reproduce the exact pattern that caused the leak
    console.log('\n🔄 Running payload operations (known to leak)...')
    for (let i = 0; i < 2000; i++) {
        try {
            await posthog.getAllFlagsAndPayloads(`user_${i % 100}`, {
                personProperties: { plan: 'premium' },
                onlyEvaluateLocally: true,
            })
        } catch (error) {
            // Ignore errors
        }

        if (i % 500 === 0) {
            const mem = process.memoryUsage()
            console.log(`[${i}] Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`)
        }
    }

    console.log('\n📊 Memory after operations:')
    console.log(process.memoryUsage())

    await posthog._shutdown()
}

// Run analysis
if (require.main === module) {
    if (!CONFIG.PROJECT_API_KEY) {
        console.error('❌ Missing PostHog Project API Key!')
        process.exit(1)
    }

    const mode = process.argv[2] || 'snapshot'

    if (mode === 'quick') {
        quickMemoryLeakRepro().catch(console.error)
    } else {
        const helper = new HeapSnapshotHelper()
        process.on('SIGINT', helper.cleanup.bind(helper))
        helper.runSnapshotAnalysis().catch(console.error)
    }
}

module.exports = HeapSnapshotHelper
