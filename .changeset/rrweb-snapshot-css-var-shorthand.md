---
'@posthog/rrweb-snapshot': patch
'posthog-js': patch
---

Preserve `<style>` textContent when the browser's CSSOM serialization would
emit empty longhands from `var()` inside a shorthand. When a stylesheet has
e.g. `padding: var(--p); padding-bottom: var(--pb);`, browsers store the
shorthand's longhands with empty token lists per the CSS Custom Properties
spec, and `CSSStyleRule.cssText` re-emits them as `padding-top: ;
padding-right: ; padding-left: ;`. The previous behavior replaced the
`<style>` text with that corrupted output, silently dropping layout rules
on replay. We now detect the empty-longhand pattern and keep the original
textContent in that case. Affects users of any CSS-in-JS framework that
combines `var()` with shorthands (Chakra UI v3, Panda CSS, Emotion, etc.).
Same class of bug as rrweb-io/rrweb#1667.
