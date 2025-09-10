# posthog-ai

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
