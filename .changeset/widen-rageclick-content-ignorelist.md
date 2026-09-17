---
'posthog-js': minor
'@posthog/browser-common': patch
'@posthog/types': patch
---

Stop carousel, pager and scroller controls from capturing false `$rageclick` events. The default rageclick content ignorelist now covers carousel, slide, scroll and arrow wording plus arrow glyphs (`→`, `←`, `›`, `‹`, `»`, `«`, `▶`, `◀`, `❯`, `❮`), and it now applies to `rageclick: true` as well as to the object form. The default word keywords match whole words, so "Narrow results" and "Open slideshow" keep capturing; keywords you supply yourself still match as substrings. Content keywords now match against the clicked control, including a label held in a child span, instead of every ancestor up to the body. Set `rageclick: { content_ignorelist: false }` to keep capturing these events.
