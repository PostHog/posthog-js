---
'posthog-node': major
---

An event whose name is missing, empty or not a string, or whose name, distinct id, session id or window id is not well-formed Unicode (a lone surrogate), is dropped before sending and reported through the `'error'` event, instead of being sent and failing at capture (an object name was sent as `"[object Object]"`). Lone surrogates in property strings are replaced with U+FFFD, so one bad character no longer fails the whole request.
An unparseable event timestamp is still replaced with the current time, and now logs a warning that never includes the value.
