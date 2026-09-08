---
'posthog-node': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Honor `Retry-After` when the ingestion endpoint refuses a logs or metrics batch, instead of retrying on the SDK's own schedule alone. A refusal naming a longer wait extends the one being served, up to five minutes from when it started. Retry delays now carry jitter so clients refused together do not return together, and metrics backs off exponentially across consecutive failures rather than retrying on a fixed interval.
