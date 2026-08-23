---
'posthog-js': patch
'@posthog/types': patch
---

fix(browser): drop exceptions thrown by injected browser scripts. Firefox for iOS and Chrome for iOS inject their own user scripts, which the browser attributes to the host page. When such a script reads a browser-private global (for example `__firefox__`) before it exists, it throws, and error tracking captured it as the page's own error. We now match the private global in the exception value and drop the exception, gated by the same `captureExtensionExceptions` config.
