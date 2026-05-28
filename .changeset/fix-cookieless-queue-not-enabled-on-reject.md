---
'posthog-js': patch
---

fix(cookieless): enable request queue when opting out in `on_reject` mode. When using `cookieless_mode: "on_reject"`, calling `opt_out_capturing()` correctly switched the SDK into cookieless capturing but never enabled the `RequestQueue` — so batched events were enqueued but never flushed over the network. At init time the queue was not started because consent was `PENDING` and `is_capturing()` returned `false`; `opt_out_capturing()` is the first moment capturing becomes active but was missing the `_start_queue_if_opted_in()` call that `opt_in_capturing()` already had.
