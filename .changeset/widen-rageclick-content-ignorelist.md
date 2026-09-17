---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/types': patch
---

Stop carousel, pager and scroller controls from capturing false `$rageclick` events. The rageclick content ignorelist, active from the `2025-11-30` config defaults, now covers carousel, slide, scroll and arrow wording plus arrow glyphs (`→`, `←`, `›`, `‹`, `»`, `«`, `▶`, `◀`, `❯`, `❮`). The default word keywords match whole words, so "Narrow results" and "Open slideshow" keep capturing; keywords you supply yourself still match as substrings. Keywords now match against the clicked control, including a label held in a child span or an `aria-label` on an icon inside it, instead of every ancestor up to the body, so a region labelled "Featured carousel" no longer suppresses the buttons inside it. Set `rageclick: { content_ignorelist: false }` to keep capturing these events.
