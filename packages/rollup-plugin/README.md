# @posthog/rollup-plugin

Rollup plugin for uploading source maps to PostHog for error tracking.

[SEE FULL DOCS](https://posthog.com/docs/error-tracking/upload-source-maps/rollup)

## Installation

```bash
npm install @posthog/rollup-plugin --save-dev
```

## Usage

Add the plugin to your Rollup configuration:

```javascript
import posthog from '@posthog/rollup-plugin'

export default {
    input: './src/index.ts',
    output: {
        format: 'es',
        dir: 'dist',
    },
    plugins: [
        posthog({
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
| `sourcemaps.enabled`           | `boolean`                                            | No       | `true`                     | Enable source map processing                |
| `sourcemaps.project`           | `string`                                             | No       | -                          | Project name for source map grouping        |
| `sourcemaps.version`           | `string`                                             | No       | -                          | Version identifier for the release          |
| `sourcemaps.deleteAfterUpload` | `boolean`                                            | No       | `true`                     | Delete source maps after upload             |
| `sourcemaps.batchSize`         | `number`                                             | No       | -                          | Number of source maps to upload in parallel |

### Full Example

```javascript
import posthog from '@posthog/rollup-plugin'
import packageJson from './package.json' with { type: 'json' }

export default {
    input: './src/index.ts',
    output: [
        {
            format: 'es',
            dir: 'dist/esm',
        },
    ],
    plugins: [
        posthog({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            projectId: process.env.POSTHOG_PROJECT_ID,
            host: process.env.POSTHOG_API_HOST,
            logLevel: 'info',
            sourcemaps: {
                enabled: true,
                project: packageJson.name,
                version: packageJson.version,
            },
        }),
    ],
}
```

## Questions?

### [Check out our community page.](https://posthog.com/docs/error-tracking/upload-source-maps/rollup)
