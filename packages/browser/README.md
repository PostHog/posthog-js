# PostHog Browser JS Library

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

For information on using this library in your app, [see PostHog Docs](https://posthog.com/docs/libraries/js).
This README is intended for developing the library itself.

## Dependencies

We use pnpm.

It's best to install using `npm install -g pnpm@latest-9`
and then `pnpm` commands as usual

### Optional Dependencies

This package has the following optional peer dependencies:

- `@rrweb/types` (2.0.0-alpha.17): Only required if you're using Angular Compiler and need type definitions for the rrweb integration.
- `rrweb-snapshot` (2.0.0-alpha.17): Only required if you're using Angular Compiler and need type definitions for the rrweb integration.

These dependencies are marked as optional to reduce installation size for users who don't need these specific features.

##

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for package-specific testing and local linking instructions.
