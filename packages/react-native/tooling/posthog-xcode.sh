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

POSTHOG_SKIP_ON_CONFLICT_ENABLED="${POSTHOG_SKIP_ON_CONFLICT:-}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --posthog-skip-on-conflict)
      POSTHOG_SKIP_ON_CONFLICT_ENABLED=1
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

POSTHOG_UPLOAD_ARGS=()
if [ "$POSTHOG_SKIP_ON_CONFLICT_ENABLED" = "1" ] || [ "$POSTHOG_SKIP_ON_CONFLICT_ENABLED" = "true" ]; then
  POSTHOG_UPLOAD_ARGS+=(--skip-on-conflict)
fi

REACT_NATIVE_XCODE_DEFAULT="../node_modules/react-native/scripts/react-native-xcode.sh"
REACT_NATIVE_XCODE="$REACT_NATIVE_XCODE_DEFAULT"
# A config plugin may already wrap the React Native script. Keep the complete
# command for execution, but locate the RN script within it so its intermediate
# Hermes source map can be preserved before any wrapper runs.
for command_arg in "$@"; do
  case "$command_arg" in
    *packager/react-native-xcode.sh|*scripts/react-native-xcode.sh)
      REACT_NATIVE_XCODE="$command_arg"
      break
      ;;
  esac
done

# Some outer wrappers only forward posthog-xcode.sh, without the original RN
# script argument. Resolve hoisted installs when the standard relative path is
# unavailable instead of assuming node_modules lives directly above ios/.
if [ "$#" -eq 0 ] && [ ! -f "$REACT_NATIVE_XCODE_DEFAULT" ]; then
  REACT_NATIVE_PACKAGE_JSON=$("${NODE_BINARY:-node}" --print "require.resolve('react-native/package.json')" 2>/dev/null || true)
  RESOLVED_REACT_NATIVE_XCODE="$(dirname "$REACT_NATIVE_PACKAGE_JSON")/scripts/react-native-xcode.sh"
  if [ -n "$REACT_NATIVE_PACKAGE_JSON" ] && [ -f "$RESOLVED_REACT_NATIVE_XCODE" ]; then
    REACT_NATIVE_XCODE_DEFAULT="$RESOLVED_REACT_NATIVE_XCODE"
    REACT_NATIVE_XCODE="$RESOLVED_REACT_NATIVE_XCODE"
  fi
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

