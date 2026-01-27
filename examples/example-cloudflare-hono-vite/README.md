To run the example
- make sure you provide your variables in `vite.config.ts` and `src/index.ts` to connect to posthog,
- run `pnpm build` to build project and upload source maps,
- run `pnpm deploy` (includes build step) - to deploy your project to cloudflare workers.