# PostHog Typed Capture Solution

## Overview
This solution provides type-safe event capture for PostHog by introducing two new methods:
- `captureTyped()` - Type-safe capture for defined events
- `captureUntyped()` - Flexible capture for any events (original behavior)

## Implementation Details

### Generated File Structure
The PostHog CLI generates a `posthog-typed.ts` file that:
1. Defines event schemas directly (no module augmentation needed)
2. Creates a wrapper around the original PostHog instance
3. Implements both typed and untyped capture methods
4. Maintains backward compatibility with deprecated `capture()` method

### Key Features

#### Type-Safe Capture
```typescript
// ✅ Correct - all required properties with correct types
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1
})

// ✅ Additional properties are allowed
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1,
    custom_field: 'extra data'
})

// ❌ TypeScript Error - missing required properties
posthog.captureTyped('Product Added', {
    product_id: '123'
    // Missing: name, price, quantity
})

// ❌ TypeScript Error - wrong type
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 'not-a-number', // Error: string not assignable to number
    quantity: 1
})

// ❌ TypeScript Error - unknown event
posthog.captureTyped('Unknown Event', {})
```

#### Flexible Capture
```typescript
// All of these work with captureUntyped
posthog.captureUntyped('Any Event Name', { any: 'properties' })
posthog.captureUntyped('Product Added', { partial: 'data' })
posthog.captureUntyped('Simple Event')
```

## Technical Approach

### Why This Works
- Avoids TypeScript's method overload limitations by using separate method names
- Generic constraints (`K extends keyof EventSchemas`) work properly with different method names
- Intersection type (`P & Record<string, any>`) allows additional properties while enforcing required ones

### Type Definition
```typescript
interface TypedPostHog extends Omit<OriginalPostHog, 'capture'> {
    captureTyped<K extends keyof EventSchemas, P extends EventSchemas[K]>(
        event_name: K,
        properties: P & Record<string, any>,
        options?: CaptureOptions
    ): CaptureResult | undefined

    captureUntyped(
        event_name: string,
        properties?: Properties | null,
        options?: CaptureOptions
    ): CaptureResult | undefined
}
```

## Migration Guide

### For New Code
Use `captureTyped()` for type safety:
```typescript
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1
})
```

### For Dynamic Events
Use `captureUntyped()` when event names or properties are dynamic:
```typescript
const eventName = getUserEvent()
posthog.captureUntyped(eventName, dynamicProperties)
```

### Deprecation Notice
The original `capture()` method logs a deprecation warning directing users to use the new methods.

## Benefits
1. **Immediate IDE feedback** - TypeScript errors appear as you type
2. **Prevents misconfigured events** - Required properties enforced at compile time
3. **Backward compatible** - Existing code continues to work
4. **Flexible when needed** - `captureUntyped()` available for dynamic scenarios
5. **No runtime overhead** - All checking happens at compile time