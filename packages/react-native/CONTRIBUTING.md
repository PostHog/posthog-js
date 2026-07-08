# Contributing

This guide covers package-specific development for `posthog-react-native`.

For repository-wide setup, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Running the sample app with Expo

See [Example Expo 53](../../examples/example-expo-53/README.md).

## CI-aligned checks

Run these commands from the repository root:

```sh
pnpm --filter=posthog-react-native lint
pnpm --filter=posthog-react-native test
pnpm --filter=posthog-react-native build
```
