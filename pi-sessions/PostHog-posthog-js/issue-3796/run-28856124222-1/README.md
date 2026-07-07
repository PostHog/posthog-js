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
- [`call-1-1-2026-07-07T09-31-46-332Z_019f3beb-551c-7946-a791-484d64a74cec.jsonl`](https://github.com/PostHog/posthog-js/blob/posthog-watcher-state/pi-sessions/PostHog-posthog-js/issue-3796/run-28856124222-1/call-1-1-2026-07-07T09-31-46-332Z_019f3beb-551c-7946-a791-484d64a74cec.jsonl)
