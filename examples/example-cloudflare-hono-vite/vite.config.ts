import { cloudflare } from '@cloudflare/vite-plugin'
import posthog from '@posthog/rollup-plugin'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

export default defineConfig({
  plugins: [
    cloudflare(),
    ssrPlugin(),
    posthog({
      personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
      envId: process.env.POSTHOG_PROJECT_ID!,
      host: process.env.POSTHOG_API_HOST,
      sourcemaps: {
        enabled: true,
        deleteAfterUpload: false,
      },
    }),
  ],
})
