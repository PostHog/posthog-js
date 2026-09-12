FROM node:24-bookworm

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
WORKDIR /app/compliance/browser

# Copy adapter code
COPY compliance/browser/adapter*.js ./

# Install a real browser; Playwright only controls the page and observes network traffic.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm init -y && npm install express@5.2.1 playwright@1.61.1 \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

EXPOSE 8080

USER node
RUN node --test adapter.test.js
CMD ["node", "adapter.js"]
