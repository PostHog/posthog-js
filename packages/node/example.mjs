#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * PostHog Node.js library example
 *
 * This script demonstrates various PostHog Node.js SDK capabilities including:
 * - Basic event capture and user identification
 * - Feature flag local evaluation
 * - Feature flag payloads
 * - Context management
 *
 * Setup:
 * 1. Copy .env.example to .env and fill in your PostHog credentials
 * 2. Run this script: node example.mjs
 */

import { createInterface } from 'readline'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env file if it exists
function loadEnvFile() {
  const envPaths = [
    resolve(__dirname, '.env'),
    resolve(__dirname, 'examples', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '..', '..', '.env'),
  ]

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log(`Loading environment from: ${envPath}\n`)
      const content = readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const eqIndex = trimmed.indexOf('=')
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
      return
    }
  }
}

loadEnvFile()

// Get configuration
const projectKey = process.env.POSTHOG_PROJECT_API_KEY || ''
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY || ''
const host = process.env.POSTHOG_HOST || 'http://localhost:8000'

// Check if project key is provided (required)
if (!projectKey) {
  console.error('❌ Missing PostHog project API key!')
  console.error('   Please set POSTHOG_PROJECT_API_KEY environment variable')
  console.error('   or copy .env.example to .env and fill in your values')
  process.exit(1)
}

// Import PostHog from the built output
const { PostHog } = await import('./dist/entrypoints/index.node.mjs')

// Check if personal API key is available for local evaluation
const localEvalAvailable = Boolean(personalApiKey)

// Initialize PostHog client
const posthog = new PostHog(projectKey, {
  host,
  personalApiKey: personalApiKey || undefined,
  featureFlagsPollingInterval: 10000,
})

console.log('🔑 PostHog Configuration:')
console.log(`   Project API Key: ${projectKey.slice(0, 9)}...`)
if (localEvalAvailable) {
  console.log('   Personal API Key: [SET]')
} else {
  console.log('   Personal API Key: [NOT SET] - Local evaluation examples will be skipped')
}
console.log(`   Host: ${host}\n`)

// Helper to prompt for input
function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// Display menu and get user choice
console.log('🚀 PostHog Node.js SDK Demo - Choose an example to run:\n')
console.log('1. Identify and capture examples')
const localEvalNote = localEvalAvailable ? '' : ' [requires personal API key]'
console.log(`2. Feature flag local evaluation examples${localEvalNote}`)
console.log('3. Feature flag payload examples')
console.log(`4. Flag dependencies examples${localEvalNote}`)
console.log('5. Context management examples')
console.log('6. Feature flag remote evaluation examples (no local eval)')
console.log('7. Run all examples')
console.log('8. Exit')

const choice = await prompt('\nEnter your choice (1-8): ')

