# PostHog VS Code Extension Playground

This is a playground to test PostHog integration within a VS Code extension's webview.

## How to run

1.  Open this directory (`packages/browser/playground/vscode-extension`) in a separate VS Code window.
2.  Open a terminal and run `pnpm install`.
3.  Press `F5` to open a new **Extension Development Host** window.
4.  In the new window, open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`) and search for "Start PostHog Playground".
5.  Run the command to open the webview.
6.  You can interact with the input and button to send events to PostHog. 