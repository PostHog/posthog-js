---
'posthog-react-native': patch
---

Coalesce React Native storage writes into a short window so a burst of captures no longer re-serializes and rewrites the whole storage blob on every event. Login, logout, opt-in/opt-out, event flush, app background, shutdown, and fatal exceptions still persist synchronously.

Two behavioral notes for integrators auditing on-disk writes:
- Custom storage backends now receive coalesced writes (at most one per ~100ms) rather than one per mutation; a backend that mirrors every write will see fewer.
- The hard-crash loss window widens to ~100ms for mutations with no intervening drain. The forced-drain coverage (flush/background/shutdown/identify/reset/opt-in/opt-out/fatal exception) keeps the practical exposure small.
