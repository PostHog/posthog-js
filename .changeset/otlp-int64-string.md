---
'posthog-js': patch
'posthog-react-native': patch
'posthog-node': patch
'@posthog/core': patch
'@posthog/types': patch
---

Fix logs and metrics being silently dropped when an attribute holds a very large integer, a function, a symbol, a sparse array, or a truncated emoji.
Cap log and metric attributes at 20 levels of nesting, 1,000 entries per object and 10,000 values in total, marking anything beyond as `[Truncated]`.
Type `OtlpAnyValue.intValue` as `string | number` — code reading that field must handle both.
