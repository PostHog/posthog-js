---
"@posthog/ai": major
---

Clean up deprecations and inconsistent option naming, bundled into this major release.

**Breaking:**

- `Prompts.get()` now always returns a `PromptResult` object (`{ source, prompt, name, version }`) — the plain-string return and the `withMetadata` option are gone. Read the template from `result.prompt`:

  ```diff
  - const template = await prompts.get('my-prompt')
  - const compiled = prompts.compile(template, vars)
  + const result = await prompts.get('my-prompt')
  + const compiled = prompts.compile(result.prompt, vars)
  ```

- `PostHogTraceExporter` no longer accepts the deprecated `apiKey` option. Use `projectToken`:

  ```diff
  - new PostHogTraceExporter({ apiKey: 'phc_...' })
  + new PostHogTraceExporter({ projectToken: 'phc_...' })
  ```

- `PostHogSpanProcessor` now takes `projectToken` instead of `apiKey`, matching `PostHogTraceExporter`:

  ```diff
  - new PostHogSpanProcessor({ apiKey: 'phc_...' })
  + new PostHogSpanProcessor({ projectToken: 'phc_...' })
  ```
