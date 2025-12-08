---
"@posthog/ai": major
---

Add support for Vercel AI SDK 6 (LanguageModelV3)

BREAKING CHANGE: This release requires Vercel AI SDK v6 (currently in beta). If you're using AI SDK v5, please continue using the previous version of @posthog/ai.

Changes:
- Updated `ai` dependency to `6.0.0-beta.138`
- Updated `@ai-sdk/provider` to `3.0.0-beta.25`
- Migrated from `LanguageModelV2` to `LanguageModelV3` types
- Added `specificationVersion: 'v3'` to middleware
