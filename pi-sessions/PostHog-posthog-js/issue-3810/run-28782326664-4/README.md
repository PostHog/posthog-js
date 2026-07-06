# PostHog Watcher pi sessions

These JSONL files are pi sessions captured from posthog-watcher-action.

To resume locally, download a session file, check out the relevant repository, then fork the session:

```bash
gh repo clone PostHog/posthog-js
cd posthog-js
pi --fork path/to/session.jsonl
```

Use `--fork` rather than `--session` when taking over a CI-generated session so your local work continues in a new session file.

Saved session files:
- [`call-4-1-2026-07-06T09-45-57-649Z_019f36d1-f691-7cb1-85b8-f8289e605707.jsonl`](https://github.com/PostHog/posthog-js/blob/posthog-watcher-state/pi-sessions/PostHog-posthog-js/issue-3810/run-28782326664-4/call-4-1-2026-07-06T09-45-57-649Z_019f36d1-f691-7cb1-85b8-f8289e605707.jsonl)
