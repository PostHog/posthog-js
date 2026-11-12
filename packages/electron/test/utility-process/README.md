# Installed utilityProcess proof

Run after building dependencies and SDK:

```sh
pnpm turbo run build --filter=@posthog/electron
pnpm --filter @posthog/electron test:utility
```

`run.mjs` packs the current Electron, browser-common, core and types packages, installs all four local tarballs into a fresh temporary pnpm app with a seven-day dependency cooldown, and launches the installed development Electron binary in normal application mode. `ELECTRON_RUN_AS_NODE` is removed. The temporary installation and logs are retained at the printed path for inspection. No source symlinks or live PostHog credentials are used.

`main.cjs` starts a local HTTP collector and uses only the installed `@posthog/electron/main`; `child.cjs` uses the installed `@posthog/electron/utility` in actual `utilityProcess.fork()` children. Fixture-only coordination messages share `parentPort` under a separate namespace and execute a fixed list of test actions, never eval.

Observed on macOS with Electron **42.4.0**:

```json
{
    "result": "PASS",
    "checks": [
        "identity",
        "consent",
        "session",
        "protected-context",
        "handled-exception",
        "flag-dedupe",
        "reset",
        "pending-close-rejection",
        "unexpected-exit",
        "replacement-source"
    ],
    "events": [
        "$identify",
        "$identify",
        "utility-work",
        "$exception",
        "$feature_flag_called",
        "after-reset",
        "pending-flush",
        "replacement-process"
    ]
}
```

The assertions cover main→utility and utility→main identity, shared session, utility→main opt-out, blocked capture, consent-preserving reset, capture/exception protected context and stable per-registration IDs, a handled native JavaScript `Error`, deduplicated cached-flag exposure, an in-flight flush promise rejected when main unregisters, cleanup after exit code 23 and fresh replacement-child attribution. Killing a child cannot report a rejected promise back from that dead process; its lifetime cleanup and queued owner authorization are also covered by unit tests.

Not established by this proof: Windows/Linux packaged distributions, native crashes, automatic JS error interception, cross-SDK harness conformance, or guaranteed delivery on abrupt process termination. The extension delegates existing owner behavior rather than changing those contracts. In the touched reset path, the existing owner's explicit consent-preservation policy differs from the published sdk-specs reset default clearing opt-out; this extension intentionally preserves it, as required for coordinated app-wide consent.

Automatic JavaScript exception interception is main/renderer-only. A utility facade and registration are single-lifetime; replace the registered child after disposal rather than reinitializing in the same process.
