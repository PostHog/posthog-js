## Edge runtime examples

All four use the explicit `posthog-node/edge` import and request-scoped clients:

| Example                                                     | Runtime                          | Delivery                        |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------- |
| [Cloudflare Worker](./example-cloudflare)                   | workerd, without `nodejs_compat` | `ExecutionContext.waitUntil`    |
| [Vercel Edge Function](./example-vercel-edge)               | Vercel Edge, without Next.js     | `@vercel/functions` `waitUntil` |
| [Next.js Edge middleware](./example-nextjs-edge-middleware) | Next.js 15 Edge middleware       | `NextFetchEvent.waitUntil`      |
| [Next.js Edge Route Handler](./example-nextjs-edge-route)   | Next.js 16 Edge Route Handler    | Awaited `flush()`               |

Next.js 16's `proxy.ts` uses Node.js; the middleware example intentionally stays on Next.js 15.
For Next.js 16 Edge usage, see the Route Handler example. Next.js 16.3 deprecates the Edge
Runtime; prefer Node.js with `posthog-node` for new Next.js applications unless Edge is required.
These cover server-side event capture, not browser autocapture or session replay.

After installing root dependencies and all four examples, run the credential-free delivery
smoke tests from the repository root:

```sh
node --test examples/test-edge-examples.mjs
```

The tests bundle the handlers and verify event delivery through mocked fetch, including
`waitUntil` registration or awaiting the flush before returning.
They do not replace the Cloudflare dry-run and Next.js production builds documented in each
example, or a deployed Vercel runtime check.

## Installation

### Export packages

From the workspace root folder, run the following command:

```shell
pnpm package:watch
```

This will watch for file changes across all workspace members and export packages as tarballs inside the target folder.

Note: It takes dependencies into account, if you change @posthog/core, it will reexport all packages that depend on it.

### Install dependencies

Open a new terminal, go to the specific example folder and run the following command:

```
pnpm install
```

Dependencies inside package.json are overridden by tarballs.

You can now run the example, by following instructions inside each example's README.md file.

When changes are made inside the workspace, new tarballs are created and you just need to reinstall the dependencies:

```
pnpm install
```

## Why use tarballs?

Tarball installation is as close to real-world installation as possible. It solves issues with symlinking, node_modules resolutions and sub-dependencies overrides. It also allows for easy inspection of the package contents and testing in other projects.
