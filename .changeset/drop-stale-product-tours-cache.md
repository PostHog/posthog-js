---
'posthog-js': patch
---

fix(product-tours): drop the cached tours blob when product tours is not enabled

Tours fetched while product tours was enabled are cached under `ph_product_tours` in the main persistence blob. Once product tours is disabled (remote config or the `disable_product_tours` option) that cache was never cleaned up, so a potentially large stale blob kept riding on every persistence write — and on every cross-tab `storage` event those writes broadcast. `onRemoteConfig` now clears the cached tours whenever product tours resolves to disabled; they are re-fetched if it is ever re-enabled.
