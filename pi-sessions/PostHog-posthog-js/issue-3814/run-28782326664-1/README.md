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
- [`call-1-1-2026-07-06T09-40-25-204Z_019f36cc-e3f4-7314-98cf-915428f52898.jsonl`](https://github.com/PostHog/posthog-js/blob/posthog-watcher-state/pi-sessions/PostHog-posthog-js/issue-3814/run-28782326664-1/call-1-1-2026-07-06T09-40-25-204Z_019f36cc-e3f4-7314-98cf-915428f52898.jsonl)
