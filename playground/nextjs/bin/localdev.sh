#!/usr/bin/env bash

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLAYGROUND_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
REPO_ROOT="$( cd "$PLAYGROUND_DIR/../.." && pwd )"

echo -e "${BLUE}🚀 PostHog JS Local Development Setup${NC}"
echo ""

# Step 1: Build packages
echo -e "${GREEN}1. Building packages...${NC}"
cd "$REPO_ROOT"
pnpm build

# Step 2: Package into tarballs
echo ""
echo -e "${GREEN}2. Creating tarballs...${NC}"
pnpm package

# Step 2b: If POSTHOG_REPO is set, link posthog-js to PostHog repo
if [ -n "$POSTHOG_REPO" ]; then
    echo ""
    echo -e "${GREEN}2b. Linking posthog-js to PostHog repo...${NC}"
    cd "$POSTHOG_REPO"
    pnpm -r update "posthog-js@file:$REPO_ROOT/target/posthog-js.tgz"
    pnpm install
    cd frontend && pnpm run copy-scripts
    cd "$REPO_ROOT"
    echo "Linked posthog-js to $POSTHOG_REPO"
fi

# Step 3: Ensure .pnpmfile.cjs symlink exists
echo ""
echo -e "${GREEN}3. Setting up .pnpmfile.cjs symlink...${NC}"
cd "$PLAYGROUND_DIR"
if [ ! -e .pnpmfile.cjs ]; then
    ln -s ../.pnpmfile.cjs .pnpmfile.cjs
    echo "Created symlink to .pnpmfile.cjs"
fi

# Step 4: Install dependencies in playground
echo ""
echo -e "${GREEN}4. Installing playground dependencies...${NC}"
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Step 5: Run dev server
echo ""
echo -e "${GREEN}5. Starting dev server...${NC}"
echo -e "${YELLOW}Tip: Open localhost:3000?__posthog_debug=true to see debug logs${NC}"
echo ""

# Pass through all environment variables and run dev
pnpm dev