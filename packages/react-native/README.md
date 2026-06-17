# PostHog React Native package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [React Native library docs](https://posthog.com/docs/libraries/react-native)

## Expo config plugin options

```json
{
  "expo": {
    "plugins": [["posthog-react-native", { "skipOnConflict": true }]]
  }
}
```

| Option | Type | Description |
| --- | --- | --- |
| `skipOnConflict` | `boolean` | Appends `--skip-on-conflict` to `posthog-cli hermes upload` on iOS and Android. Requires `posthog-cli >= 0.7.12`. |

## Questions??

### [Check out our community page.](https://posthog.com/posts)
