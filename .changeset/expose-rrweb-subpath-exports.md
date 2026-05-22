---
'posthog-js': minor
---

Expose the in-repo `@posthog/rrweb`, `@posthog/rrweb-types`, and `@posthog/rrweb-plugin-console-record` packages as subpath entry points on `posthog-js`. Consumers can now `import { Replayer } from 'posthog-js/rrweb'`, `import type { eventWithTime } from 'posthog-js/rrweb-types'`, and `import { LogLevel } from 'posthog-js/rrweb-plugin-console-record'` instead of installing the underlying rrweb packages directly. The rrweb worker sourcemap (`image-bitmap-data-url-worker-*.js.map`) is also shipped from `posthog-js/dist/` so downstream bundlers no longer need to reach into `node_modules/@posthog/rrweb`.
