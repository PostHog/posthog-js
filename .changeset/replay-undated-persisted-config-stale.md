---
'posthog-js': patch
---

Fix session recording starting from arbitrarily old persisted configs.

Recording configs persisted by SDK versions before 1.347.2 carry no `cache_timestamp`. The core freshness check treated these undated configs as always fresh, so the recorder started immediately under their settings. A device whose stored config predated a customer's config change kept recording under the old triggers, sample rate, and masking settings indefinitely.

The core now treats undated persisted configs as stale. Recording waits for a fresh remote config before it starts, the same path every dated config older than one hour already takes. The lazy recorder bundle is unchanged: it still accepts undated configs, because old cores that load the latest bundle cannot recover from a rejected config (INC-749).
