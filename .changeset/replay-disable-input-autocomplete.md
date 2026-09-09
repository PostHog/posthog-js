---
'posthog-js': patch
---

Set `autocomplete="off"` on `<input>` and `<textarea>` elements rebuilt during session replay. The replay iframe is a live document, so the viewer's own browser offered autofill on those fields and an accepted suggestion wrote the viewer's saved data into the replay, where it read as the recorded user's input.
