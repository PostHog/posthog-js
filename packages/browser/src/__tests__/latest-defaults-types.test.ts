import { resolve } from 'node:path'
import { typeContractDiagnostics } from './helpers/type-contract'

it('accepts latest defaults without allowing arbitrary strings', () => {
    const fixture = resolve(__dirname, 'latest-defaults.fixture.ts')
    const source = `
        import type { ConfigDefaults, PostHogConfig } from '../../../types/src'

        const latest: ConfigDefaults = 'latest'
        const config: Pick<PostHogConfig, 'defaults'> = { defaults: latest }
        const pinned: ConfigDefaults = '2026-08-30'
        const legacy: ConfigDefaults = 'unset'
        // @ts-expect-error Only supported defaults values are accepted.
        const invalid: ConfigDefaults = 'newest'
    `

    expect(typeContractDiagnostics(fixture, source)).toEqual([])
})
