const { execFileSync } = require('node:child_process')
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const packageRoot = join(__dirname, '..')
const fixture = mkdtempSync(join(tmpdir(), 'posthog-evaluations-consumer-'))
try {
  const installed = join(fixture, 'node_modules', '@posthog', 'ai')
  mkdirSync(installed, { recursive: true })
  cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true })
  cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'))
  // No provider SDK, posthog-node, or other package is installed in this fixture.
  const smoke = `
        const client = new api.OfflineEvaluations({ projectId: 123, secretKey: 'test' });
        const item = new api.EvaluationItem({ input: false });
        const result = new api.EvaluationResult({ item, scorerVersionId: item.id, value: 0 });
        if (result.toJSON().value !== 0) throw new Error('Invalid declaration');
        client.close();
    `
  execFileSync(process.execPath, ['--eval', `const api = require('@posthog/ai/evaluations'); ${smoke}`], {
    cwd: fixture,
    stdio: 'inherit',
  })
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', `import * as api from '@posthog/ai/evaluations'; ${smoke}`],
    { cwd: fixture, stdio: 'inherit' }
  )
  const source = readFileSync(join(__dirname, 'evaluations', 'consumer-types.ts'), 'utf8')
  writeFileSync(join(fixture, 'consumer.mts'), source)
  writeFileSync(join(fixture, 'consumer.cts'), source)
  writeFileSync(
    join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        lib: ['es2022', 'dom'],
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ['consumer.mts', 'consumer.cts'],
    })
  )
  execFileSync(join(packageRoot, 'node_modules', '.bin', 'tsc'), ['--project', join(fixture, 'tsconfig.json')], {
    cwd: fixture,
    stdio: 'inherit',
  })
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
