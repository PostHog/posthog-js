#!/bin/bash
# Portions of this file are derived from getsentry/sentry-react-native
# Copyright (c) 2017 Sentry
# Licensed under the MIT License: https://github.com/getsentry/sentry-react-native/blob/main/LICENSE.md
# Bundle React Native code and images
# PWD=ios

# print commands before executing them and stop on first error
set -x -e

# Ensure common tool paths are available so posthog-cli can auto-detect git
# (Xcode runs build phases with a minimal PATH)
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.posthog:$PATH"

print_prefixed_output() {
  local prefix="$1"
  local output="$2"

  if [ -n "$output" ]; then
    echo "$output" | awk -v prefix="$prefix" '{print prefix $0}'
  fi
}

print_command_error() {
  local command_name="$1"
  local exit_code="$2"
  local output="$3"

  echo "error: ${command_name} failed with exit code ${exit_code}"
  print_prefixed_output "error: ${command_name} - " "$output"
}

# WITH_ENVIRONMENT is executed by React Native

POSTHOG_UPLOAD_ARGS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --posthog-skip-on-conflict)
      POSTHOG_UPLOAD_ARGS="$POSTHOG_UPLOAD_ARGS --skip-on-conflict"
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

REACT_NATIVE_XCODE_DEFAULT="../node_modules/react-native/scripts/react-native-xcode.sh"
# Accept $1 only when it actually points at a shell script; guard against the
# Expo plugin previously passing "/bin/sh" as $1 (issue #3682).
if [[ "${1:-}" == *.sh ]]; then
  REACT_NATIVE_XCODE="$1"
else
  REACT_NATIVE_XCODE="$REACT_NATIVE_XCODE_DEFAULT"
fi

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
  NPM_GLOBAL_PREFIX=$(npm prefix -g 2>/dev/null || true)
  if [ -n "$NPM_GLOBAL_PREFIX" ] && [ -f "$NPM_GLOBAL_PREFIX/bin/posthog-cli" ]; then
    PH_CLI_PATH="$NPM_GLOBAL_PREFIX/bin/posthog-cli"
  else
    # Check if installed as local dependency
    NPM_LOCAL_ROOT=$(npm root 2>/dev/null || true)
    if [ -n "$NPM_LOCAL_ROOT" ] && [ -f "$NPM_LOCAL_ROOT/.bin/posthog-cli" ]; then
      PH_CLI_PATH="$NPM_LOCAL_ROOT/.bin/posthog-cli"
    else
      # Fallback to searching common locations (PATH was already extended above)
      PH_CLI_PATH=$(command -v posthog-cli 2>/dev/null || true)
    fi
  fi
fi

if [ -z "$PH_CLI_PATH" ] || [ ! -x "$PH_CLI_PATH" ]; then
  echo "error: posthog-cli not found"
  exit 1
fi

