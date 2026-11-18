import assert from 'node:assert/strict'
import { argv, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, posix, relative } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { analyzeMetafile, build } from 'esbuild'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const COMPLIANT_BASELINE_PENDING = 'Set binding budgets after P0 compliance and the optimization pass.'

// Never allowed in any @posthog/browser graph.
const forbiddenInputs = [
    /(^|\/)packages\/browser\/(src|dist)\//,
    /(^|\/)\.\.\/browser\/(src|dist)\//,
    /(^|\/)node_modules\/(posthog-js|core-js)\//,
]
// Third-party libraries that only lazily loaded chunks may contain, never an initial graph.
const lazyLibraryInputs = [/(^|\/)node_modules\/(web-vitals|fflate|rrweb)\//, /(^|\/)(packages\/rrweb|\.\.\/rrweb)\//]
// Heavy dependencies that only optional product chunks may load.
const coreInput = /(^|\/)(packages\/core|\.\.\/core|node_modules\/@posthog\/core)\//
const surveyUiInput = /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:preact|dompurify)\//
const surveyRenderingInput = /(^|\/)(surveys-renderer|survey-styles)\.(m?js|ts)$/

// Optional products.
const flagsInput = /(^|\/)(feature-flags|flags)\.(m?js|ts)$/
const autocaptureInput = /(^|\/)(autocapture|rageclick|autocapture-utils)\.(m?js|ts)$/
const logsInput = /(^|\/)(logs|console-logs|logs-config|logs-utils)\.(m?js|ts)$/
const surveysInput =
    /(^|\/)(surveys(?:-extension|-renderer|-storage)?|automatic-surveys|survey-event-receiver(?:-base)?|survey-action-matcher)\.(m?js|tsx?)$/
const webVitalsInput = /(^|\/)(products\/web-vitals\/[^/]+|web-vitals)\.(m?js|ts)$/
const tracingHeadersInput = /(^|\/)(products\/tracing-headers\/tracing-headers|utils\/tracing-headers)\.(m?js|ts)$/
const errorTrackingInput = /(^|\/)(products\/error-tracking\/[^/]+|error-tracking|exception-autocapture)\.(m?js|ts)$/
const toolbarInput = /(^|\/)(products\/toolbar\/(toolbar|toolbar-extension)|dist\/toolbar)\.(m?js|ts)$/
const conversationsInput =
    /(^|\/)(products\/conversations\/(conversations|conversations-extension)\.(m?js|ts)|dist\/conversations(-renderer)?[/.])/
const sessionRecordingInput =
    /(^|\/)(products\/session-recording\/(session-recording|recorder|snapshot-delivery|replay-trigger-host)|dist\/replay\/[^/]+)\.(m?js|ts)$/
const productInputs = [
    flagsInput,
    autocaptureInput,
    logsInput,
    surveysInput,
    webVitalsInput,
    tracingHeadersInput,
    errorTrackingInput,
    toolbarInput,
    conversationsInput,
    sessionRecordingInput,
]

// Client modules selected by entrypoint or explicit import.
const analyticsCoreInput = /(^|\/)products\/analytics\/analytics-core\.(m?js|ts)$/
const durableDeliveryInputs = [
    /(^|\/)analytics-delivery\.(m?js|ts)$/,
    /(^|\/)delivery\/lane\.(m?js|ts)$/,
    /(^|\/)capture-v1\.(m?js|ts)$/,
]
const rootCompositionInput = /(^|\/)root-composition\.(m?js|ts)$/
const cookiePersistenceInput = /(^|\/)persistence\/cookie\.(m?js|ts)$/

const buildOptions = {
    absWorkingDir: packageRoot,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    define: {
        __POSTHOG_BROWSER_VERSION__: JSON.stringify('0.0.0'),
        __BROWSER_COMMON_VERSION__: JSON.stringify('0.1.0'),
    },
}

