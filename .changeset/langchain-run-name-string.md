---
'@posthog/ai': patch
---

Fix LangChain spans being named after their class instead of the runnable. LangChain passes `runName` as a bare string, which the name resolver skipped because it only inspected object arguments, so every tool span was captured as `DynamicStructuredTool` rather than the tool's own name.
