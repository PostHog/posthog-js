# Pinning browser SDK content

Exact SDK versions control upgrades. Subresource Integrity (SRI) also lets the browser reject changed bytes at an otherwise trusted script URL. Use customer-approved hashes stored in your application deployment, not hashes fetched dynamically from the vendor at page load.

For high-assurance applications, prefer an exact npm dependency and lockfile with a no-external distribution and `disable_external_dependency_loading: true`. CDN delivery can instead use the controls below, but every executable dependency needs its own policy.

## Release integrity manifests

A full `posthog-js` build writes `dist/integrity.json` with SHA-384 hashes of the final JavaScript, CSS, and WebAssembly assets:

```json
{
    "version": "<exact SDK version>",
    "files": {
        "array.js": "sha384-<base64 digest>",
        "loader.js": "sha384-<different base64 digest>",
        "recorder.js": "sha384-<another base64 digest>"
    }
}
```

The npm package includes its build's manifest. CDN publication generates a manifest for the actual delivered assets after the regional toolbar has been added, at `/static/<exact-version>/integrity.json`. Regional toolbar bytes can differ, so use the manifest for the asset host you serve. Development watch mode does not regenerate release manifests; run the full build before checking hashes.

Download and review the manifest during your dependency-update/deployment process. Verify that the release and assets are the ones you intend to approve, then store the selected hashes in customer-controlled source or build artifacts. A manifest retrieved from a compromised vendor is not an independent trust anchor. Hashes do not establish that the originally approved release was benign.

## Protect both the loader and its downloaded core

The static loader accepts `data-core-integrity`, containing one SHA-384 SRI value from the manifest's `array.js` entry. Set the outer tag's `integrity` to the separate `loader.js` hash:

```html
<script
    src="https://us-assets.i.posthog.com/static/EXACT_VERSION/loader.js"
    integrity="SHA384_LOADER_HASH_FROM_APPROVED_MANIFEST"
    data-core-integrity="SHA384_ARRAY_HASH_FROM_APPROVED_MANIFEST"
    data-project-token="phc_YOUR_PROJECT_TOKEN"
    crossorigin="anonymous"
></script>
```

Replace `EXACT_VERSION` and both hash placeholders at build/deployment time. Do not use a mutable loader alias with an exact approved core hash. The loader continues to work without `data-core-integrity`, but its downloaded core then has no SRI protection. A present but empty or malformed `data-core-integrity` stops loading rather than silently downloading an unprotected core. The attribute requires exactly one `sha384-` value with a 64-character base64 digest; other algorithms and multiple values are not supported by this attribute.

SRI is not transitive: the outer `integrity` protects only the loader. `data-core-integrity` protects only `array.js`. Forwarding a CSP nonce is not an integrity check. Cross-origin SRI also requires appropriate CORS response headers from your asset host or proxy.

## Approve every optional script

Use `strict_script_versioning: true` and the existing `prepare_external_dependency_script` hook to attach customer-pinned hashes and reject every URL outside an explicit allowlist. For function-valued configuration, use the loader's deferred initialization or an ordinary npm/direct-core installation.

```js
const approvedScripts = new Map([
    // Populate exact absolute URLs and hashes from your approved release at build time.
    ['https://us-assets.i.posthog.com/static/EXACT_VERSION/recorder.js', 'SHA384_RECORDER_HASH'],
])

posthog.init('phc_YOUR_PROJECT_TOKEN', {
    api_host: 'https://us.i.posthog.com',
    strict_script_versioning: true,
    opt_in_site_apps: false,
    disable_web_experiments: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    prepare_external_dependency_script(script) {
        const integrity = approvedScripts.get(script.src)
        if (!integrity) {
            return null
        }
        script.integrity = integrity
        script.crossOrigin = 'anonymous'
        return script
    },
})
```

Use valid manifest hashes in `approvedScripts`; placeholders are not working hashes. Do not approve a URL by filename alone or fetch the expected hash from that URL at runtime. Keep `true` rather than `'fallback'` for strict versioning: fallback retries a legacy mutable URL after a generic load error, which can also represent SRI failure.

The default SDK still attempts mutable executable `/array/<token>/config.js`. The allowlist above intentionally rejects it, so the existing remote-config loader falls back to JSON. This is an opt-in installation policy, not a change to the SDK's default transport. Enabling site apps is incompatible with this example's restriction.

Do not enable the toolbar under this policy: its code-split dynamic imports are not covered by integrity attributes on the initial toolbar tag. A manifest can describe their bytes, but does not make browser integrity checks transitive. Use local bundling or exclude features whose executable dependency graph you cannot independently constrain. Use only one trusted SDK installation per page; a permissive second copy can execute code before a restrictive copy can reject it.

## Boundaries

- Integrity verification rejects modified code, but does not sandbox approved code or sanitize remote HTML/configuration data interpreted by that code.
- Strict CSP without inline handlers is an additional defense. Allowing a vendor script origin does not protect against malicious bytes served from that origin.
- A reverse proxy only adds integrity protection if it serves approved snapshots or independently enforces customer-pinned bytes; forwarding the latest vendor response is not protection.
- Treat digest mismatches as a disabled telemetry feature, not a reason to retry an unverified URL or fetch replacement hashes automatically. Keep the host application functional without telemetry.
- Retain reviewed, timely updates: indefinitely pinning an old release also freezes its security vulnerabilities.
