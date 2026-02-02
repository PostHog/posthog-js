FROM node:20-alpine

WORKDIR /app

# Copy the entire monorepo (needed for workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY tooling ./tooling
COPY packages/types ./packages/types
COPY packages/core ./packages/core
COPY packages/browser ./packages/browser

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the types, core, and browser packages
RUN pnpm --filter @posthog/types build
RUN pnpm --filter @posthog/core build
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
