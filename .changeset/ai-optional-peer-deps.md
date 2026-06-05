---
"@posthog/ai": major
---

Major release: move provider SDKs to optional peer dependencies and clean up staged deprecations.

**Optional peer dependencies (#3610):** `openai`, `@anthropic-ai/sdk`, `@google/genai`, and `@langchain/core` are now optional peer dependencies, and the unused `langchain` dependency is dropped — you only install the SDK for the integration you use. Integration clients are no longer exported from the package root; import them from their subpaths:

```diff
- import { OpenAI } from '@posthog/ai'
+ import { OpenAI } from '@posthog/ai/openai'        // npm install openai
- import { AzureOpenAI } from '@posthog/ai'
+ import { AzureOpenAI } from '@posthog/ai/openai'   // npm install openai
- import { Anthropic } from '@posthog/ai'
+ import { Anthropic } from '@posthog/ai/anthropic'  // npm install @anthropic-ai/sdk
- import { GoogleGenAI } from '@posthog/ai'
+ import { GoogleGenAI } from '@posthog/ai/gemini'   // npm install @google/genai
- import { LangChainCallbackHandler } from '@posthog/ai'
+ import { LangChainCallbackHandler } from '@posthog/ai/langchain'  // npm install @langchain/core
```

`withTracing` (Vercel AI SDK) and `captureAiGeneration` remain exported from the package root and need no provider SDK.

**Removed deprecations:**

- `Prompts.get()` now always returns a `PromptResult` object (`{ source, prompt, name, version }`) — the plain-string return and the `withMetadata` option are gone. Read the template from `result.prompt`:

  ```diff
  - const template = await prompts.get('my-prompt')
  - const compiled = prompts.compile(template, vars)
  + const result = await prompts.get('my-prompt')
  + const compiled = prompts.compile(result.prompt, vars)
  ```

- `PostHogTraceExporter` and `PostHogSpanProcessor` no longer accept the deprecated `apiKey` option — use `projectToken`:

  ```diff
  - new PostHogTraceExporter({ apiKey: 'phc_...' })
  + new PostHogTraceExporter({ projectToken: 'phc_...' })
  - new PostHogSpanProcessor({ apiKey: 'phc_...' })
  + new PostHogSpanProcessor({ projectToken: 'phc_...' })
  ```
