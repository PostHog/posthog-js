import { resolve } from 'node:path'
import { typeContractDiagnostics } from './helpers/type-contract'

it('accepts either release identity form but not mixed or incomplete identities', () => {
    const source = `
        import type { ErrorTrackingOptions } from '../types'
        const byId: ErrorTrackingOptions = { release: { id: 'release-id' } }
        const byVersion: ErrorTrackingOptions = { release: { name: 'example-web', version: 'abc123' } }
        const byBuild: ErrorTrackingOptions = { release: { name: 'example-web', version: 'abc123', build: '42' } }
        // @ts-expect-error A release cannot combine a PostHog id with a name and version.
        const mixed: ErrorTrackingOptions = { release: { id: 'release-id', name: 'example-web', version: 'abc123' } }
        // @ts-expect-error A named release requires a version.
        const incomplete: ErrorTrackingOptions = { release: { name: 'example-web' } }
        // @ts-expect-error Build metadata belongs to the name/version form.
        const idWithBuild: ErrorTrackingOptions = { release: { id: 'release-id', build: '42' } }
    `
    expect(typeContractDiagnostics(resolve(__dirname, 'release-config.fixture.ts'), source)).toEqual([])
})
