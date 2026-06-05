---
'posthog-js': minor
---

Stop classifying intentional repeated clicks as rageclicks. From the `2026-05-30` config defaults, rageclick detection now ignores:

- text-editing surfaces (`textarea`, text-like `input`s, and `contenteditable` elements), where rapid clicks are double/triple-click text selection rather than rage (`rageclick.ignore_text_selection`)
- `+`/`-` stepper buttons, added to the default `content_ignorelist`

Symbol-only keywords in `content_ignorelist` (e.g. `+`, `-`, `>`, `<`) now match the element's text exactly instead of as a substring, so labels like `sign-up`, `5 > 3`, or `C++` are no longer treated as repeatedly-clicked controls. The heatmaps rageclick marker now applies the same suppression as the `$rageclick` event.
