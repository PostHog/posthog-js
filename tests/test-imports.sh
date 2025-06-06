#!/bin/bash

# Test script to verify that the default export fix works correctly
# This prevents regressions of the TypeScript default export issue
# See https://github.com/PostHog/posthog-js/issues/1323

set -e  # Exit on any error

echo "🧪 Testing import/export compatibility..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to run test and check result
run_test() {
    local test_name="$1"
    local test_script="$2"
    local node_args="$3"
    
    echo -n "  ✓ $test_name: "
    
    if result=$(node $node_args -e "$test_script" 2>&1); then
        # Check if "success" is in the output (ignoring warnings)
        if echo "$result" | grep -q "success"; then
            echo -e "${GREEN}PASS${NC}"
        else
            echo -e "${RED}FAIL${NC} - Unexpected output: $result"
            exit 1
        fi
    else
        echo -e "${RED}FAIL${NC} - Error: $result"
        exit 1
    fi
}

# Ensure dist files exist
if [[ ! -f "dist/main.js" ]]; then
    echo "❌ dist/main.js not found. Please run 'pnpm build-rollup' first."
    exit 1
fi

if [[ ! -f "dist/module.js" ]]; then
    echo "❌ dist/module.js not found. Please run 'pnpm build-rollup' first."
    exit 1
fi

echo "📦 Testing CommonJS (main.js)..."

# Test 1: Default import should work without .default
run_test "Default import without .default" "
const posthog = require('./dist/main.js');
if (typeof posthog.init !== 'function') {
    process.exit(1);
}
console.log('success');
"

# Test 2: Named imports should work
run_test "Named imports" "
const { PostHog, posthog } = require('./dist/main.js');
if (typeof PostHog !== 'function') {
    process.exit(1);
}
if (typeof posthog.init !== 'function') {
    process.exit(2);
}
console.log('success');
"

# Test 3: Backward compatibility with .default
run_test "Backward compatibility with .default" "
const posthog = require('./dist/main.js');
if (typeof posthog.default !== 'object') {
    process.exit(1);
}
if (posthog !== posthog.default) {
    process.exit(2);
}
console.log('success');
"

# Test 4: Default and named exports should be same instance
run_test "Default and named exports same instance" "
const defaultExport = require('./dist/main.js');
const { posthog: namedExport } = require('./dist/main.js');
if (defaultExport !== namedExport) {
    process.exit(1);
}
console.log('success');
"

# Test 5: Core methods should be available
run_test "Core PostHog methods available" "
const posthog = require('./dist/main.js');
const requiredMethods = ['init', 'capture', 'identify', 'reset'];
for (const method of requiredMethods) {
    if (typeof posthog[method] !== 'function') {
        console.error('Missing method:', method);
        process.exit(1);
    }
}
console.log('success');
"

echo "📦 Testing ES Modules (module.js)..."

# Test 6: ES module default import
run_test "ES module default import" "
import posthog from './dist/module.js';
if (typeof posthog.init !== 'function') {
    process.exit(1);
}
console.log('success');
" "--input-type=module"

# Test 7: ES module named imports
run_test "ES module named imports" "
import { PostHog, posthog } from './dist/module.js';
if (typeof PostHog !== 'function') {
    process.exit(1);
}
if (typeof posthog.init !== 'function') {
    process.exit(2);
}
console.log('success');
" "--input-type=module"

# Test 8: ES module default and named same instance
run_test "ES module default and named same instance" "
import defaultExport, { posthog as namedExport } from './dist/module.js';
if (defaultExport !== namedExport) {
    process.exit(1);
}
console.log('success');
" "--input-type=module"

echo "🔍 Testing build output..."

# Test 9: Check for correct module.exports structure
echo -n "  ✓ Correct module.exports structure: "
if grep -q "module.exports=exports.posthog" dist/main.js && \
   grep -q "module.exports.default=exports.posthog" dist/main.js && \
   grep -q "Object.assign(module.exports,exports)" dist/main.js; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC} - module.exports structure incorrect"
    exit 1
fi

echo ""
echo -e "🎉 ${GREEN}All import/export tests passed!${NC}"
echo "   The TypeScript default export issue has been successfully fixed." 