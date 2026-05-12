/**
 * @jest-environment node
 *
 * Smoke tests for the per-runtime barrels resolved when running outside
 * a browser bundle: the `default` (Node server) and `edge`/`edge-light`/
 * `worker` (Edge runtime) exports conditions, plus `react-server`. The
 * default barrels are the superset; the edge barrels deliberately omit
 * Node-server-only symbols so that bundles targeting the Edge runtime
 * don't transitively pull in `posthog-node`.
 */

jest.mock('server-only', () => ({}))
jest.mock('next/router.js', () => ({ useRouter: jest.fn() }))
jest.mock('next/navigation.js', () => ({
    usePathname: jest.fn(),
    useSearchParams: jest.fn(),
}))
jest.mock('next/headers.js', () => ({
    cookies: jest.fn(),
    headers: jest.fn(),
}))
jest.mock('next/server.js', () => ({
    NextResponse: { next: jest.fn(), rewrite: jest.fn() },
}))
jest.mock('@posthog/react', () => ({
    PostHogContext: { Provider: ({ children }: { children: unknown }) => children },
    usePostHog: jest.fn(),
    useFeatureFlagResult: jest.fn(),
    useActiveFeatureFlags: jest.fn(),
    PostHogFeature: jest.fn(() => null),
}))
jest.mock('posthog-js', () => ({ __esModule: true, default: { __loaded: false, init: jest.fn() } }))
jest.mock('posthog-node', () => ({ PostHog: jest.fn() }))

import * as pagesNode from '../src/pages'
import * as pagesEdge from '../src/pages.edge'
import * as indexNode from '../src/index'
import * as indexEdge from '../src/index.edge'
import * as indexReactServer from '../src/index.react-server'

const asRecord = (mod: unknown) => mod as Record<string, unknown>

describe('server barrels (default / edge / react-server exports conditions)', () => {
    describe("@posthog/next/pages → 'default' / 'react-server' → pages", () => {
        it.each([
            ['PostHogProvider', 'function'],
            ['PostHogPageView', 'function'],
            ['getServerSidePostHog', 'function'],
            ['getPostHog', 'function'],
            ['postHogMiddleware', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(pagesNode)[name]).toBe(expectedType)
        })
    })

    describe("@posthog/next/pages → 'edge' → pages.edge", () => {
        it.each([
            ['PostHogProvider', 'function'],
            ['postHogMiddleware', 'function'],
            ['PostHogPageView', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(pagesEdge)[name]).toBe(expectedType)
        })

        it.each(['getServerSidePostHog', 'getPostHog'])('omits %s', (name) => {
            expect(asRecord(pagesEdge)[name]).toBeUndefined()
        })
    })

    describe("@posthog/next → 'default' → index", () => {
        it.each([
            ['PostHogProvider', 'function'],
            ['PostHogPageView', 'function'],
            ['getPostHog', 'function'],
            ['postHogMiddleware', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(indexNode)[name]).toBe(expectedType)
        })
    })

    describe("@posthog/next → 'edge' → index.edge", () => {
        it.each([
            ['postHogMiddleware', 'function'],
            ['PostHogPageView', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(indexEdge)[name]).toBe(expectedType)
        })

        it.each(['PostHogProvider', 'getPostHog'])('omits %s', (name) => {
            expect(asRecord(indexEdge)[name]).toBeUndefined()
        })
    })

    describe("@posthog/next → 'react-server' → index.react-server", () => {
        it.each([
            ['PostHogProvider', 'function'],
            ['PostHogPageView', 'function'],
            ['usePostHog', 'function'],
            ['useFeatureFlag', 'function'],
            ['useActiveFeatureFlags', 'function'],
            ['PostHogFeature', 'function'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(indexReactServer)[name]).toBe(expectedType)
        })
    })
})
