---
'@posthog/core': patch
'posthog-js': patch
---

Stop building a stack frame for a `window.onerror` report that carries no code position, such as the `ResizeObserver` loop warning. The frame named the document URL rather than a script, so no source map could resolve it. These exceptions now arrive with no stack trace.
