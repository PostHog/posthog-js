---
"@posthog/ai": patch
---

fix(ai): Use Proxy for Vercel model wrapper to fix streamObject with Anthropic models

Fixes issue #2848 where `withTracing` would cause `streamObject` to fail with Anthropic/Claude models when images were included. The error `TypeError: Cannot convert undefined or null to object at Function.entries` occurred because the previous implementation used object spread (`{ ...model }`) which only copied enumerable own properties, missing getter properties like `supportsObjectGeneration` that Anthropic models define.

The fix replaces the object spread with a Proxy that properly delegates all property access (including getters, prototype methods, and non-enumerable properties) to the underlying model while intercepting only `doGenerate` and `doStream` for tracing.
