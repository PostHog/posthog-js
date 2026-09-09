import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('package license', () => {
  it('ships the owning MIT license and third-party notices in the tarball', () => {
    const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
    const destination = mkdtempSync(join(tmpdir(), 'posthog-core-license-'))
    const tarball = join(destination, 'core.tgz')

    try {
      execFileSync('pnpm', ['pack', '--out', tarball], { cwd: packageRoot, timeout: 30_000 })
      const license = execFileSync('tar', ['-xOf', tarball, 'package/LICENSE'], { encoding: 'utf8' })
      const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))

      expect(manifest.license).toBe('MIT')
      expect(license).toMatch(/^Copyright \(c\) 2022 PostHog \(part of Hiberly Inc\)/)
      expect(license).toBe(readFileSync(join(packageRoot, 'LICENSE'), 'utf8'))
      expect(license).toContain('Permission is hereby granted, free of charge')
      expect(license).toContain('Copyright (c) 2012 Functional Software, Inc. dba Sentry')
      expect(license).toContain(
        'Copyright (c) 2013 Onur Can Cakmak onur.cakmak@gmail.com and all TraceKit contributors.'
      )
      expect(license).toContain('Copyright 2021-2023 LiosK')
      expect(license).toContain('END OF TERMS AND CONDITIONS')
    } finally {
      rmSync(destination, { recursive: true, force: true })
    }
  }, 60_000)
})
