import * as ts from 'typescript'

import type { SegmentAnalytics, SegmentPlugin, SegmentUser } from '../segment'

type SegmentId = string | null | undefined

type AnalyticsNextUser = {
    anonymousId(id?: SegmentId): SegmentId
    id(id?: SegmentId): SegmentId
}

type AnalyticsNextPlugin = {
    name: string
    type: 'before' | 'after' | 'destination' | 'enrichment' | 'utility'
}

type AnalyticsNextContext = {
    event: Record<string, unknown>
}

// Relevant public shape shared by @segment/analytics-next 1.8.0 through 1.84.1.
type AnalyticsNextSnippet = {
    user(): AnalyticsNextUser
    register(...plugins: AnalyticsNextPlugin[]): Promise<AnalyticsNextContext>
}

type AnalyticsNextBrowser = {
    user(): Promise<AnalyticsNextUser>
    register(...plugins: AnalyticsNextPlugin[]): Promise<AnalyticsNextContext>
}

// Preserve the narrower contract accepted by previous posthog-js versions.
type LegacySegmentAnalytics = {
    user(): {
        anonymousId(): string | undefined
        id(): string | undefined
    }
    register(integration: SegmentPlugin): Promise<void>
}

const acceptsSegmentAnalytics = (analytics: SegmentAnalytics): void => {
    void analytics
}

describe('SegmentAnalytics', () => {
    it('accepts current and legacy Segment SDK shapes', () => {
        acceptsSegmentAnalytics({} as AnalyticsNextSnippet)
        acceptsSegmentAnalytics({} as AnalyticsNextBrowser)
        acceptsSegmentAnalytics({} as LegacySegmentAnalytics)

        const legacyUser: SegmentUser = {
            anonymousId: () => undefined,
            id: () => undefined,
        }
        const legacyUserId: string | undefined = legacyUser.id()
        const getLegacyRegisterResult = (analytics: SegmentAnalytics): Promise<void> =>
            analytics.register({} as SegmentPlugin)

        expect(legacyUserId).toBeUndefined()
        expect(getLegacyRegisterResult).toEqual(expect.any(Function))

        const program = ts.createProgram([__filename], {
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: ts.ScriptTarget.ES2022,
            types: ['jest', 'node'],
        })
        const errors = ts
            .getPreEmitDiagnostics(program)
            .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

        expect(errors).toEqual([])
    })
})
