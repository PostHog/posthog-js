FROM node:20-alpine

WORKDIR /app

# Copy the entire monorepo (needed for workspace dependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY tooling ./tooling
COPY packages/core ./packages/core
COPY packages/node ./packages/node

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the core and node packages
RUN pnpm --filter @posthog/core build
RUN pnpm --filter posthog-node build

# Set up adapter in separate directory
WORKDIR /app/adapter

# Copy adapter code
COPY compliance/node/adapter.js ./

# Install adapter dependencies (express) in clean directory
RUN npm init -y && npm install express

EXPOSE 8080

CMD ["node", "adapter.js"]
