#!/bin/bash
set -eo pipefail

# Taken from https://expo.io/--/api/v2/versions
IPA_URL="https://dpq5q02fu5f55.cloudfront.net/Exponent-2.24.3.tar.gz"
TMP_PATH_IPA=/tmp/exponent-app.tar.gz
curl -o $TMP_PATH_IPA "$IPA_URL"
APP_PATH=e2e/bin/Exponent.app
mkdir -p $APP_PATH

# create apk (isn't stored tar'd)
# APK_PATH=bin/Exponent.apk
# curl -o $APK_PATH "$APK_URL"

# unzip tar.gz into APP_PATH
tar -C $APP_PATH -xzf $TMP_PATH_IPA