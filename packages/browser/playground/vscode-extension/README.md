# PostHog VS Code Extension Playground

This is a playground to test PostHog integration within a VS Code extension's webview.

## How to run

1.  Open this directory (`packages/browser/playground/vscode-extension`) in a separate VS Code window.
2.  Open a terminal and run `npm install`.
3.  Press `F5` to open a new **Extension Development Host** window.
4.  In the new window, open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`) and search for "Start PostHog Playground".
5.  Run the command to open the webview.
6.  You can interact with the input and button to send events to PostHog.

## Using a Local posthog-js Build

To test against a local build of `posthog-js` (e.g., from `packages/browser/dist/array.full.js`), you can easily switch from the default CDN version.

In `packages/browser/playground/vscode-extension/src/extension.js`, find the `runFromLocal` constant inside the `activate` function and set it to `true`.

```javascript
function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.start', () => {
            // Set to true to load the script from a local file, false to load from the CDN
            const runFromLocal = true; // <-- CHANGE THIS

            // ... rest of the function ...
        })
    );
}
```

The extension's code is already set up to handle the rest. When `runFromLocal` is `true`, it will automatically grant the webview the necessary permissions and load the script from your local build. To switch back to the CDN version, just change `runFromLocal` back to `false`. 