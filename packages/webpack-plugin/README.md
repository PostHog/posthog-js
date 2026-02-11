# @posthog/webpack-plugin

Webpack plugin for uploading source maps to PostHog for error tracking.

[SEE FULL DOCS](https://posthog.com/docs/error-tracking/upload-source-maps/webpack)

## Installation

```bash
npm install @posthog/webpack-plugin --save-dev
```

## Usage

Add the plugin to your webpack configuration:

```typescript
import { PosthogWebpackPlugin } from '@posthog/webpack-plugin'

export default {
    // ... your webpack config
    plugins: [
        new PosthogWebpackPlugin({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            projectId: process.env.POSTHOG_PROJECT_ID,
            sourcemaps: {
                enabled: true,
                project: 'my-app',
                version: '1.0.0',
            },
        }),
    ],
}
```

### Configuration Options

| Option                         | Type                                                 | Required | Default                    | Description                                 |
| ------------------------------ | ---------------------------------------------------- | -------- | -------------------------- | ------------------------------------------- |
| `personalApiKey`               | `string`                                             | Yes      | -                          | Your PostHog personal API key               |
| `projectId`                    | `string`                                             | Yes      | -                          | Your PostHog project/environment ID         |
| `envId`                        | `string`                                             | No       | -                          | Deprecated alias for `projectId`            |
| `host`                         | `string`                                             | No       | `https://us.i.posthog.com` | PostHog instance host                       |
| `logLevel`                     | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'` | No       | `'info'`                   | Logging verbosity                           |
| `cliBinaryPath`                | `string`                                             | No       | Auto-detected              | Path to the PostHog CLI binary              |
| `sourcemaps.enabled`           | `boolean`                                            | No       | `true` in production       | Enable source map processing                |
| `sourcemaps.project`           | `string`                                             | No       | -                          | Project name for source map grouping        |
| `sourcemaps.version`           | `string`                                             | No       | -                          | Version identifier for the release          |
| `sourcemaps.deleteAfterUpload` | `boolean`                                            | No       | `true`                     | Delete source maps after upload             |
| `sourcemaps.batchSize`         | `number`                                             | No       | -                          | Number of source maps to upload in parallel |

### Full Example

```typescript
import path from 'node:path'
import webpack from 'webpack'
import { PosthogWebpackPlugin } from '@posthog/webpack-plugin'
import packageJson from './package.json'

const config: webpack.Configuration = {
    mode: 'production',
    entry: './src/index.ts',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new PosthogWebpackPlugin({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            projectId: process.env.POSTHOG_PROJECT_ID,
            host: process.env.POSTHOG_API_HOST,
            logLevel: 'error',
            sourcemaps: {
                enabled: true,
                project: packageJson.name,
                version: packageJson.version,
                deleteAfterUpload: true,
            },
        }),
    ],
}

export default config
```

## Questions?

### [Check out our community page.](https://posthog.com/docs/error-tracking/upload-source-maps/webpack)
