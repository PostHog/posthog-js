# PostHog esbuild plugin

Register esbuild's content-hashed output filenames as PostHog error-tracking chunk IDs **before** the surrounding build system computes asset hashes.

This is intended for build systems such as Angular's `application` builder, where running `posthog-cli sourcemap inject` after `ng build` would invalidate `ngsw.json`, Subresource Integrity values, or another content-hash manifest.

## Angular

Angular does not expose custom esbuild plugins in its standard `application` builder configuration. Use the community [`@angular-builders/custom-esbuild`](https://github.com/just-jeb/angular-builders/tree/master/packages/custom-esbuild) builder and match its major version to your Angular major version.

```bash
npm install --save-dev @posthog/esbuild-plugin @posthog/cli @angular-builders/custom-esbuild
```

Create a small workspace-local plugin file because `custom-esbuild` resolves plugin entries as file paths:

```ts
// tools/posthog-esbuild-plugin.ts
import posthogEsbuildPlugin from '@posthog/esbuild-plugin'

export default posthogEsbuildPlugin()
```

Update the build target in `angular.json`:

```jsonc
{
    "builder": "@angular-builders/custom-esbuild:application",
    "options": {
        "plugins": ["./tools/posthog-esbuild-plugin.ts"],
        "sourceMap": {
            "scripts": true,
            "styles": false,
            "hidden": true,
            "vendor": true,
        },
    },
}
```

The plugin adds a deterministic runtime banner before esbuild computes output filenames. Once esbuild names each chunk, the plugin stamps that filename into its source-map metadata without rewriting the JavaScript. Angular then creates `index.html` and `ngsw.json` from the final JavaScript, so content-hashed filenames and service-worker hashes both remain valid.

Keep Angular's production `outputHashing` enabled. The output filename is the symbol-set identity, so an unhashed name such as `main.js` would collide with a later build.

Upload the already-injected output after the build:

```bash
ng build --configuration production
posthog-cli sourcemap upload --directory dist/<app>/browser
```

Set `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID`, and `POSTHOG_CLI_HOST` in the build environment as described in the [PostHog CLI documentation](https://posthog.com/docs/error-tracking/upload-source-maps/cli).

Do **not** run `sourcemap process` or `sourcemap inject` after this build. Those commands rewrite the emitted JavaScript and invalidate hashes that Angular has already computed.

If source maps must not be deployed, remove only the `.map` files after a successful upload. Do not use `sourcemap upload --delete-after`, because that option also strips comments from JavaScript and changes its hash.

## Plain esbuild

The plugin operates on esbuild's `outputFiles`, so plain esbuild builds must use `write: false`. Write the returned files after the plugin has modified them, then run `posthog-cli sourcemap upload`.

```ts
import { build } from 'esbuild'
import posthogEsbuildPlugin from '@posthog/esbuild-plugin'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const result = await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    outdir: 'dist',
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    sourcemap: 'external',
    write: false,
    plugins: [posthogEsbuildPlugin()],
})

for (const file of result.outputFiles) {
    await mkdir(path.dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents)
}
```

## Options

```ts
posthogEsbuildPlugin({
    enabled: process.env.NODE_ENV === 'production',
})
```

The first release supports PostHog's default `symbol-set` release mode. Pass release metadata to the later `sourcemap upload` command if required. Event release mode is not supported because it requires embedding a resolved release ID into each JavaScript chunk.