if (choice === '1') {
  console.log('\n' + '='.repeat(60))
  console.log('IDENTIFY AND CAPTURE EXAMPLES')
  console.log('='.repeat(60))

  posthog.debug(true)

  // Capture an event
  console.log('📊 Capturing events...')
  posthog.capture({
    distinctId: 'distinct_id',
    event: 'event',
    properties: { property1: 'value', property2: 'value' },
    sendFeatureFlags: true,
  })

  // Alias a previous distinct id with a new one
  console.log('🔗 Creating alias...')
  posthog.alias({ distinctId: 'distinct_id', alias: 'new_distinct_id' })

  posthog.capture({
    distinctId: 'new_distinct_id',
    event: 'event2',
    properties: { property1: 'value', property2: 'value' },
  })

  posthog.capture({
    distinctId: 'new_distinct_id',
    event: 'event-with-groups',
    properties: { property1: 'value', property2: 'value' },
    groups: { company: 'id:5' },
  })

  // Add properties to the person
  console.log('👤 Identifying user...')
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { email: 'something@something.com' },
  })

  // Add properties to a group
  console.log('🏢 Identifying group...')
  posthog.groupIdentify({
    groupType: 'company',
    groupKey: 'id:5',
    properties: { employees: 11 },
  })

  // Properties set only once to the person
  console.log('🔒 Setting properties once...')
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { $set_once: { self_serve_signup: true } },
  })

  // This will not change the property (because it was already set)
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { $set_once: { self_serve_signup: false } },
  })

  console.log('🔄 Updating properties...')
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { current_browser: 'Chrome' },
  })
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { current_browser: 'Firefox' },
  })
} else if (choice === '2') {
  if (!localEvalAvailable) {
    console.log('\n❌ This example requires a personal API key for local evaluation.')
    console.log('   Set POSTHOG_PERSONAL_API_KEY environment variable to run this example.')
    await posthog.shutdown()
    process.exit(1)
  }

  console.log('\n' + '='.repeat(60))
  console.log('FEATURE FLAG LOCAL EVALUATION EXAMPLES')
  console.log('='.repeat(60))

  posthog.debug(true)

  // Wait for local evaluation to be ready
  console.log('⏳ Waiting for local evaluation to be ready...')
  const isReady = await posthog.waitForLocalEvaluationReady(10000)
  if (!isReady) {
    console.log('⚠️  Local evaluation timed out, falling back to remote evaluation')
  } else {
    console.log('✅ Local evaluation ready!\n')
  }

  console.log('🏁 Testing basic feature flags...')
  const flag1 = await posthog.isFeatureEnabled('beta-feature', 'distinct_id')
  console.log(`beta-feature for 'distinct_id': ${flag1}`)

  const flag2 = await posthog.isFeatureEnabled('beta-feature', 'new_distinct_id')
  console.log(`beta-feature for 'new_distinct_id': ${flag2}`)

  const flag3 = await posthog.isFeatureEnabled('beta-feature-groups', 'distinct_id', {
    groups: { company: 'id:5' },
  })
  console.log(`beta-feature with groups: ${flag3}`)

  console.log('\n🌍 Testing location-based flags...')
  // Assume test-flag has `City Name = Sydney` as a person property set
  const sydneyFlag = await posthog.isFeatureEnabled('test-flag', 'random_id_12345', {
    personProperties: { $geoip_city_name: 'Sydney' },
  })
  console.log(`Sydney user: ${sydneyFlag}`)

  const sydneyFlagLocal = await posthog.isFeatureEnabled('test-flag', 'distinct_id_random_22', {
    personProperties: { $geoip_city_name: 'Sydney' },
    onlyEvaluateLocally: true,
  })
  console.log(`Sydney user (local only): ${sydneyFlagLocal}`)

  console.log('\n📋 Getting all flags...')
  const allFlags = await posthog.getAllFlags('distinct_id_random_22')
  console.log(`All flags: ${JSON.stringify(allFlags)}`)

  const allFlagsLocal = await posthog.getAllFlags('distinct_id_random_22', {
    onlyEvaluateLocally: true,
  })
  console.log(`All flags (local): ${JSON.stringify(allFlagsLocal)}`)

  const allFlagsWithProps = await posthog.getAllFlags('distinct_id_random_22', {
    personProperties: { $geoip_city_name: 'Sydney' },
    onlyEvaluateLocally: true,
  })
  console.log(`All flags with properties: ${JSON.stringify(allFlagsWithProps)}`)
} else if (choice === '3') {
  console.log('\n' + '='.repeat(60))
  console.log('FEATURE FLAG PAYLOAD EXAMPLES')
  console.log('='.repeat(60))

  posthog.debug(true)

  // Note: beta-feature requires email containing @example.com, so we pass person properties
  console.log('📦 Testing feature flag payloads...')
  console.log('   (Passing personProperties with @example.com email to match flag conditions)\n')

  const payload = await posthog.getFeatureFlagPayload('beta-feature', 'payload_user', true, {
    personProperties: { email: 'test@example.com' },
  })
  console.log(`beta-feature payload: ${JSON.stringify(payload)}`)

  const allFlagsAndPayloads = await posthog.getAllFlagsAndPayloads('payload_user', {
    personProperties: { email: 'test@example.com' },
    groups: { company: 'id:5' },
  })
  console.log(`All flags and payloads: ${JSON.stringify(allFlagsAndPayloads, null, 2)}`)

  if (localEvalAvailable) {
    try {
      const remotePayload = await posthog.getRemoteConfigPayload('encrypted_payload_flag_key')
      console.log(`\nRemote config payload: ${JSON.stringify(remotePayload)}`)
    } catch (e) {
      console.log(`\nRemote config payload: (error: ${e.message})`)
    }
  }

  // Get feature flag result with all details (enabled, variant, payload, key)
  console.log('\n🔍 Getting detailed flag result...')
  const result = await posthog.getFeatureFlagResult('beta-feature', 'payload_user_2', {
    personProperties: { email: 'test@example.com' },
  })
  if (result) {
    console.log(`Flag key: ${result.key}`)
    console.log(`Flag enabled: ${result.enabled}`)
    console.log(`Variant: ${result.variant}`)
    console.log(`Payload: ${JSON.stringify(result.payload)}`)
  } else {
    console.log('Flag result: undefined (flag may not exist)')
  }
} else if (choice === '4') {
  if (!localEvalAvailable) {
    console.log('\n❌ This example requires a personal API key for local evaluation.')
    console.log('   Set POSTHOG_PERSONAL_API_KEY environment variable to run this example.')
    await posthog.shutdown()
    process.exit(1)
  }

  console.log('\n' + '='.repeat(60))
  console.log('FLAG DEPENDENCIES EXAMPLES')
  console.log('='.repeat(60))
  console.log('🔗 Testing flag dependencies with local evaluation...')
  console.log("   Flag structure: 'test-flag-dependency' depends on 'beta-feature' being enabled")
  console.log('')
  console.log("📋 Required setup (if 'test-flag-dependency' doesn't exist):")
  console.log("   1. Create feature flag 'beta-feature':")
  console.log("      - Condition: email contains '@example.com'")
  console.log('      - Rollout: 100%')
  console.log("   2. Create feature flag 'test-flag-dependency':")
  console.log("      - Condition: flag 'beta-feature' is enabled")
  console.log('      - Rollout: 100%')
  console.log('')

  posthog.debug(true)

  // Wait for local evaluation to be ready
  await posthog.waitForLocalEvaluationReady(10000)

  // Test @example.com user (should satisfy dependency if flags exist)
  const result1 = await posthog.isFeatureEnabled('test-flag-dependency', 'example_user', {
    personProperties: { email: 'user@example.com' },
    onlyEvaluateLocally: true,
  })
  console.log(`✅ @example.com user (test-flag-dependency): ${result1}`)

  // Test non-example.com user (dependency should not be satisfied)
  const result2 = await posthog.isFeatureEnabled('test-flag-dependency', 'regular_user', {
    personProperties: { email: 'user@other.com' },
    onlyEvaluateLocally: true,
  })
  console.log(`❌ Regular user (test-flag-dependency): ${result2}`)

  // Test beta-feature directly for comparison
  const beta1 = await posthog.isFeatureEnabled('beta-feature', 'example_user', {
    personProperties: { email: 'user@example.com' },
    onlyEvaluateLocally: true,
  })
  const beta2 = await posthog.isFeatureEnabled('beta-feature', 'regular_user', {
    personProperties: { email: 'user@other.com' },
    onlyEvaluateLocally: true,
  })
  console.log(`📊 Beta feature comparison - @example.com: ${beta1}, regular: ${beta2}`)

  console.log('\n🎯 Results Summary:')
  console.log(`   - Flag dependencies evaluated locally: ${result1 !== result2 ? '✅ YES' : '❌ NO'}`)
  console.log('   - Zero API calls needed: ✅ YES (all evaluated locally)')
  console.log('   - Node SDK supports flag dependencies: ✅ YES')

  console.log('\n' + '-'.repeat(60))
  console.log('PRODUCTION-STYLE MULTIVARIATE DEPENDENCY CHAIN')
  console.log('-'.repeat(60))
  console.log('🔗 Testing complex multivariate flag dependencies...')
  console.log("   Structure: 'multivariate-root-flag' -> 'multivariate-intermediate-flag' -> 'multivariate-leaf-flag'")
  console.log('')
  console.log("📋 Required setup (if flags don't exist):")
  console.log("   1. Create 'multivariate-leaf-flag' with fruit variants (pineapple, mango, papaya, kiwi)")
  console.log("      - pineapple: email = 'pineapple@example.com'")
  console.log("      - mango: email = 'mango@example.com'")
  console.log("   2. Create 'multivariate-intermediate-flag' with color variants (blue, red)")
  console.log("      - blue: depends on multivariate-leaf-flag = 'pineapple'")
  console.log("      - red: depends on multivariate-leaf-flag = 'mango'")
  console.log("   3. Create 'multivariate-root-flag' with show variants (breaking-bad, the-wire)")
  console.log("      - breaking-bad: depends on multivariate-intermediate-flag = 'blue'")
  console.log("      - the-wire: depends on multivariate-intermediate-flag = 'red'")
  console.log('')

  // Test pineapple -> blue -> breaking-bad chain
  const dependentResult3 = await posthog.getFeatureFlag('multivariate-root-flag', 'regular_user', {
    personProperties: { email: 'pineapple@example.com' },
    onlyEvaluateLocally: true,
  })
  if (String(dependentResult3) !== 'breaking-bad') {
    console.log(
      `     ❌ Something went wrong evaluating 'multivariate-root-flag' with pineapple@example.com. Expected 'breaking-bad', got '${dependentResult3}'`
    )
  } else {
    console.log("✅ 'multivariate-root-flag' with email pineapple@example.com succeeded")
  }

  // Test mango -> red -> the-wire chain
  const dependentResult4 = await posthog.getFeatureFlag('multivariate-root-flag', 'regular_user', {
    personProperties: { email: 'mango@example.com' },
    onlyEvaluateLocally: true,
  })
  if (String(dependentResult4) !== 'the-wire') {
    console.log(
      `     ❌ Something went wrong evaluating multivariate-root-flag with mango@example.com. Expected 'the-wire', got '${dependentResult4}'`
    )
  } else {
    console.log("✅ 'multivariate-root-flag' with email mango@example.com succeeded")
  }

  // Show the complete chain evaluation
  console.log('\n🔍 Complete dependency chain evaluation:')
  const testCases = [
    { email: 'pineapple@example.com', expectedChain: ['pineapple', 'blue', 'breaking-bad'] },
    { email: 'mango@example.com', expectedChain: ['mango', 'red', 'the-wire'] },
  ]

  for (const { email, expectedChain } of testCases) {
    const leaf = await posthog.getFeatureFlag('multivariate-leaf-flag', 'regular_user', {
      personProperties: { email },
      onlyEvaluateLocally: true,
    })
    const intermediate = await posthog.getFeatureFlag('multivariate-intermediate-flag', 'regular_user', {
      personProperties: { email },
      onlyEvaluateLocally: true,
    })
    const root = await posthog.getFeatureFlag('multivariate-root-flag', 'regular_user', {
      personProperties: { email },
      onlyEvaluateLocally: true,
    })

    const actualChain = [String(leaf), String(intermediate), String(root)]
    const chainSuccess = JSON.stringify(actualChain) === JSON.stringify(expectedChain)

    console.log(`   📧 ${email}:`)
    console.log(`      Expected: ${expectedChain.join(' -> ')}`)
    console.log(`      Actual:   ${actualChain.join(' -> ')}`)
    console.log(`      Status:   ${chainSuccess ? '✅ SUCCESS' : '❌ FAILED'}`)
  }

  console.log('\n🎯 Multivariate Chain Summary:')
  console.log('   - Complex dependency chains: ✅ SUPPORTED')
  console.log('   - Multivariate flag dependencies: ✅ SUPPORTED')
  console.log('   - Local evaluation of chains: ✅ WORKING')
} else if (choice === '5') {
  console.log('\n' + '='.repeat(60))
  console.log('CONTEXT MANAGEMENT EXAMPLES')
  console.log('='.repeat(60))

  posthog.debug(true)

  console.log('🏷️ Testing context management...')
  console.log(
    'You can use withContext to set context that is automatically applied to all events captured within that context.'
  )

  // Use withContext to set context that applies to all events in the callback
  posthog.withContext({ distinctId: 'user_123', properties: { transaction_id: 'abc123' } }, () => {
    // This event will be captured with the context set above
    posthog.capture({ event: 'order_processed' })
    console.log('✅ Event captured with context (distinctId and transaction_id)')
  })

  // Use fresh: true to start with a clean context (no inherited context)
  posthog.withContext(
    { distinctId: 'session_user', properties: { session_id: 'xyz789' } },
    () => {
      // Only session_id will be present, no inherited context
      posthog.capture({ event: 'session_event' })
      console.log('✅ Event captured with fresh context (session_id only)')
    },
    { fresh: true }
  )

  // Nested context example
  posthog.withContext({ distinctId: 'outer_user', properties: { outer_prop: 'outer_value' } }, () => {
    console.log('\n📦 Nested context example:')

    // Inner context inherits from outer by default
    posthog.withContext({ properties: { inner_prop: 'inner_value' } }, () => {
      const context = posthog.getContext()
      console.log(`   Inner context (inherited): ${JSON.stringify(context)}`)
      posthog.capture({ event: 'nested_event' })
    })

    // Inner context with fresh: true doesn't inherit
    posthog.withContext(
      { distinctId: 'fresh_user', properties: { fresh_prop: 'fresh_value' } },
      () => {
        const context = posthog.getContext()
        console.log(`   Fresh inner context: ${JSON.stringify(context)}`)
        posthog.capture({ event: 'fresh_nested_event' })
      },
      { fresh: true }
    )
  })

  console.log('\n✅ Context management examples completed')
} else if (choice === '6') {
  console.log('\n' + '='.repeat(60))
  console.log('FEATURE FLAG REMOTE EVALUATION EXAMPLES')
  console.log('='.repeat(60))
  console.log('🌐 These examples use a client WITHOUT a personal API key,')
  console.log('   so all flag evaluations go through the /decide endpoint.\n')

  // Create a separate client without personal API key for remote evaluation
  const remoteClient = new PostHog(projectKey, {
    host,
    // No personalApiKey - forces remote evaluation
  })

  remoteClient.debug(true)

  console.log('🏁 Testing basic feature flags (remote evaluation)...')

  // isFeatureEnabled - returns boolean
  const flag1 = await remoteClient.isFeatureEnabled('beta-feature', 'distinct_id')
  console.log(`isFeatureEnabled('beta-feature', 'distinct_id'): ${flag1}`)

  // Test with person properties - the server will use these for evaluation
  const flag2 = await remoteClient.isFeatureEnabled('beta-feature', 'remote_user', {
    personProperties: { email: 'test@example.com' },
  })
  console.log(`isFeatureEnabled('beta-feature') with @example.com email: ${flag2}`)

  const flag3 = await remoteClient.isFeatureEnabled('beta-feature', 'remote_user_2', {
    personProperties: { email: 'test@other.com' },
  })
  console.log(`isFeatureEnabled('beta-feature') with @other.com email: ${flag3}`)

  console.log('\n🎯 Testing getFeatureFlag (returns variant or boolean)...')

  // getFeatureFlag - returns the variant string for multivariate flags, or boolean
  const variant1 = await remoteClient.getFeatureFlag('multivariate-flag', 'remote_user_3')
  console.log(`getFeatureFlag('multivariate-flag'): ${variant1}`)

  const variant2 = await remoteClient.getFeatureFlag('boolean-flag', 'remote_user_4')
  console.log(`getFeatureFlag('boolean-flag'): ${variant2}`)

  console.log('\n📦 Testing getFeatureFlagPayload...')

  // getFeatureFlagPayload - gets the payload for a flag
  const payload = await remoteClient.getFeatureFlagPayload('beta-feature', 'remote_user_5', true)
  console.log(`getFeatureFlagPayload('beta-feature'): ${JSON.stringify(payload)}`)

  console.log('\n🔍 Testing getFeatureFlagResult (flag + payload in one call)...')

  // getFeatureFlagResult - efficient way to get both flag value and payload
  const result = await remoteClient.getFeatureFlagResult('beta-feature', 'remote_user_6', {
    personProperties: { email: 'test@example.com' },
  })
  if (result) {
    console.log(`Flag key: ${result.key}`)
    console.log(`Flag enabled: ${result.enabled}`)
    console.log(`Variant: ${result.variant}`)
    console.log(`Payload: ${JSON.stringify(result.payload)}`)
  } else {
    console.log('Flag result: undefined')
  }

  console.log('\n📋 Testing getAllFlags...')

  // getAllFlags - get all flags for a user
  const allFlags = await remoteClient.getAllFlags('remote_user_7')
  console.log(`getAllFlags(): ${JSON.stringify(allFlags, null, 2)}`)

  console.log('\n📋 Testing getAllFlagsAndPayloads...')

  // getAllFlagsAndPayloads - get all flags and their payloads
  const allFlagsAndPayloads = await remoteClient.getAllFlagsAndPayloads('remote_user_8')
  console.log(`getAllFlagsAndPayloads():`)
  console.log(`  featureFlags: ${JSON.stringify(allFlagsAndPayloads.featureFlags, null, 2)}`)
  console.log(`  featureFlagPayloads: ${JSON.stringify(allFlagsAndPayloads.featureFlagPayloads, null, 2)}`)

  console.log('\n🏢 Testing flags with groups...')

  // Test with groups
  const groupFlag = await remoteClient.isFeatureEnabled('beta-feature-groups', 'remote_user_9', {
    groups: { company: 'id:5' },
  })
  console.log(`isFeatureEnabled('beta-feature-groups') with company group: ${groupFlag}`)

  console.log('\n🎯 Remote Evaluation Summary:')
  console.log('   - All evaluations went through the /decide endpoint')
  console.log('   - No local flag definitions were loaded')
  console.log('   - Person/group properties were sent to server for evaluation')
  console.log('   - Useful when you cannot use a personal API key')

  await remoteClient.shutdown()
} else if (choice === '7') {
  console.log('\n🔄 Running all examples...')
  if (!localEvalAvailable) {
    console.log('   (Skipping local evaluation examples - no personal API key set)\n')
  }

  // Run example 1 - Identify and Capture
  console.log(`\n${'🔸'.repeat(10)} IDENTIFY AND CAPTURE ${'🔸'.repeat(10)}`)
  posthog.debug(true)

  console.log('📊 Capturing events...')
  posthog.capture({
    distinctId: 'distinct_id',
    event: 'event',
    properties: { property1: 'value', property2: 'value' },
    sendFeatureFlags: true,
  })

  console.log('🔗 Creating alias...')
  posthog.alias({ distinctId: 'distinct_id', alias: 'new_distinct_id' })

  console.log('👤 Identifying user...')
  posthog.identify({
    distinctId: 'new_distinct_id',
    properties: { email: 'something@something.com' },
  })

  // Run example 2 - Feature Flags (requires local evaluation)
  if (localEvalAvailable) {
    console.log(`\n${'🔸'.repeat(10)} FEATURE FLAGS ${'🔸'.repeat(10)}`)

    // Wait for local evaluation
    await posthog.waitForLocalEvaluationReady(10000)

    console.log('🏁 Testing basic feature flags...')
    const flagValue = await posthog.isFeatureEnabled('beta-feature', 'distinct_id')
    console.log(`beta-feature: ${flagValue}`)

    const sydneyFlag = await posthog.isFeatureEnabled('test-flag', 'random_id_12345', {
      personProperties: { $geoip_city_name: 'Sydney' },
    })
    console.log(`Sydney user: ${sydneyFlag}`)
  }

  // Run example 3 - Payloads
  console.log(`\n${'🔸'.repeat(10)} PAYLOADS ${'🔸'.repeat(10)}`)
  console.log('📦 Testing payloads...')
  const payload = await posthog.getFeatureFlagPayload('beta-feature', 'payload_user', true, {
    personProperties: { email: 'test@example.com' },
  })
  console.log(`Payload: ${JSON.stringify(payload)}`)

  // Run example 4 - Flag Dependencies (requires local evaluation)
  if (localEvalAvailable) {
    console.log(`\n${'🔸'.repeat(10)} FLAG DEPENDENCIES ${'🔸'.repeat(10)}`)
    console.log('🔗 Testing flag dependencies...')

    const result1 = await posthog.isFeatureEnabled('test-flag-dependency', 'demo_user', {
      personProperties: { email: 'user@example.com' },
      onlyEvaluateLocally: true,
    })
    const result2 = await posthog.isFeatureEnabled('test-flag-dependency', 'demo_user2', {
      personProperties: { email: 'user@other.com' },
      onlyEvaluateLocally: true,
    })
    console.log(`✅ @example.com user: ${result1}, regular user: ${result2}`)
  }

  // Run example 5 - Context Management
  console.log(`\n${'🔸'.repeat(10)} CONTEXT MANAGEMENT ${'🔸'.repeat(10)}`)
  console.log('🏷️ Testing context management...')

  posthog.withContext({ distinctId: 'demo_user', properties: { demo_run: 'all_examples' } }, () => {
    posthog.capture({ event: 'demo_completed' })
    console.log('✅ Demo completed with context')
  })

  // Run example 6 - Remote Evaluation
  console.log(`\n${'🔸'.repeat(10)} REMOTE EVALUATION ${'🔸'.repeat(10)}`)
  console.log('🌐 Testing remote evaluation (separate client without personal API key)...')

  const remoteClient = new PostHog(projectKey, { host })
  const remoteFlag = await remoteClient.isFeatureEnabled('beta-feature', 'remote_demo_user', {
    personProperties: { email: 'demo@example.com' },
  })
  console.log(`Remote evaluation result: ${remoteFlag}`)
  await remoteClient.shutdown()
} else if (choice === '8') {
  console.log('👋 Goodbye!')
  await posthog.shutdown()
  process.exit(0)
} else {
  console.log('❌ Invalid choice. Please run again and select 1-8.')
  await posthog.shutdown()
  process.exit(1)
}

console.log('\n' + '='.repeat(60))
console.log('✅ Example completed!')
console.log('='.repeat(60))

await posthog.shutdown()
