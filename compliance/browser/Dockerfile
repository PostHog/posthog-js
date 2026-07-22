FROM node:24-alpine

WORKDIR /app

# Copy the entire monorepo (needed for workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tooling ./tooling
COPY packages/types ./packages/types
COPY packages/core ./packages/core
COPY packages/browser-common ./packages/browser-common
COPY packages/rrweb ./packages/rrweb
COPY packages/browser ./packages/browser

# Install pnpm
RUN npm install -g pnpm@11.7.0

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build posthog-js's workspace deps in the order their build scripts expect:
#   - @posthog/types, @posthog/core, and @posthog/browser-common ship a `build` script
#   - the in-tree @posthog/rrweb-* packages ship a `prepublish` script (their own
#     `build` shells out to `pnpm turbo run prepublish`, which races with the
#     outer turbo if invoked in parallel — running `prepublish` from the top-level
#     turbo gives us the correct ordering across all rrweb packages with no nesting)
RUN pnpm --filter @posthog/types build
RUN pnpm --filter @posthog/core build
RUN pnpm --filter @posthog/browser-common build
RUN pnpm turbo run prepublish

# Then build posthog-js (all its workspace deps now have populated `dist/` dirs).
RUN pnpm --filter posthog-js build

# Set up adapter in separate directory
WORKDIR /app/adapter

# Copy adapter code
COPY compliance/browser/adapter.js ./

# Install adapter dependencies (express, jsdom) in clean directory
RUN npm init -y && npm install express jsdom-global

EXPOSE 8080

USER node
CMD ["node", "adapter.js"]
