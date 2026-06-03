---
'posthog-js': patch
'@posthog/rrweb': patch
'@posthog/rrweb-utils': patch
---

record: fix broken MutationObserver in WebKit/Safari when a 3rd-party library has monkey-patched the page. To dodge a tainted `MutationObserver`, rrweb grabs a pristine constructor from a throwaway iframe. WebKit tears down a detached iframe's `ScriptExecutionContext`, so the observer built from it silently stopped delivering mutations once the iframe was removed (webkit.org/b/179224) — no DOM changes were recorded on affected Safari pages. On Safari the untainted-prototype iframe is now kept attached (hidden, `rr-block`-tagged so it isn't serialized) and torn down via a cleanup wired through `initMutationObserver`'s teardown. Ported from upstream rrweb 2.0.1 (rrweb-io/rrweb#1854).
