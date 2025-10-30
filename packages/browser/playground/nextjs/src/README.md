# PostHog Typed Events - Generated File Example

## Overview

This directory contains an example of a generated typed PostHog wrapper that provides type-safe event tracking.

## File: `posthog-typed.ts`

This file demonstrates what the PostHog CLI would generate to provide type safety for event tracking.

### Features

- **`captureTyped()`** - Type-safe event capture with compile-time validation
- **`captureUntyped()`** - Flexible capture for dynamic/untyped events
- Enforces required properties and types
- Allows additional properties beyond the schema
- Works with all event naming patterns (spaces, hyphens, single words, etc.)
- Backward compatible with deprecated `capture()` method

### Usage

```typescript
import posthog from './posthog-typed'

// Type-safe capture - TypeScript enforces all required properties
posthog.captureTyped('Product Added', {
    product_id: '123',
    name: 'Widget',
    price: 42,
    quantity: 1
})

// Flexible capture for dynamic events
posthog.captureUntyped('Custom Event', { any: 'data' })
```

## Test File

See `../../../test-captureTyped-simple.ts` for examples of type checking in action.
