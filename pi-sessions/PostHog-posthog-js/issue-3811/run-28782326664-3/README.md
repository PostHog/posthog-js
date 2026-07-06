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
- [`call-3-1-2026-07-06T09-44-22-379Z_019f36d0-826b-7f65-94bc-634ddd34ec49.jsonl`](https://github.com/PostHog/posthog-js/blob/posthog-watcher-state/pi-sessions/PostHog-posthog-js/issue-3811/run-28782326664-3/call-3-1-2026-07-06T09-44-22-379Z_019f36d0-826b-7f65-94bc-634ddd34ec49.jsonl)
