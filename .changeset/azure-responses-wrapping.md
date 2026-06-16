---
"@posthog/ai": patch
---

Wrap the Azure OpenAI `responses` API in `PostHogAzureOpenAI` so `responses.create` calls are tracked, matching the non-Azure `PostHogOpenAI` client.
