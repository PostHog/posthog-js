---
'posthog-js': patch
---

fix(replay): ship a held recording epoch when the app rotated the session

A recording epoch born from a session rotation is held until the user interacts, so an untouched tab does not mint a new recording on every idle timeout. That hold also applied when the rotation came from the app — `posthog.reset()` clears the session id, and the epoch that follows it was discarded on unload even though the same visit would have been recorded without the reset. An app-driven rotation cannot repeat on a timer, so its held epoch now ships on a clean unload of a document that was visible, exactly like a fresh start. Rotations the session manager forces on an idle tab are unchanged.
