# PostHog RN Playground

This is a playground to explore the PostHog react-native SDK and test your changes locally.

It uses [Expo](https://expo.dev), and was originally created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

### Configure your PostHog project

1. Update `app/_layout.tsx` with your API key & host:

    ```tsx
    <PostHogProvider
       apiKey="your-api-key"
       options={{
          host: 'http://localhost:8010', // or us.posthog, eu.posthog, etc
       }}
       ...
    >
    ```

### [optional] Using local `posthog-react-native` SDK

If you're testing local changes to the SDK, follow these steps to have this app use them:

1. Build the SDK (from repo root)

    ```bash
    pnpm build
    ```

2. Generate tarball (from repo root)

    ```bash
    pnpm package
    ```

3. Update dependencies to point to your local SDK tarball

    `posthog-js/playground/rn-expo/package.json`:

    ```json
    {
        "posthog-react-native": "file:../../target/posthog-react-native.tgz"
    }
    ```

    _(this is finnicky, you may need to use an absolute path instead)_

4. Clean install

```bash
rm -rf node_modules package-lock.json && npm cache clean --force && npm install
```

### Run the app

1. Install dependencies, if needed

    ```bash
    npm install
    ```

2. Start the app

    ```bash
    npx expo start
    ```
