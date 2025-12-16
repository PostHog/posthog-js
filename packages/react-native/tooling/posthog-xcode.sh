# adapted from https://github.com/getsentry/sentry-react-native/blob/e76d0d388228437e82f235546de00f4e748fcbda/packages/core/scripts/sentry-xcode.sh

#!/bin/bash
# Bundle React Native code and images
# PWD=ios

# print commands before executing them and stop on first error
set -x -e

# WITH_ENVIRONMENT is executed by React Native

REACT_NATIVE_XCODE_DEFAULT="../node_modules/react-native/scripts/react-native-xcode.sh"
REACT_NATIVE_XCODE="${1:-$REACT_NATIVE_XCODE_DEFAULT}"

# Check if DERIVED_FILE_DIR exists, defined by Xcode
if [ ! -d "$DERIVED_FILE_DIR" ]; then
  echo "error: DERIVED_FILE_DIR does not exist: $DERIVED_FILE_DIR"
  exit 1
fi

# RN/users can define a BUNDLE_NAME, or fallback to main
SOURCEMAP_NAME="${BUNDLE_NAME:-main}.jsbundle.map"

[ -z "$SOURCEMAP_FILE" ] && export SOURCEMAP_FILE="$DERIVED_FILE_DIR/$SOURCEMAP_NAME"

# Check if CONFIGURATION_BUILD_DIR exists, defined by Xcode
if [ ! -d "$CONFIGURATION_BUILD_DIR" ]; then
  echo "error: CONFIGURATION_BUILD_DIR does not exist: $CONFIGURATION_BUILD_DIR"
  exit 1
fi

# Check for posthog-cli using installer environment variables
# TODO: provide a config that users can force the location
# Xcode starts with a very limited $PATH so using whereis does not work
if [ -f "$HOME/.posthog/posthog-cli" ]; then
  PH_CLI_PATH="$HOME/.posthog/posthog-cli"
else
  # Check if installed via npm -g @posthog/cli
  NPM_GLOBAL_PREFIX=$(npm prefix -g 2>/dev/null)
  if [ -n "$NPM_GLOBAL_PREFIX" ] && [ -f "$NPM_GLOBAL_PREFIX/bin/posthog-cli" ]; then
    PH_CLI_PATH="$NPM_GLOBAL_PREFIX/bin/posthog-cli"
  else
    # Check if installed as local dependency
    NPM_LOCAL_ROOT=$(npm root 2>/dev/null)
    if [ -n "$NPM_LOCAL_ROOT" ] && [ -f "$NPM_LOCAL_ROOT/.bin/posthog-cli" ]; then
      PH_CLI_PATH="$NPM_LOCAL_ROOT/.bin/posthog-cli"
    else
      # Fallback to searching common locations
      export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.posthog:$PATH"
      PH_CLI_PATH=$(command -v posthog-cli 2>/dev/null)
    fi
  fi
fi

if [ -z "$PH_CLI_PATH" ] || [ ! -x "$PH_CLI_PATH" ]; then
  echo "error: posthog-cli not found"
  exit 1
fi

# mimics how the file is defined in node_modules/react-native/scripts/react-native-xcode.sh (PACKAGER_SOURCEMAP_FILE)
SOURCEMAP_PACKAGER_FILE="$CONFIGURATION_BUILD_DIR/$SOURCEMAP_NAME"

# RN deletes the PACKAGER_SOURCEMAP_FILE file after execution but we need it
# lets patch the script to comment out this part if not yet
if grep -q '^[[:space:]]*rm.*PACKAGER_SOURCEMAP_FILE' "$REACT_NATIVE_XCODE"; then
  echo "Patching React Native script to preserve sourcemap file..."
  sed -i '' 's/^[[:space:]]*rm.*PACKAGER_SOURCEMAP_FILE/#&/' "$REACT_NATIVE_XCODE"
  echo "Patched: commented out rm PACKAGER_SOURCEMAP_FILE line"
fi

# Execute React Native Xcode script and check exit code
set +x +e # disable printing commands and allow continuing on error
RN_XCODE_OUTPUT=$(/bin/sh -c "$REACT_NATIVE_XCODE" 2>&1)
RN_XCODE_EXIT_CODE=$?
if [ $RN_XCODE_EXIT_CODE -eq 0 ]; then
  echo "$RN_XCODE_OUTPUT" | awk '{print "output: react-native-xcode - " $0}'
else
  echo "error: react-native-xcode - $RN_XCODE_OUTPUT"
  exit $RN_XCODE_EXIT_CODE
fi
set -x -e # re-enable

# files wont exist if skip bundling
set +x +e
if [[ "$SKIP_BUNDLING" ]]; then
  echo "SKIP_BUNDLING enabled; skipping posthog-cli upload calls."
  exit 0;
fi
set -x -e

# Execute posthog cli clone
set +x +e
CLI_CLONE_OUTPUT=$(/bin/sh -c "$PH_CLI_PATH exp hermes clone --minified-map-path $SOURCEMAP_PACKAGER_FILE --composed-map-path $SOURCEMAP_FILE" 2>&1)
CLONE_EXIT_CODE=$?
if [ $CLONE_EXIT_CODE -eq 0 ]; then
  echo "$CLI_CLONE_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  echo "error: posthog-cli - $CLI_CLONE_OUTPUT"
  exit $CLONE_EXIT_CODE
fi
set -x -e

# Execute posthog cli upload
set +x +e
CLI_UPLOAD_OUTPUT=$(/bin/sh -c "$PH_CLI_PATH exp hermes upload --directory $DERIVED_FILE_DIR" 2>&1)
UPLOAD_EXIT_CODE=$?
if [ $UPLOAD_EXIT_CODE -eq 0 ]; then
  echo "$CLI_UPLOAD_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  echo "error: posthog-cli - $CLI_UPLOAD_OUTPUT"
  exit $UPLOAD_EXIT_CODE
fi
set -x -e


exit 0
