---
"@posthog/ai": minor
---

Add support for both Vercel AI SDK 5 and 6

Changes:
- Runtime version detection via `model.specificationVersion`
- Support both `LanguageModelV2` (SDK 5) and `LanguageModelV3` (SDK 6)
- Moved `@ai-sdk/provider` and `ai` to peer dependencies with dual version ranges
- No breaking changes - existing SDK 5 users can continue without modification
