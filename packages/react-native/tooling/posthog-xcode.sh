# adapted from https://github.com/getsentry/sentry-react-native/blob/e76d0d388228437e82f235546de00f4e748fcbda/packages/core/scripts/sentry-xcode.sh

#!/bin/bash
# PostHog Bundle React Native code and images
# PWD=ios

# print commands before executing them and stop on first error
set -x -e

# WITH_ENVIRONMENT is executed by React Native

LOCAL_NODE_BINARY=${NODE_BINARY:-node}

# The project root by default is one level up from the ios directory
RN_PROJECT_ROOT="${PROJECT_DIR}/.."

REACT_NATIVE_XCODE_DEFAULT="../node_modules/react-native/scripts/react-native-xcode.sh"
REACT_NATIVE_XCODE="${1:-$REACT_NATIVE_XCODE_DEFAULT}"

# TODO: when to call (inject): --release -- exp hermes inject --project my-app --directory $DERIVED_FILE_DIR
# TODO: what should i set for --project?

# TODO: when to call (clone): --release -- exp hermes clone --directory $DERIVED_FILE_DIR

# [ -z "$SOURCEMAP_FILE" ] && export SOURCEMAP_FILE="$DERIVED_FILE_DIR/main.jsbundle.map"
# TODO: is the CLI clever enough to pick the right file? there will be a bunch of non related files
ARGS="--release -- exp hermes upload --directory $DERIVED_FILE_DIR"

# requires posthog-cli installed
# requires authentication (posthog-cli login) or:
# https://github.com/PostHog/posthog/tree/master/cli#env-based-authentication
REACT_NATIVE_XCODE_WITH_POSTHOG="posthog-cli $ARGS \"$REACT_NATIVE_XCODE\""

exitCode=0

# TODO: implement ALLOW_FAILURE CLI config to keep building if there are errors
# 'warning:' triggers a warning in Xcode, 'error:' triggers an error
set +x +e # disable printing commands otherwise we might print `error:` by accident and allow continuing on error
XCODE_COMMAND_OUTPUT=$(/bin/sh -c "\"$LOCAL_NODE_BINARY\" $REACT_NATIVE_XCODE_WITH_POSTHOG" 2>&1)
if [ $? -eq 0 ]; then
  echo "$XCODE_COMMAND_OUTPUT" | awk '{print "output: posthog-cli - " $0}'
else
  echo "error: posthog-cli - $XCODE_COMMAND_OUTPUT"
  exitCode=1
fi
set -x -e # re-enable

exit $exitCode
