#!/usr/bin/env node
/**
 * Strict Capture Demo
 *
 * Demonstrates the strictCapture behavior introduced with defaults >= '2026-03-19'.
 * When enabled, passing a plain string to capture() throws a TypeError instead of
 * silently warning, catching misuse at development time.
 *
 * Usage:
 *   node examples/strict-capture-test.mjs
 */

const { PostHog } = await import('../dist/entrypoints/index.node.mjs')

// --- Strict mode (via versioned defaults) ---
const strict = new PostHog('fake-key', {
  host: 'http://localhost:8000',
  defaults: '2026-03-19',
})

console.log('1. capture() with correct object form — should succeed:')
strict.capture({ distinctId: 'user-1', event: 'page_view' })
console.log('   OK\n')

console.log('2. capture() with a plain string — should throw TypeError:')
try {
  strict.capture('page_view')
} catch (e) {
  console.log(`   Caught: ${e.constructor.name}: ${e.message}\n`)
}

// --- Legacy mode (no defaults) ---
const legacy = new PostHog('fake-key', {
  host: 'http://localhost:8000',
})
legacy.debug(true)

console.log('3. capture() with a plain string in legacy mode — should warn (not throw):')
legacy.capture('page_view')
console.log('   (check the warning above)\n')

await Promise.all([strict.shutdown(), legacy.shutdown()])
console.log('Done.')
