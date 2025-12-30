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

# Step 3: Install into local PostHog repo if POSTHOG_REPO is set
if [ -n "$POSTHOG_REPO" ]; then
    echo ""
    echo -e "${GREEN}3. Installing posthog-js into local PostHog repo...${NC}"

    if [ ! -d "$POSTHOG_REPO" ]; then
        echo -e "${YELLOW}Error: POSTHOG_REPO directory does not exist: $POSTHOG_REPO${NC}"
        exit 1
    fi

    TARBALL="$REPO_ROOT/target/posthog-js.tgz"
    if [ ! -f "$TARBALL" ]; then
        echo -e "${YELLOW}Error: Tarball not found: $TARBALL${NC}"
        exit 1
    fi

    cd "$POSTHOG_REPO"
    pnpm -r update "posthog-js@file:$TARBALL"
    pnpm install
    echo ""
    echo -e "${GREEN}Running frontend copy-scripts...${NC}"
    cd frontend && pnpm run copy-scripts
    echo -e "${GREEN}Installed posthog-js from $TARBALL${NC}"
fi

# Step 4: Ensure .pnpmfile.cjs symlink exists
echo ""
echo -e "${GREEN}4. Setting up .pnpmfile.cjs symlink...${NC}"
cd "$PLAYGROUND_DIR"
if [ ! -e .pnpmfile.cjs ]; then
    ln -s ../.pnpmfile.cjs .pnpmfile.cjs
    echo "Created symlink to .pnpmfile.cjs"
fi

# Step 5: Install dependencies in playground
echo ""
echo -e "${GREEN}5. Installing playground dependencies...${NC}"
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Step 6: Run dev server
echo ""
echo -e "${GREEN}6. Starting dev server...${NC}"
echo -e "${YELLOW}Tip: Open localhost:3000?__posthog_debug=true to see debug logs${NC}"
if [ -n "$POSTHOG_REPO" ]; then
    echo -e "${YELLOW}Tip: posthog-js was also installed in $POSTHOG_REPO${NC}"
fi
echo ""

# Pass through all environment variables and run dev
pnpm dev