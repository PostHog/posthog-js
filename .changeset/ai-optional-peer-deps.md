---
"@posthog/ai": major
---

Move provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@langchain/core`) to optional peer dependencies and drop the unused `langchain` dependency, to reduce supply-chain blast radius — you now only install the SDK for the integration you use. (#3610)

**Breaking:** integration clients are no longer exported from the package root. Import them from their subpaths and install the matching peer:

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

`withTracing` (Vercel AI SDK) and `captureAiGeneration` are unchanged.