INFO_PLIST_MIN_POSTHOG_CLI_VERSION="0.15.1"
PH_CLI_VERSION=$("$PH_CLI_PATH" --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -n1 || true)
POSTHOG_CLI_SUPPORTS_INFO_PLIST=0
if [ -n "$PH_CLI_VERSION" ]; then
  LOWEST_POSTHOG_CLI_VERSION=$(printf '%s\n%s\n' "$INFO_PLIST_MIN_POSTHOG_CLI_VERSION" "$PH_CLI_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)
  if [ "$LOWEST_POSTHOG_CLI_VERSION" = "$INFO_PLIST_MIN_POSTHOG_CLI_VERSION" ]; then
    POSTHOG_CLI_SUPPORTS_INFO_PLIST=1
  fi
fi

# mimics how the file is defined in node_modules/react-native/scripts/react-native-xcode.sh (PACKAGER_SOURCEMAP_FILE)
SOURCEMAP_PACKAGER_FILE="$CONFIGURATION_BUILD_DIR/$SOURCEMAP_NAME"

# The native runtime reports these values from the built Info.plist. Prefer the source Info.plist so
# source maps use the same release when Expo EAS remote versioning does not update Xcode's defaults.
resolve_posthog_ios_release_info() {
  resolve_posthog_build_setting_references() {
    local value="$1"
    local token
    local name
    local replacement
    local prefix
    local suffix

    while [[ "$value" =~ (\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}) ]]; do
      token=${BASH_REMATCH[1]}
      name=${BASH_REMATCH[2]:-${BASH_REMATCH[3]}}
      replacement=$(printenv "$name" 2>/dev/null) || return
      prefix=${value%%"$token"*}
      suffix=${value#*"$token"}
      value="${prefix}${replacement}${suffix}"
    done
    printf '%s' "$value"
  }

  POSTHOG_RELEASE_VERSION="${MARKETING_VERSION:-}"
  POSTHOG_BUILD_VERSION="${CURRENT_PROJECT_VERSION:-}"
  POSTHOG_PLIST_BUDDY="${POSTHOG_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
  POSTHOG_INFO_PLIST="${INFOPLIST_FILE:-}"
  POSTHOG_USE_INFO_PLIST=0

  # Bare C preprocessor macros cannot be expanded safely here, and the product plist may belong to
  # a previous build. Preserve the existing Xcode-setting fallback for preprocessed plists.
  if [ "${INFOPLIST_PREPROCESS:-}" = "YES" ] || [ -z "$POSTHOG_INFO_PLIST" ]; then
    return 0
  fi
  case "$POSTHOG_INFO_PLIST" in
    /*) ;;
    *) POSTHOG_INFO_PLIST="${SRCROOT}/${POSTHOG_INFO_PLIST}" ;;
  esac
  if [ ! -f "$POSTHOG_INFO_PLIST" ]; then
    return 0
  fi
  if [ "$POSTHOG_CLI_SUPPORTS_INFO_PLIST" = "1" ]; then
    POSTHOG_USE_INFO_PLIST=1
    return 0
  fi
  if [ ! -x "$POSTHOG_PLIST_BUDDY" ]; then
    return 0
  fi

  POSTHOG_PLIST_RELEASE_VERSION=$("$POSTHOG_PLIST_BUDDY" -c "Print :CFBundleShortVersionString" "$POSTHOG_INFO_PLIST" 2>/dev/null || true)
  POSTHOG_PLIST_BUILD_VERSION=$("$POSTHOG_PLIST_BUDDY" -c "Print :CFBundleVersion" "$POSTHOG_INFO_PLIST" 2>/dev/null || true)
  POSTHOG_PLIST_RELEASE_VERSION=$(resolve_posthog_build_setting_references "$POSTHOG_PLIST_RELEASE_VERSION" || true)
  POSTHOG_PLIST_BUILD_VERSION=$(resolve_posthog_build_setting_references "$POSTHOG_PLIST_BUILD_VERSION" || true)

  case "$POSTHOG_PLIST_RELEASE_VERSION" in
    ""|*"\$("*|*"\${"*) ;;
    *) POSTHOG_RELEASE_VERSION="$POSTHOG_PLIST_RELEASE_VERSION" ;;
  esac
  case "$POSTHOG_PLIST_BUILD_VERSION" in
    ""|*"\$("*|*"\${"*) ;;
    *) POSTHOG_BUILD_VERSION="$POSTHOG_PLIST_BUILD_VERSION" ;;
  esac
}

resolve_posthog_ios_release_info

CLI_RELEASE_ARGS=()
if [ "$POSTHOG_USE_INFO_PLIST" = "1" ]; then
  CLI_RELEASE_ARGS+=(--info-plist "$POSTHOG_INFO_PLIST")
else
  if [ -n "${PRODUCT_BUNDLE_IDENTIFIER}" ]; then
    CLI_RELEASE_ARGS+=(--release-name "$PRODUCT_BUNDLE_IDENTIFIER")
  fi
  if [ -n "${POSTHOG_RELEASE_VERSION}" ]; then
    CLI_RELEASE_ARGS+=(--release-version "$POSTHOG_RELEASE_VERSION")
  fi
  if [ -n "${POSTHOG_BUILD_VERSION}" ]; then
    CLI_RELEASE_ARGS+=(--build "$POSTHOG_BUILD_VERSION")
  fi
fi

# RN deletes the PACKAGER_SOURCEMAP_FILE file after execution but we need it
# lets patch the script to comment out this part if not yet
if grep -q '^[[:space:]]*rm.*PACKAGER_SOURCEMAP_FILE' "$REACT_NATIVE_XCODE"; then
  echo "Patching React Native script to preserve sourcemap file..."
  if sed --version >/dev/null 2>&1; then
    sed -i 's/^[[:space:]]*rm.*PACKAGER_SOURCEMAP_FILE/#&/' "$REACT_NATIVE_XCODE"
  else
    sed -i '' 's/^[[:space:]]*rm.*PACKAGER_SOURCEMAP_FILE/#&/' "$REACT_NATIVE_XCODE"
  fi
  echo "Patched: commented out rm PACKAGER_SOURCEMAP_FILE line"
fi

# Execute the complete bundle command so other source-map wrappers keep their
# script path and arguments. Fall back to the standard RN script when an outer
# wrapper invokes posthog-xcode.sh without forwarding its remaining arguments.
set +x +e # disable printing commands and allow continuing on error
if [ "$#" -gt 0 ]; then
  RN_XCODE_OUTPUT=$("$@" 2>&1)
else
  RN_XCODE_OUTPUT=$(/bin/sh "$REACT_NATIVE_XCODE_DEFAULT" 2>&1)
fi
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
CLI_CLONE_OUTPUT=$("$PH_CLI_PATH" hermes clone --minified-map-path "$SOURCEMAP_PACKAGER_FILE" --composed-map-path "$SOURCEMAP_FILE" "${CLI_RELEASE_ARGS[@]}" 2>&1)
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
CLI_UPLOAD_OUTPUT=$("$PH_CLI_PATH" hermes upload --directory "$DERIVED_FILE_DIR" "${CLI_RELEASE_ARGS[@]}" "${POSTHOG_UPLOAD_ARGS[@]}" 2>&1)
UPLOAD_EXIT_CODE=$?
if [ $UPLOAD_EXIT_CODE -eq 0 ]; then
  echo "$CLI_UPLOAD_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  print_command_error "posthog-cli hermes upload" "$UPLOAD_EXIT_CODE" "$CLI_UPLOAD_OUTPUT"
  exit $UPLOAD_EXIT_CODE
fi
set -x -e


exit 0
