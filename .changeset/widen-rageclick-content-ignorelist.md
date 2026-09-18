---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/types': patch
---

Stop carousel, pager and scroller controls from capturing false `$rageclick` events. The rageclick content ignorelist, active from the `2025-11-30` config defaults, now covers carousel, slide, scroll and arrow wording plus arrow glyphs (`→`, `←`, `›`, `‹`, `»`, `«`, `▶`, `◀`, `❯`, `❮`). The built-in word keywords match whole words wherever they appear, including inside a list you pass yourself, so "Narrow results" and "Open slideshow" keep capturing; other word keywords you add still match as substrings. Keywords now match against the clicked control (the nearest button, link, ARIA control or `cursor: pointer` wrapper), reading its label from every element between the click and the control, including child spans and other nested elements, instead of every ancestor up to the body, so a region labelled "Featured carousel" no longer suppresses the buttons inside it. A control's own text or `aria-label` wins over an icon's `aria-label` inside it, so clicking the icon and clicking the text agree. Set `rageclick: { content_ignorelist: false }` to keep capturing these events.
