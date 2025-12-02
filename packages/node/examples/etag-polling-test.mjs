#!/usr/bin/env node
/* eslint-env node */
/* global globalThis */
/**
 * ETag Polling Test Script
 *
 * Tests ETag support for local evaluation polling by polling every 5 seconds
 * and logging the stored flags and ETag behavior.
 *
 * Usage:
 *   node examples/etag-polling-test.mjs
 *
 * Create a .env file with:
 *   POSTHOG_PROJECT_API_KEY=your_project_api_key
 *   POSTHOG_PERSONAL_API_KEY=your_personal_api_key
 *   POSTHOG_HOST=https://us.i.posthog.com  # optional
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env file if it exists
function loadEnvFile() {
  const envPaths = [
    resolve(__dirname, '.env'), // packages/node/examples/.env
    resolve(__dirname, '..', '.env'), // packages/node/.env
    resolve(process.cwd(), '.env'), // current working directory
    resolve(__dirname, '..', '..', '..', '.env'), // repo root
  ]

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log(`Loading environment from: ${envPath}\n`)
      const content = readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=')
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim()
            const value = trimmed
              .slice(eqIndex + 1)
              .trim()
              .replace(/^["']|["']$/g, '')
            if (!process.env[key]) {
              process.env[key] = value
            }
          }
        }
      }
      return
    }
  }
}

loadEnvFile()

const API_KEY = process.env.POSTHOG_PROJECT_API_KEY
const PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY
const HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
const POLL_INTERVAL_MS = 5000

if (!API_KEY || !PERSONAL_API_KEY) {
  console.error('Missing required environment variables.')
  console.error('')
  console.error('Create a .env file with:')
  console.error('  POSTHOG_PROJECT_API_KEY=your_project_api_key')
  console.error('  POSTHOG_PERSONAL_API_KEY=your_personal_api_key')
  console.error('  POSTHOG_HOST=https://us.i.posthog.com  # optional')
  process.exit(1)
}

// Import PostHog from the built output
const { PostHog } = await import('../dist/entrypoints/index.node.mjs')

console.log('='.repeat(60))
console.log('ETag Polling Test')
console.log('='.repeat(60))
console.log(`Host: ${HOST}`)
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`)
console.log('='.repeat(60))
console.log('')

// Track request/response details
let requestCount = 0

// Create a custom fetch wrapper to log ETag behavior
const originalFetch = globalThis.fetch
const loggingFetch = async (url, options) => {
  requestCount++
  const reqNum = requestCount
  const timestamp = new Date().toISOString()

  // Only log for local_evaluation endpoint
  if (typeof url === 'string' && url.includes('local_evaluation')) {
    const headers = options?.headers
    const ifNoneMatch = headers?.['If-None-Match']

    console.log(`[${timestamp}] Request #${reqNum}`)
    console.log(`  If-None-Match: ${ifNoneMatch || '(none)'}`)

    const response = await originalFetch(url, options)

    const etag = response.headers.get('ETag')
    console.log(`  Status: ${response.status} ${response.status === 304 ? '(Not Modified)' : ''}`)
    console.log(`  ETag: ${etag || '(none)'}`)

    if (response.status === 304) {
      console.log('  -> Using cached flags (no data transfer)')
    } else if (response.status === 200) {
      console.log('  -> Received fresh flags')
    }
    console.log('')

    return response
  }

  return originalFetch(url, options)
}

// Initialize PostHog with custom fetch
const posthog = new PostHog(API_KEY, {
  host: HOST,
  personalApiKey: PERSONAL_API_KEY,
  featureFlagsPollingInterval: POLL_INTERVAL_MS,
  fetch: loggingFetch,
  debug: false,
})

// Log flags after each poll
async function logFlags() {
  // Access internal state to get the flags
  const poller = posthog.featureFlagsPoller
  if (!poller) {
    console.log('Poller not initialized yet')
    return
  }

  const flags = poller.featureFlags || []
  const etag = poller.flagsEtag

  console.log('-'.repeat(40))
  console.log(`Stored ETag: ${etag || '(none)'}`)
  console.log(`Flag count: ${flags.length}`)

  if (flags.length > 0) {
    console.log('Flags:')
    for (const flag of flags.slice(0, 10)) {
      console.log(`  - ${flag.key} (active: ${flag.active})`)
    }
    if (flags.length > 10) {
      console.log(`  ... and ${flags.length - 10} more`)
    }
  }
  console.log('-'.repeat(40))
  console.log('')
}

// Wait for initial load
console.log('Waiting for initial flag load...\n')

posthog.on('featureFlagsLoaded', async () => {
  console.log('Initial flags loaded!\n')
  await logFlags()
})

// Periodically log the current state
setInterval(async () => {
  await logFlags()
}, POLL_INTERVAL_MS + 1000) // Offset by 1s to log after each poll

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await posthog.shutdown()
  process.exit(0)
})

console.log('Press Ctrl+C to stop\n')