const sizes = (outputs) => ({
    minified: outputs.reduce((sum, output) => sum + output.byteLength, 0),
    gzip: outputs.reduce((sum, output) => sum + gzipSync(output, { level: 9 }).byteLength, 0),
    brotli: outputs.reduce(
        (sum, output) =>
            sum +
            brotliCompressSync(output, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
            }).byteLength,
        0
    ),
})

const attribution = (result, outputKeys) => {
    const bytes = new Map()
    for (const key of outputKeys) {
        for (const [input, details] of Object.entries(result.metafile.outputs[key].inputs)) {
            bytes.set(input, (bytes.get(input) ?? 0) + details.bytesInOutput)
        }
    }
    return [...bytes].map(([input, value]) => ({ input, bytes: value })).sort((a, b) => b.bytes - a.bytes)
}

const inputsOf = (result, outputKeys) => [
    ...new Set(outputKeys.flatMap((key) => Object.keys(result.metafile.outputs[key].inputs))),
]

/** Asserts a graph's boundary: every `required` pattern matches an input and no `forbidden` pattern does. */
const assertBoundary = (name, inputs, { required = [], forbidden = [] }) => {
    for (const pattern of required) {
        assert(
            inputs.some((input) => pattern.test(input)),
            `The ${name} bundle must include ${pattern}`
        )
    }
    const found = inputs.filter((input) => forbidden.some((pattern) => pattern.test(input)))
    if (found.length > 0) throw new Error(`The ${name} bundle includes forbidden modules:\n${found.join('\n')}`)
}

// Initial graphs of /core and the root entry hold the client only: no optional product or heavy dependency.
const clientOnly = [...productInputs, cookiePersistenceInput, coreInput, surveyUiInput, surveyRenderingInput]
const coreBoundary = {
    required: [analyticsCoreInput, ...durableDeliveryInputs],
    forbidden: [...clientOnly, rootCompositionInput],
}
const rootInitialBoundary = {
    required: [analyticsCoreInput, ...durableDeliveryInputs, rootCompositionInput],
    forbidden: clientOnly,
}

const report = async (
    name,
    result,
    outputs,
    outputKeys,
    { allowProducts = false, allowSurveyUi = false, allowLazyLibraries = false } = {}
) => {
    const measured = sizes(outputs)
    const inputs = inputsOf(result, outputKeys)
    const forbidden = inputs.filter(
        (input) =>
            forbiddenInputs.some((pattern) => pattern.test(input)) ||
            (!allowLazyLibraries && lazyLibraryInputs.some((pattern) => pattern.test(input))) ||
            (!allowProducts && (coreInput.test(input) || productInputs.some((pattern) => pattern.test(input)))) ||
            (!allowSurveyUi && (surveyUiInput.test(input) || surveyRenderingInput.test(input)))
    )

    stdout.write(
        `@posthog/browser ${name}: ${measured.minified} B minified, ${measured.gzip} B gzip, ${measured.brotli} B brotli\n`
    )
    stdout.write('Module attribution (minified bytes):\n')
    for (const { input, bytes } of attribution(result, outputKeys)) {
        stdout.write(`${String(bytes).padStart(6)} B  ${input}\n`)
    }
    if (argv.includes('--analyze')) {
        stdout.write(`\n${await analyzeMetafile(result.metafile, { color: stdout.isTTY, verbose: true })}`)
    }
    if (forbidden.length > 0) {
        throw new Error(`The ${name} bundle includes forbidden modules:\n${forbidden.join('\n')}`)
    }
}

const measureStatic = async (name, fixture, boundary, options) => {
    const result = await build({ ...buildOptions, entryPoints: [fixture] })
    const output = result.outputFiles[0]?.contents
    if (!output) throw new Error(`The ${name} bundle-size fixture did not produce JavaScript`)
    const inputs = Object.keys(result.metafile.inputs)
    if (boundary) assertBoundary(name, inputs, boundary)
    await report(name, result, [output], Object.keys(result.metafile.outputs), options)
    return inputs
}

