# 5.2.1

- Fix crash when importing @posthog/ai with OpenAI SDK v5.x by deferring access to Chat, Completions, and Responses classes until runtime

# 5.2.0

- Fix anonymous events

# 5.1.0

- Add responses + parse

# 5.0.1

- Bump posthog-node to v5.0.0

# 5.0.0

- Major bump for breaking change:
- Require node engine >20
- support for @google/genai

# 4.4.0

- Make `posthog-node` a peer dependency to avoid bundling implementation code

# 4.3.2

- Fix exported file extensions to work with older Node versions

# 4.3.1

- Remove fullDebug mode
- Add posthogCaptureImmediate to await a promise for each capture (for serverless environments)
- Fix openai test

# 4.2.1

- Add fullDebug mode and limit full size of event input

# 4.1.0

- add truncation to vercel ai sdk inputs and outputs

# 4.0.1

- add new util to sanitize inputs, outputs and errors

# 4.0.0

- feat: separate out packages as separate exports so you can import { OpenAI } from @posthog/ai/openai and reduce import size

# 3.3.2 - 2025-03-25

- fix: langchain name mapping

# 3.3.1 - 2025-03-13

- fix: fix vercel output mapping and token caching

# 3.3.0 - 2025-03-08

- feat: add reasoning and cache tokens to openai and anthropic
- feat: add tool support for vercel
- feat: add support for other media types vercel

# 3.2.1 - 2025-02-11

- fix: add experimental_wrapLanguageModel to vercel middleware supporting older versions of ai

# 3.2.0 - 2025-02-11

- feat: change how we handle streaming support for openai and anthropic

# 3.1.1 - 2025-02-07

- fix: bump ai to 4.1.0

# 3.1.0 - 2025-02-07

- feat: add posthogCostOverride, posthogModelOverride, and posthogProviderOverride to sendEventToPosthog for vercel

# 2.4.0 - 2025-02-03

- feat: add anthropic support for sdk
