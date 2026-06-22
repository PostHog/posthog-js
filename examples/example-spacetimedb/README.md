# Example app — SpacetimeDB × PostHog

A [SpacetimeDB](https://spacetimedb.com) React app instrumented with PostHog across the stack, so you
can see the same activity from the client and the backend:

1. **Frontend** — `posthog-js` (via `@posthog/react`) captures pageviews and the `add_person_clicked` event.
2. **Backend sidecar** — a Node process (`posthog-node`) subscribes to the database and captures
   `person_added` whenever the `add` reducer inserts a row. **This is the recommended way to do
   backend instrumentation with SpacetimeDB.**
3. **In-module** — an _unstable_ SpacetimeDB procedure posts `server_side_ping` to PostHog directly
   over `ctx.http`, from inside the database.
4. **Local feature-flag evaluation** — the same sidecar evaluates flags _locally_ with a personal API
   key and writes the results back into a table the client subscribes to (see below).

## Why a sidecar?

SpacetimeDB reducers are **deterministic and sandboxed** — no filesystem, timers, randomness, or
network. So you can't run `posthog-node` inside a reducer the way the [Convex
example](../example-convex) runs it inside an action. The idiomatic answer is a **trusted sidecar**:
a server-side client that subscribes to tables, listens to row/reducer events, and emits PostHog
events. It uses stable APIs and is decoupled from request latency.

The in-module procedure (layer 3) is the exception — _procedures_ may perform side effects including
HTTP, so they can call PostHog inline. They're marked unstable and you hand-roll the capture payload,
so prefer the sidecar unless you specifically need capture inside a transaction.

## Feature flags: evaluate in the backend, read through the database

Local flag evaluation needs a personal API key and the flag definitions in memory — that belongs in a
trusted backend, not the module or the browser. So the sidecar owns it, and results flow back to
clients the SpacetimeDB way — through a subscribed table:

```
"Evaluate my flags"
  → requestFlagEval()             — reducer inserts ctx.sender into flag_request (event table)
  → sidecar onInsert              — posthog.getAllFlags(), local eval with the personal key
  → setFeatureFlags()             — reducer upserts the feature_flag table
  → client useTable(feature_flag) — renders the flags reactively
```

`flag_request` is an _event table_ (rows are never stored — they only fire `onInsert`), making it a
clean request channel. The personal key lives only in the sidecar's environment. Change a flag in
PostHog and click again to see the new value flow through.

Three capture paths, all keyed on the same SpacetimeDB identity so they stitch to one person:

```
add_person_clicked  (posthog-js, browser)       ─┐
person_added        (posthog-node, sidecar)     ─┼─▶  PostHog
server_side_ping    (procedure, ctx.http)       ─┘
```

## Prerequisites

- [SpacetimeDB CLI](https://spacetimedb.com/install) (`spacetime`)
- Node.js 18+

## Setup

From the **repository root**, build the local PostHog tarballs this example installs:

```sh
pnpm install
pnpm package
```

Then, in this directory:

```sh
cd examples/example-spacetimedb
pnpm install
cp .env.example .env.local   # then set your PostHog project API key
```

Set `VITE_POSTHOG_PROJECT_TOKEN` / `POSTHOG_PROJECT_TOKEN` to your project key (Project settings →
API keys), and — for layer 3 — replace `POSTHOG_PROJECT_TOKEN` at the top of
`spacetimedb/src/index.ts` with the same key.
For local flag evaluation (layer 4), set `POSTHOG_PERSONAL_API_KEY` to a personal key (`phx_…`); without
it the sidecar still works but evaluates flags remotely instead of locally.

## Run

Four terminals (or background the first two):

```sh
# 1. Local SpacetimeDB server
spacetime start

# 2. Publish the module + (re)generate client bindings
pnpm module:publish
pnpm module:generate

# 3. Backend instrumentation sidecar
pnpm sidecar

# 4. Frontend
pnpm dev
```

Open <http://localhost:5173>.

- **Add a person** → `add_person_clicked` (posthog-js) and `person_added` (sidecar) land in PostHog.
- **Send server-side event** → `server_side_ping` (in-module procedure) lands in PostHog.
- **Evaluate my flags** → the sidecar evaluates flags locally and the values render in the page.

Verify them in your project's Activity feed. You can also drive the module from the CLI:

```sh
spacetime call posthog-spacetimedb add Alice   # triggers the sidecar's person_added
spacetime sql  posthog-spacetimedb "SELECT * FROM person"
spacetime logs posthog-spacetimedb
```

## Layout

| Path                       | What it is                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `spacetimedb/src/index.ts` | The module: tables (`person`, `feature_flag`, `flag_request`), reducers, `captureEvent` procedure |
| `instrumentation/index.ts` | Backend sidecar — captures events and evaluates flags locally with `posthog-node`                 |
| `src/`                     | React client — `posthog-js` instrumentation + UI to trigger reducers/procedures                   |
| `src/module_bindings/`     | Generated client bindings (`pnpm module:generate`)                                                |
