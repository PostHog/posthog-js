# PostHog VS Code Extension Playground

This is a playground to test PostHog integration within a VS Code extension's webview.

## How to run

1.  Open this directory (`packages/browser/playground/vscode-extension`) in a separate VS Code window.
2.  Open a terminal and run `pnpm install`.
3.  Press `F5` to open a new **Extension Development Host** window.
4.  In the new window, open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`) and search for "Start PostHog Playground".
5.  Run the command to open the webview.
6.  You can interact with the input and button to send events to PostHog.

## Configuration

### Running with a local posthog-js build

By default, the playground is configured to use a local build of `posthog-js`. In `src/extension.js`, the `runningLocally` constant is set to `true`. This will load `array.full.js` from the `packages/browser/dist` directory.

To use the production snippet from the PostHog CDN, you will need to set `runningLocally` to `false`.

### Environment Variables

The PostHog project key and API host are loaded from a `.env` file in the root of the `posthog-js` repository.

1.  If you don't already have one, create a `.env` file at the root of the `posthog-js` project.
2.  Add your PostHog Project Key to the `.env` file:
    ```
    POSTHOG_PROJECT_API_KEY=<your-project-key>
    POSTHOG_API_HOST=<your-api-host>
    ```
    If `POSTHOG_API_HOST` is not set, it will default to `http://localhost:8010`.
