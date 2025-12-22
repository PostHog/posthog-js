---
"@posthog/ai": minor
---

Add support for both Vercel AI SDK 5 and 6

Changes:
- Runtime version detection via `model.specificationVersion`
- Support both `LanguageModelV2` (SDK 5) and `LanguageModelV3` (SDK 6)
- `@ai-sdk/provider` is now an optional peer dependency (supports both v2 and v3)
- Removed unused `ai` peer dependency (only type imports from `@ai-sdk/provider` are used)
- No breaking changes - existing SDK 5 users can continue without modification
