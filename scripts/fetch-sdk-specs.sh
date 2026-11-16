#!/bin/sh
# Fetches PostHog/sdk-specs at the commit the Markdown SDK references are built against, into $1.
# CI and the release read this one pin. Bump it in a PR that also regenerates the references.
set -eu
SDK_SPECS_SHA=c895e1b52d5e96a5ee0b0a1051bedc89333ddff4
git init -q "$1"
git -C "$1" fetch -q --depth 1 https://github.com/PostHog/sdk-specs "$SDK_SPECS_SHA"
git -C "$1" checkout -q FETCH_HEAD
