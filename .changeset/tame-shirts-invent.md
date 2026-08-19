---
'posthog-js': patch
---

Keep replay playback running when a recording adopts constructed stylesheets across a document swap. A constructed stylesheet can only be adopted by the document that created it, so a sheet held over a swap is rejected and the error previously stopped the player. Adoption now falls back to whatever is already applied.
