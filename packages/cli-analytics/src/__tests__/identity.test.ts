import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveIdentity } from '../extensions/identity'

describe('identity', () => {
    let configHome: string
    let priorXdg: string | undefined

    beforeEach(() => {
        configHome = mkdtempSync(join(tmpdir(), 'ph-cli-identity-'))
        priorXdg = process.env.XDG_CONFIG_HOME
        process.env.XDG_CONFIG_HOME = configHome
    })

    afterEach(() => {
        if (priorXdg === undefined) {
            delete process.env.XDG_CONFIG_HOME
        } else {
            process.env.XDG_CONFIG_HOME = priorXdg
        }
        rmSync(configHome, { recursive: true, force: true })
    })

    it('mints an anonymous id with the anon_ prefix on first run', () => {
        const { anonymousId } = resolveIdentity('acme')
        expect(anonymousId).toMatch(/^anon_/)
    })

    it('persists and reuses the same id across runs', () => {
        const first = resolveIdentity('acme').anonymousId
        const second = resolveIdentity('acme').anonymousId
        expect(second).toBe(first)
    })

    it('namespaces ids per CLI name', () => {
        const acme = resolveIdentity('acme').anonymousId
        const other = resolveIdentity('other-cli').anonymousId
        expect(other).not.toBe(acme)
    })

    it('hashes a project id deterministically and irreversibly', () => {
        const store = resolveIdentity('acme')
        const hash = store.hashProject('git@github.com:acme/repo.git')
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        expect(hash).not.toContain('acme')
        expect(store.hashProject('git@github.com:acme/repo.git')).toBe(hash)
        expect(store.hashProject('git@github.com:acme/other.git')).not.toBe(hash)
    })

    it('uses different salts per CLI so the same project hashes differently', () => {
        const a = resolveIdentity('acme').hashProject('proj')
        const b = resolveIdentity('beta').hashProject('proj')
        expect(a).not.toBe(b)
    })

    it('falls back to an ephemeral id when persistence is impossible', () => {
        // Use a regular file as the config dir so mkdir/write throws (ENOTDIR).
        const blocker = join(configHome, 'blocker')
        writeFileSync(blocker, 'not a directory')
        process.env.XDG_CONFIG_HOME = blocker
        const { anonymousId } = resolveIdentity('acme')
        expect(anonymousId).toMatch(/^anon_/)
    })
})
