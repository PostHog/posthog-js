# Replay artifact compatibility tests

The `Replay artifact compatibility` CI job builds the pull request and its base revision,
prepares the released cores below, and runs both suites across all three browser engines.
The fixture checks fail the job if preparation is incomplete.

Build the candidate browser SDK and a comparison revision in separate checkouts. Set
`REPLAY_BASELINE_DIST` to the comparison checkout's `packages/browser/dist` directory.
The shared-extension suite tests independently emitted core/extension combinations;
the released-core suite compares both recorders against the same released cores.

Prepare released-core fixtures outside the checkout:

```sh
export REPLAY_RELEASED_CORE_DIR=$(mktemp -d)
for version in 1.268.5 1.268.6 1.400.0; do
    destination="$REPLAY_RELEASED_CORE_DIR/$version"
    mkdir -p "$destination"
    npm pack --ignore-scripts "posthog-js@$version" --pack-destination "$destination"
    tar -xzf "$destination/posthog-js-$version.tgz" -C "$destination"
done
```

From `packages/browser`:

```sh
REPLAY_BASELINE_DIST=/path/to/comparison/packages/browser/dist \
    pnpm exec playwright test \
    playwright/mocked/session-recording/session-recording-released-core.spec.ts \
    playwright/mocked/session-recording/session-recording-shared-extension.spec.ts \
    --workers=2 --reporter=line
```

The released matrix covers:

- **1.268.5 / 1.268.6:** before and after session-manager forced-idle notifications,
  using both the default eager recorder and the supported lazy-replay preview option.
- **1.400.0:** a later lazy-recorder core before shared replay lifecycle integration.

Each case uses the released core's loader, checks initial recording content and input
masking, then compares reset/unload outcomes with the baseline recorder. It records
normalized outcomes in `released-core-outcomes.json` under the Playwright output
folder. Historical-core parity is separate from the stricter current-core attribution
assertions in the shared-extension suite.

All requests are fulfilled locally or aborted; fixtures use a dummy token. WebKit omits
some Beacon Blob bodies from intercepted requests, so the fixture observes those exact
bodies while still invoking the native `sendBeacon` transport.
