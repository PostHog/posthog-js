# PostHog JS Custom ESLint rules 

This package contains custom ESLint rules for PostHog's JS codebase.

For example, we have a number of functions that check types like `_isNull` or `isBoolean`. 
In most projects these don't help very much but since posthog-js is bundled and included in many different projects,
we want to ensure the bundle size is as small as possible. Moving to these functions reduced bundle by 1%, so we
use a set of custom linters to ensure we don't accidentally add new code that does not use these helpers.
