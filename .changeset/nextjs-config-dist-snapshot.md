---
'@posthog/nextjs-config': patch
---

fix: snapshot build outputs into an explicit file list before invoking the sourcemap CLI, so Turbopack's background filesystem-cache writes on Next.js 16.3+ can no longer race the CLI's inject/upload passes and fail the build with "Chunk ID not found". The bundler cache directory (`<distDir>/cache`) is no longer scanned.
