---
name: compare-array-bundle-size
description: Quickly compare the posthog-js array.js bundle size in the current working tree against a git baseline using the repository's esbuild proxy. Use when asked about array.js size, bundle-size percentage changes, whether browser SDK changes increased the bundle, or for a fast size check that should not run the production Rollup build.
compatibility: Requires a posthog-js checkout with dependencies installed.
---

# Compare `array.js` bundle size

Use the repository's fast comparison command. Do not run TypeScript compilation, Terser, Rollup, Turbo, or the full build unless the user separately requests production bundle numbers.

## Workflow

1. Use the baseline named by the user. If none is given, let the script default to `origin/main` and then `main`.
2. From the repository root, run:

    ```bash
    pnpm bundle-size:array [baseline-ref]
    ```

3. Report:
    - the resolved baseline ref and commit
    - minified percentage and byte change
    - gzip percentage and byte change
    - Brotli percentage and byte change
    - elapsed time
4. Lead with the percentage most relevant to the user's question. If they did not specify one, lead with minified and include the compressed results below it.

## Interpretation

- The command builds both source trees with the same esbuild version, options, installed dependencies, and workspace-source aliases, so the percentage is an apples-to-apples comparison.
- The current side includes tracked, uncommitted, and imported untracked source changes from the working tree.
- The baseline side is a temporary source snapshot from the resolved git commit; the command does not check out or modify the working tree.
- Treat the result as a fast directional comparison. Absolute bytes differ from the production Rollup/Terser output.
- A positive percentage is a size increase; a negative percentage is a reduction.

## Validation and troubleshooting

- To verify the comparison machinery itself, run `pnpm bundle-size:array HEAD`. With no relevant uncommitted source changes, every row should report `0.00%`.
- If the baseline ref cannot be resolved, ask for another local git ref or fetch it only with the user's approval when network access is required.
- If esbuild or other dependencies are missing, explain that dependencies must be installed. Do not substitute the full production build.
