---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/types': patch
---

Stop carousel, pager and scroller controls from capturing false `$rageclick` events. The default rageclick content ignorelist now covers carousel, slide, scroll and arrow wording plus arrow glyphs (`→`, `←`, `›`, `‹`, `»`, `«`, `▶`, `◀`, `❯`, `❮`), and it now applies to `rageclick: true` as well as to the object form. The default word keywords match whole words, so "Narrow results" and "Open slideshow" keep capturing; keywords you supply yourself still match as substrings.
