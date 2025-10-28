# posthog-ai

## 6.5.0

### Minor Changes

- [#2496](https://github.com/PostHog/posthog-js/pull/2496) [`7253bb3`](https://github.com/PostHog/posthog-js/commit/7253bb30b6305b29f885eed2c542f2f6686efb0f) Thanks [@andrewm4894](https://github.com/andrewm4894)! - feat: add $ai_framework property for framework integrations

  Adds a simple `$ai_framework` property to AI events when using framework layers (LangChain, Vercel AI SDK). Direct provider calls (OpenAI, Anthropic, Gemini) do not include this property, eliminating redundant data where framework would duplicate the provider name.

  **Example with framework:**

  ```json
  {
    "$ai_framework": "langchain",
    "$ai_provider": "openai",
    "$ai_model": "gpt-4"
  }
  ```

  **Example without framework:**

  ```json
  {
    "$ai_provider": "openai",
    "$ai_model": "gpt-4"
  }
  ```

## 6.4.4

### Patch Changes

- [#2468](https://github.com/PostHog/posthog-js/pull/2468) [`873538b`](https://github.com/PostHog/posthog-js/commit/873538b9615626ad274be559f93a5fbaaa8ba8b9) Thanks [@andrewm4894](https://github.com/andrewm4894)! - fix: prevent [object Object] in content serialization - structured content is now properly JSON-stringified instead of being converted to "[object Object]"

## 6.4.3

### Patch Changes

- [#2364](https://github.com/PostHog/posthog-js/pull/2364) [`d91fef6`](https://github.com/PostHog/posthog-js/commit/d91fef61a4e866a02b9543234501487803fe4a5f) Thanks [@dependabot](https://github.com/apps/dependabot)! - Update Anthropic SDK

## 6.4.2

### Patch Changes

- [#2354](https://github.com/PostHog/posthog-js/pull/2354) [`1118d4d`](https://github.com/PostHog/posthog-js/commit/1118d4d0e9dad1bb0471fab0036695722c52ad85) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Ensure consistent hadling of system prompts

## 6.4.1

### Patch Changes

- [#2299](https://github.com/PostHog/posthog-js/pull/2299) [`80a262c`](https://github.com/PostHog/posthog-js/commit/80a262c728cd893a79090e9019c08640961dada1) Thanks [@k11kirky](https://github.com/k11kirky)! - Fix for zod schema

## 6.4.0

### Minor Changes

- [#2317](https://github.com/PostHog/posthog-js/pull/2317) [`14bb69e`](https://github.com/PostHog/posthog-js/commit/14bb69ef36d13e08a4af2aa506e5caaa19d1684a) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Dependencies updated to support latest APIs from provider SDKs

## 6.3.3

### Patch Changes

- [#2324](https://github.com/PostHog/posthog-js/pull/2324) [`0b7ec25`](https://github.com/PostHog/posthog-js/commit/0b7ec2513da8c57df33fe578c2f9cbca33a29829) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Ensure Posthog parameters are not passed to any provider

## 6.3.2

### Patch Changes

- [#2272](https://github.com/PostHog/posthog-js/pull/2272) [`9eccea4`](https://github.com/PostHog/posthog-js/commit/9eccea4b7d6a11468d9c890eae4b51be8710c9cf) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Don't send Posthog specific params to OpenAI

## 6.3.1

### Patch Changes

- [#2264](https://github.com/PostHog/posthog-js/pull/2264) [`cb5dd15`](https://github.com/PostHog/posthog-js/commit/cb5dd15632b3436db21b320a84d76fe739851a2f) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Fixes noisy truncation function

## 6.3.0

### Minor Changes

- [#2253](https://github.com/PostHog/posthog-js/pull/2253) [`6461420`](https://github.com/PostHog/posthog-js/commit/6461420953d741dccae434d55637665c4c9f98dc) Thanks [@carlos-marchal-ph](https://github.com/carlos-marchal-ph)! - Adds support for embeddings for OpenAI and Azure OpenAI

## 6.2.0

### Minor Changes

- [#2252](https://github.com/PostHog/posthog-js/pull/2252) [`a806e49`](https://github.com/PostHog/posthog-js/commit/a806e494bc995cad4526fbac29a150e3942cae37) Thanks [@Radu-Raicea](https://github.com/Radu-Raicea)! - send ai library version in events

## 6.1.2

### Patch Changes

- [#2230](https://github.com/PostHog/posthog-js/pull/2230) [`8ed50be`](https://github.com/PostHog/posthog-js/commit/8ed50be767028eaaa8b3ce4f299d6878c35c4ced) Thanks [@Radu-Raicea](https://github.com/Radu-Raicea)! - Fixes tool calls for streaming providers

## 6.1.1

### Patch Changes

- [#2217](https://github.com/PostHog/posthog-js/pull/2217) [`fdfceeb`](https://github.com/PostHog/posthog-js/commit/fdfceebf349242e47bb4e444d60f8fc546663581) Thanks [@Radu-Raicea](https://github.com/Radu-Raicea)! - add base64 inline image sanitization

## 6.1.0

### Minor Changes

- [#2216](https://github.com/PostHog/posthog-js/pull/2216) [`57752f4`](https://github.com/PostHog/posthog-js/commit/57752f4163ec3a52fd378a6e6a4473d26e7f3c2c) Thanks [@k11kirky](https://github.com/k11kirky)! - Add support for reasoning and cache tokens in gemini + fix token calc in vercel

## 6.0.1

### Patch Changes

- [#2199](https://github.com/PostHog/posthog-js/pull/2199) [`d887947`](https://github.com/PostHog/posthog-js/commit/d887947317fed0da3737b752c1f5e680fddd44eb) Thanks [@k11kirky](https://github.com/k11kirky)! - Fix bug with vercel output mapping

## 6.0.0

### Major Changes

- [#2191](https://github.com/PostHog/posthog-js/pull/2191) [`65d72b4`](https://github.com/PostHog/posthog-js/commit/65d72b4f1495b3a932936d87ca53b518f0a7b9da) Thanks [@k11kirky](https://github.com/k11kirky)! - Updated Vercel AI SDK to v5

### Patch Changes

- [#2195](https://github.com/PostHog/posthog-js/pull/2195) [`f6fdd8e`](https://github.com/PostHog/posthog-js/commit/f6fdd8ecd8b011162e34263f7096e190b4b9c453) Thanks [@Radu-Raicea](https://github.com/Radu-Raicea)! - Fix tool calls for all non-streaming providers

## 5.2.3

### Patch Changes

- [#2173](https://github.com/PostHog/posthog-js/pull/2173) [`d4204f4`](https://github.com/PostHog/posthog-js/commit/d4204f473ebaee42c696523306ea8e6fe97f0dfd) Thanks [@Radu-Raicea](https://github.com/Radu-Raicea)! - Fix bug where tool calls were not sent in LangChain

## 5.2.2

- Add support for parsing tool calls from reasoning models in LangChain by converting the tool call format to the expected shape

## 5.2.1

- Fix crash when importing @posthog/ai with OpenAI SDK v5.x by deferring access to Chat, Completions, and Responses classes until runtime

## 5.2.0

- Fix anonymous events

## 5.1.0

- Add responses + parse

## 5.0.1

- Bump posthog-node to v5.0.0

## 5.0.0

- Major bump for breaking change:
- Require node engine >20
- support for @google/genai

## 4.4.0

- Make `posthog-node` a peer dependency to avoid bundling implementation code

## 4.3.2

- Fix exported file extensions to work with older Node versions

## 4.3.1

- Remove fullDebug mode
- Add posthogCaptureImmediate to await a promise for each capture (for serverless environments)
- Fix openai test

## 4.2.1

- Add fullDebug mode and limit full size of event input

## 4.1.0

- add truncation to vercel ai sdk inputs and outputs

## 4.0.1

- add new util to sanitize inputs, outputs and errors

## 4.0.0

- feat: separate out packages as separate exports so you can import { OpenAI } from @posthog/ai/openai and reduce import size

## 3.3.2 - 2025-03-25

- fix: langchain name mapping

## 3.3.1 - 2025-03-13

- fix: fix vercel output mapping and token caching

## 3.3.0 - 2025-03-08

- feat: add reasoning and cache tokens to openai and anthropic
- feat: add tool support for vercel
- feat: add support for other media types vercel

## 3.2.1 - 2025-02-11

- fix: add experimental_wrapLanguageModel to vercel middleware supporting older versions of ai

## 3.2.0 - 2025-02-11

- feat: change how we handle streaming support for openai and anthropic

## 3.1.1 - 2025-02-07

- fix: bump ai to 4.1.0

## 3.1.0 - 2025-02-07

- feat: add posthogCostOverride, posthogModelOverride, and posthogProviderOverride to sendEventToPosthog for vercel

## 2.4.0 - 2025-02-03

- feat: add anthropic support for sdk