MIN_POSTHOG_CLI_VERSION="0.7.12"
PH_CLI_VERSION=$("$PH_CLI_PATH" --version 2>/dev/null | awk '{print $NF}' | tr -d 'v')
if [ -n "$PH_CLI_VERSION" ]; then
  LOWEST=$(printf '%s\n%s\n' "$MIN_POSTHOG_CLI_VERSION" "$PH_CLI_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)
  if [ "$LOWEST" != "$MIN_POSTHOG_CLI_VERSION" ]; then
    echo "error: posthog-cli >= ${MIN_POSTHOG_CLI_VERSION} required (found ${PH_CLI_VERSION}). Upgrade: npm install -g @posthog/cli@latest"
    exit 1
  fi
fi

# mimics how the file is defined in node_modules/react-native/scripts/react-native-xcode.sh (PACKAGER_SOURCEMAP_FILE)
SOURCEMAP_PACKAGER_FILE="$CONFIGURATION_BUILD_DIR/$SOURCEMAP_NAME"

# Pass release info from Xcode build settings when available
CLI_RELEASE_ARGS=""
if [ -n "${PRODUCT_BUNDLE_IDENTIFIER}" ]; then
  CLI_RELEASE_ARGS="$CLI_RELEASE_ARGS --release-name $PRODUCT_BUNDLE_IDENTIFIER"
fi
if [ -n "${MARKETING_VERSION}" ]; then
  CLI_RELEASE_ARGS="$CLI_RELEASE_ARGS --release-version $MARKETING_VERSION"
fi
if [ -n "${CURRENT_PROJECT_VERSION}" ]; then
  CLI_RELEASE_ARGS="$CLI_RELEASE_ARGS --build $CURRENT_PROJECT_VERSION"
fi

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

# posthog-cli auto-detects git by walking UP from the --directory arg
# (the sourcemap location). For Xcode, that's ~/Library/Developer/Xcode/DerivedData/
# which is outside the project tree, so .git is never found.
#
# Workaround for local builds: populate GITHUB_* env vars from the local git
# remote so the CLI's GitHub Actions detection path picks them up. The CLI
# doesn't validate the host — it builds the remote URL as
# "{GITHUB_SERVER_URL}/{GITHUB_REPOSITORY}.git", so this works regardless of
# the user's actual git provider (GitHub, GitLab, Bitbucket, self-hosted, ...).
#
# We only do this when not already inside a CI environment the CLI recognizes
# natively (GitHub Actions, Vercel). Those runners inject the real variables
# themselves, and we don't want to overwrite them with locally-derived ones.
#
if [ -z "$GITHUB_SHA" ] && [ -z "$VERCEL" ]; then
  GIT_TOPLEVEL=$(git -C "${SRCROOT:-$(pwd)}" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$GIT_TOPLEVEL" ]; then
    GIT_REMOTE_URL=$(git -C "$GIT_TOPLEVEL" config --get remote.origin.url 2>/dev/null)
    if [ -n "$GIT_REMOTE_URL" ]; then
      # Parse host and "owner/repo" from either:
      #   git@host:owner/repo.git                    → host=host, repo=owner/repo
      #   https://host/owner/repo.git                → host=host, repo=owner/repo
      #   ssh://git@host:port/owner/repo             → host=host, repo=owner/repo
      #   git@gitlab.com:org/subgroup/repo.git       → host=gitlab.com, repo=org/subgroup/repo
      # Strip leading scheme + optional user@, then take everything up to the first : or /
      GIT_HOST=$(echo "$GIT_REMOTE_URL" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#[:/].*$##')
      # Strip scheme + user@host + separator, optional port, and .git suffix
      GIT_REPO_PATH=$(echo "$GIT_REMOTE_URL" | sed -E 's#^([a-z]+://)?[^:/]*[:/]##; s#^[0-9]+/##; s#\.git$##')
      if [ -n "$GIT_HOST" ] && [ -n "$GIT_REPO_PATH" ]; then
        GIT_BRANCH_NAME=$(git -C "$GIT_TOPLEVEL" rev-parse --abbrev-ref HEAD 2>/dev/null)
        # --abbrev-ref returns the literal string "HEAD" when the working copy
        # is in a detached-HEAD state (bisect, checking out a tag, CI checkouts
        # that resolved to a SHA). Fall back to the short SHA so the branch
        # field is meaningful rather than just "HEAD".
        if [ "$GIT_BRANCH_NAME" = "HEAD" ]; then
          GIT_BRANCH_NAME=$(git -C "$GIT_TOPLEVEL" rev-parse --short HEAD 2>/dev/null)
        fi
        export GITHUB_ACTIONS="true"
        export GITHUB_SHA=$(git -C "$GIT_TOPLEVEL" rev-parse HEAD 2>/dev/null)
        export GITHUB_REF_NAME="$GIT_BRANCH_NAME"
        export GITHUB_REPOSITORY="$GIT_REPO_PATH"
        export GITHUB_SERVER_URL="https://${GIT_HOST}"
      fi
    fi
  fi
fi

# Execute posthog cli clone
set +x +e
CLI_CLONE_OUTPUT=$(/bin/sh -c "$PH_CLI_PATH hermes clone --minified-map-path $SOURCEMAP_PACKAGER_FILE --composed-map-path $SOURCEMAP_FILE $CLI_RELEASE_ARGS" 2>&1)
CLONE_EXIT_CODE=$?
if [ $CLONE_EXIT_CODE -eq 0 ]; then
  echo "$CLI_CLONE_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  print_command_error "posthog-cli hermes clone" "$CLONE_EXIT_CODE" "$CLI_CLONE_OUTPUT"
  exit $CLONE_EXIT_CODE
fi
set -x -e

# Execute posthog cli upload
set +x +e
CLI_UPLOAD_OUTPUT=$(/bin/sh -c "$PH_CLI_PATH hermes upload --directory $DERIVED_FILE_DIR $CLI_RELEASE_ARGS $POSTHOG_UPLOAD_ARGS" 2>&1)
UPLOAD_EXIT_CODE=$?
if [ $UPLOAD_EXIT_CODE -eq 0 ]; then
  echo "$CLI_UPLOAD_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  print_command_error "posthog-cli hermes upload" "$UPLOAD_EXIT_CODE" "$CLI_UPLOAD_OUTPUT"
  exit $UPLOAD_EXIT_CODE
fi
set -x -e


exit 0