const buildSplit = async (fixture) => {
    const result = await build({ ...buildOptions, entryPoints: [fixture], splitting: true, outdir: 'bundle-output' })
    const outputFiles = new Map(
        result.outputFiles.map((file) => [relative(packageRoot, file.path).replaceAll('\\', '/'), file.contents])
    )
    const outputs = result.metafile.outputs
    const entry = Object.entries(outputs).find(([, details]) => details.entryPoint?.endsWith(fixture))?.[0]
    if (!entry) throw new Error(`The ${fixture} bundle-size fixture did not produce an entry chunk`)
    const resolveImport = (from, imported) =>
        outputs[imported.path] ? imported.path : posix.normalize(posix.join(dirname(from), imported.path))
    const staticClosure = (start) => {
        const closure = new Set([start])
        const pending = [start]
        while (pending.length > 0) {
            const output = pending.pop()
            for (const imported of outputs[output].imports) {
                if (imported.external || imported.kind === 'dynamic-import') continue
                const key = resolveImport(output, imported)
                if (!closure.has(key)) {
                    closure.add(key)
                    pending.push(key)
                }
            }
        }
        return closure
    }
    const dynamicEntryPoints = (keys) =>
        keys.flatMap((key) =>
            outputs[key].imports
                .filter((imported) => !imported.external && imported.kind === 'dynamic-import')
                .map((imported) => outputs[resolveImport(key, imported)]?.entryPoint ?? '')
        )
    const contents = (keys) =>
        keys.map((key) => {
            const output = outputFiles.get(key)
            if (!output) throw new Error(`Missing generated bundle output ${key}`)
            return output
        })
    return { result, outputs, initialKeys: [...staticClosure(entry)], staticClosure, dynamicEntryPoints, contents }
}

/** Survey orchestration must keep its renderer, Preact, DOMPurify and CSS behind a further dynamic import. */
const assertSurveyOrchestration = (split) => {
    const orchestrations = Object.entries(split.outputs).filter(([, details]) =>
        /\/(?:automatic-)?surveys\.mjs$/.test(details.entryPoint ?? '')
    )
    assert(orchestrations.length > 0, 'The bundle must contain a surveys orchestration chunk')
    for (const [orchestration] of orchestrations) {
        assertBoundary('surveys orchestration', inputsOf(split.result, [...split.staticClosure(orchestration)]), {
            forbidden: [surveyUiInput, surveyRenderingInput],
        })
    }
}

const reportSplit = async (name, split, { initialProducts = false, allowSurveyUi = false } = {}) => {
    const { initialKeys } = split
    const initial = new Set(initialKeys)
    const totalKeys = Object.keys(split.outputs)
    const dynamicKeys = totalKeys.filter((key) => !initial.has(key))
    const deferred = { allowProducts: true, allowSurveyUi, allowLazyLibraries: true }
    await report(`${name} initial`, split.result, split.contents(initialKeys), initialKeys, {
        allowProducts: initialProducts,
    })
    await report(`${name} dynamic`, split.result, split.contents(dynamicKeys), dynamicKeys, deferred)
    await report(`${name} total`, split.result, split.contents(totalKeys), totalKeys, deferred)
}

const measureRoot = async () => {
    const split = await buildSplit('fixtures/root.ts')
    assertBoundary('root initial', inputsOf(split.result, split.initialKeys), rootInitialBoundary)
    const loaded = split.dynamicEntryPoints(split.initialKeys)
    for (const product of [
        /\/products\/flags\/flags\.mjs$/,
        /\/products\/logs\/logs\.mjs$/,
        /\/products\/surveys\/automatic-surveys\.mjs$/,
        /\/products\/autocapture\/autocapture\.mjs$/,
        /\/products\/web-vitals\/web-vitals\.mjs$/,
        /\/products\/tracing-headers\/tracing-headers\.mjs$/,
        /\/products\/error-tracking\/error-tracking\.mjs$/,
        /\/products\/toolbar\/toolbar-extension\.mjs$/,
        /\/products\/conversations\/conversations-extension\.mjs$/,
        /\/products\/session-recording\/session-recording\.mjs$/,
    ]) {
        assert(
            loaded.some((entryPoint) => product.test(entryPoint)),
            `The root must load ${product} through a dynamic import`
        )
    }
    assertSurveyOrchestration(split)
    await reportSplit('root', split, { allowSurveyUi: true })
}

