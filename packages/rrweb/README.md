# PostHog's copy of RRWeb

this is open because we believe in open source,
and we want to be able to contribute back to upstream rrweb and refer back to this when we do

# but please don't use it yourself

all changes will be only focussed on posthog and we won't make any effort to support anybody else using this

if you say "i started using this, you changed it, and now my thing broke"
we will say "we told you not to use it"

The upstream rrweb is here https://github.com/rrweb-io/rrweb

## Hello internal PostHog folk

We build this and publish it to NPM so that we can use it in posthog-js

If you want to contribute a change back to upstream rrweb
then you need to open a person fork and contribute from there

### How to use it...

1. `pnpm install` to, erm, install
2. `pnpm build:all` to get a stable base built
3. `pnpm dev` to get auto building of changed things while making changes
4. `pnpm test` to run the tests
5. `pnpm test:update` to update snapshots if necessary

### Releasing

Add a `bump patch`, `bump minor`, or `bump major` label to your PR **before merging**. The version bump and npm publish are automated on merge.

# FAQ

- does this mean you're planning on stopping using RRWEB?
  - no
- can I use this repo?
  - unless you are contributing changes for posthog, no
- should I sponsor rrweb?
  - absolutely, yes. we do, you should too, it's great
