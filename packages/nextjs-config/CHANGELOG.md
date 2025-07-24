# 1.0.2

- fix: search for posthog-cli binary from the @posthog/nextjs-config package
- chore: add error messages
- chore: bump @posthog/cli dependency to 0.3.5
- feat: take distDir into account when looking for sources

# 1.0.1

- Fix build issues on vercel deployment (xz system library missing)

## 1.0.0
- generate nextjs configuration for sourcemap generation
- inject chunk ids into emitted assets
- automatically upload sourcemaps to PostHog
- optionally remove sourcemaps from emitted assets after upload