const measureSplit = async (name, fixture, { initialProducts = false, surveys = false } = {}) => {
    const split = await buildSplit(fixture)
    // A dynamically imported surveys product is its own orchestration chunk; a static one is in the initial graph,
    // whose report rejects survey rendering.
    if (surveys && !initialProducts) assertSurveyOrchestration(split)
    await reportSplit(name, split, { initialProducts, allowSurveyUi: surveys })
}

const surveyTypes = await build({
    absWorkingDir: packageRoot,
    entryPoints: ['fixtures/survey-types.ts'],
    bundle: true,
    format: 'esm',
    write: false,
})
if (surveyTypes.outputFiles.some((file) => file.text.trim())) {
    throw new Error('Type-only survey contracts must not retain runtime code')
}

await measureStatic('core minimal', 'fixtures/minimal.ts', coreBoundary)
await measureStatic('core', 'fixtures/core.ts', coreBoundary)
await measureRoot()
await measureStatic('core with cookie persistence', 'fixtures/cookie-persistence.ts', {
    required: [cookiePersistenceInput, ...durableDeliveryInputs],
    forbidden: [...productInputs, coreInput, surveyUiInput, rootCompositionInput],
})
const staticFlagsInputs = await measureStatic('static flags', 'fixtures/static-flags.ts', undefined, {
    allowProducts: true,
})
await measureSplit('dynamic flags', 'fixtures/dynamic-flags.ts')
await measureStatic('static logs', 'fixtures/static-logs.ts', undefined, { allowProducts: true })
await measureSplit('dynamic logs', 'fixtures/dynamic-logs.ts')
await measureSplit('explicit surveys', 'fixtures/static-surveys.ts', { initialProducts: true, surveys: true })
await measureSplit('dynamic surveys', 'fixtures/dynamic-surveys.ts', { surveys: true })
await measureStatic('static autocapture', 'fixtures/static-autocapture.ts', undefined, { allowProducts: true })
await measureSplit('dynamic autocapture', 'fixtures/dynamic-autocapture.ts')
// A static product keeps its third-party library behind the product's own dynamic import.
await measureSplit('static web vitals', 'fixtures/static-web-vitals.ts', { initialProducts: true })
await measureSplit('dynamic web vitals', 'fixtures/dynamic-web-vitals.ts')
await measureStatic('static tracing headers', 'fixtures/static-tracing-headers.ts', undefined, { allowProducts: true })
await measureSplit('root tracing headers', 'fixtures/root-tracing-headers.ts', { surveys: true })
await measureSplit('static error tracking', 'fixtures/static-error-tracking.ts', { initialProducts: true })
await measureSplit('root error tracking', 'fixtures/dynamic-error-tracking.ts', { surveys: true })
await measureSplit('static toolbar', 'fixtures/static-toolbar.ts', { initialProducts: true })
await measureSplit('static session recording', 'fixtures/static-session-recording.ts', { initialProducts: true })
await measureSplit('static conversations', 'fixtures/static-conversations.ts', { initialProducts: true, surveys: true })

// Negative controls: each guard must reject a real graph that crosses its boundary.
for (const [guard, boundary, inputs, graph] of [['core', coreBoundary, staticFlagsInputs, 'static flags']]) {
    assert.throws(
        () => assertBoundary(guard, inputs, boundary),
        /forbidden modules|must include/,
        `The ${guard} guard must reject the real ${graph} graph`
    )
}
stdout.write('Negative controls: core guard rejects the real flags graph\n')
stdout.write(`Budget status: ${COMPLIANT_BASELINE_PENDING}\n`)
