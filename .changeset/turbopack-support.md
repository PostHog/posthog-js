---
'@posthog/nextjs-config': minor
---

Add Turbopack support while maintaining Webpack compatibility

- Automatically detects Turbopack usage via --turbo flag or config settings
- Processes sourcemaps post-build for Turbopack since it doesn't support webpack plugins  
- Shares common sourcemap processing logic between Webpack and Turbopack handlers
- Maintains full backward compatibility with existing Webpack configurations
- No configuration changes needed - same config works for both bundlers
- Adds version detection for runAfterProductionCompile hook (requires Next.js 15.4.0+)
- Provides clear error message when hook is not supported in older Next.js versions