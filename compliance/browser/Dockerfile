FROM node:20-alpine

WORKDIR /app

# Copy the entire monorepo (needed for workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tooling ./tooling
COPY packages/types ./packages/types
COPY packages/core ./packages/core
COPY packages/rrweb ./packages/rrweb
COPY packages/browser ./packages/browser

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all workspace deps first (the in-tree @posthog/rrweb-* packages use
# `prepublish` rather than `build`; running `prepublish` from the top-level
# turbo avoids nested-turbo races on shared deps like @posthog/rrweb-utils).
RUN pnpm turbo run prepublish

# Then build posthog-js (its workspace deps now have populated `dist/` dirs).
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
