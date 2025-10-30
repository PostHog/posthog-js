/* eslint-disable no-console */
/**
 * Test that captureTyped() provides type safety and captureUntyped() is flexible
 */

import posthog from './playground/nextjs/src/posthog-typed'

// ========================================
// TEST: captureTyped() with type safety
// ========================================

// ✅ Should work - correct properties
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42.99,
    quantity: 1,
})

// ✅ Should work - additional properties allowed
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1,
    custom_field: 'extra data',
})

// ❌ Should error - missing required properties
// @ts-expect-error - Missing required properties: name, price, quantity
posthog.captureTyped('Product Added', {
    product_id: '123',
})

// ❌ Should error - wrong type for price
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    // @ts-expect-error - Type 'string' is not assignable to type 'number'
    price: 'not-a-number',
    quantity: 1,
})

// ❌ Should error - unknown event name
// @ts-expect-error - Argument of type '"Unknown Event"' is not assignable
posthog.captureTyped('Unknown Event', {
    some: 'data',
})

// ========================================
// TEST: captureUntyped() is flexible
// ========================================

// ✅ All of these should work with captureUntyped
posthog.captureUntyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1,
})

posthog.captureUntyped('Product Added', {
    product_id: '123',
    // Missing properties is OK with untyped
})

posthog.captureUntyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 'string is OK here',
    quantity: '1',
})

posthog.captureUntyped('Any Random Event Name', {
    any: 'properties',
    work: 'here',
})

posthog.captureUntyped('Simple Event')
posthog.captureUntyped('Event With Null', null)

console.log('Type checking tests complete!')
