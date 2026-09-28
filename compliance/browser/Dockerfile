FROM node:24-alpine

WORKDIR /app

# Copy the entire monorepo (needed for workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches
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

RUN pnpm turbo run build --filter=posthog-js

# Set up adapter in separate directory
WORKDIR /app/adapter

# Copy adapter code
COPY compliance/browser/adapter.js ./

# Install adapter dependencies (express, jsdom) in clean directory
RUN npm init -y && npm install express jsdom-global

EXPOSE 8080

USER node
CMD ["node", "adapter.js"]
