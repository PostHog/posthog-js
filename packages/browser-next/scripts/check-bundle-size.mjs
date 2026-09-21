import { argv, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, posix, relative } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { analyzeMetafile, build } from 'esbuild'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const COMPLIANT_BASELINE_PENDING = 'Set binding budgets after P0 compliance and the optimization pass.'
const forbiddenInputs = [
    /(^|\/)packages\/browser\/(src|dist)\//,
    /(^|\/)\.\.\/browser\/(src|dist)\//,
    /(^|\/)packages\/core\/(src|dist)\//,
    /(^|\/)\.\.\/core\/(src|dist)\//,
    /(^|\/)packages\/rrweb\//,
    /(^|\/)\.\.\/rrweb\//,
    /(^|\/)node_modules\/(posthog-js|@posthog\/core|core-js|dompurify|fflate|preact|rrweb|web-vitals)\//,
]
const flagsInput = /(^|\/)(feature-flags|flags)\.(m?js|ts)$/
const autocaptureInput = /(^|\/)(autocapture|rageclick|autocapture-utils)\.(m?js|ts)$/
const logsInput = /(^|\/)(logs|console-logs|logs-config|logs-utils)\.(m?js|ts)$/
const surveysInput =
    /(^|\/)(surveys(?:-extension|-renderer|-storage)?|survey-event-receiver(?:-base)?|survey-action-matcher)\.(m?js|tsx?)$/
const preactInput = /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?preact\//
const replayInput = /(^|\/)(replay(?:-delivery|-runtime)?|session-recording|lazy-loaded-session-recorder)([/.]|$)/
const rrwebInput =
    /(^|\/)(packages\/rrweb|\.\.\/rrweb|node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@posthog\/rrweb[^/]*|rrweb))\//
const fflateInput = /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?fflate\//
const coreInput = /(^|\/)(packages\/core|\.\.\/core|node_modules\/@posthog\/core)\//
const analyticsInput = /(^|\/)(capture-v1|analytics|analytics-delivery|lane)\.(m?js|ts)$/
const automaticAnalyticsInput = /(^|\/)automatic-analytics\.(m?js|ts)$/
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

const attribution = (result, outputKeys = Object.keys(result.metafile.outputs)) => {
    const bytes = new Map()
    for (const key of outputKeys) {
        for (const [input, details] of Object.entries(result.metafile.outputs[key].inputs)) {
            bytes.set(input, (bytes.get(input) ?? 0) + details.bytesInOutput)
        }
    }
    return [...bytes].map(([input, value]) => ({ input, bytes: value })).sort((a, b) => b.bytes - a.bytes)
}

const report = async (
    name,
    result,
    outputs,
    outputKeys,
    forbidAnalytics,
    allowFlags = false,
    allowSurveys = false,
    allowReplay = false
) => {
    const measured = sizes(outputs)
    const inputs = [...new Set(outputKeys.flatMap((key) => Object.keys(result.metafile.outputs[key].inputs)))]
    const forbidden = inputs.filter(
        (input) =>
            (forbiddenInputs.some((pattern) => pattern.test(input)) &&
                !(allowFlags && coreInput.test(input)) &&
                !(allowSurveys && preactInput.test(input)) &&
                !(allowReplay && (rrwebInput.test(input) || fflateInput.test(input)))) ||
            (forbidAnalytics && analyticsInput.test(input) && !(allowReplay && /\/lane\./.test(input))) ||
            (!allowReplay && replayInput.test(input)) ||
            (!allowFlags &&
                (flagsInput.test(input) ||
                    logsInput.test(input) ||
                    surveysInput.test(input) ||
                    autocaptureInput.test(input)))
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

const measureStatic = async (name, fixture, forbidAnalytics, allowFlags = false, allowSurveys = false) => {
    const result = await build({ ...buildOptions, entryPoints: [fixture] })
    const output = result.outputFiles[0]?.contents
    if (!output) {
        throw new Error(`The ${name} bundle-size fixture did not produce JavaScript`)
    }
    if (forbidAnalytics && Object.keys(result.metafile.inputs).some((input) => automaticAnalyticsInput.test(input))) {
        throw new Error('The core bundle references automatic analytics')
    }
    await report(
        name,
        result,
        [output],
        Object.keys(result.metafile.outputs),
        forbidAnalytics,
        allowFlags,
        allowSurveys
    )
}

const measureLazy = async (
    name = 'lazy',
    fixture = 'fixtures/lazy.ts',
    automatic = true,
    allowSurveys = automatic,
    staticReplay = false,
    allowReplay = automatic
) => {
    const outputDirectory = 'bundle-output'
    const result = await build({
        ...buildOptions,
        entryPoints: [fixture],
        splitting: true,
        outdir: outputDirectory,
    })
    const outputFiles = new Map(
        result.outputFiles.map((file) => [relative(packageRoot, file.path).replaceAll('\\', '/'), file.contents])
    )
    const entry = Object.entries(result.metafile.outputs).find(([, details]) =>
        details.entryPoint?.endsWith(fixture)
    )?.[0]
    if (!entry) {
        throw new Error('The lazy bundle-size fixture did not produce an entry chunk')
    }

    const staticClosure = (entry) => {
        const initial = new Set([entry])
        const pending = [entry]
        while (pending.length > 0) {
            const output = pending.pop()
            for (const imported of result.metafile.outputs[output].imports) {
                if (imported.external || imported.kind === 'dynamic-import') continue
                const key = result.metafile.outputs[imported.path]
                    ? imported.path
                    : posix.normalize(posix.join(dirname(output), imported.path))
                if (!initial.has(key)) {
                    initial.add(key)
                    pending.push(key)
                }
            }
        }
        return initial
    }
    const initial = staticClosure(entry)
    const surveysOrchestration = Object.entries(result.metafile.outputs).find(([, details]) =>
        details.entryPoint?.endsWith('/automatic-surveys.mjs')
    )?.[0]
    if (automatic && !surveysOrchestration) {
        throw new Error('The root must reference the automatic surveys orchestration chunk')
    }
    if (surveysOrchestration) {
        const inputs = [...staticClosure(surveysOrchestration)].flatMap((key) =>
            Object.keys(result.metafile.outputs[key].inputs)
        )
        if (inputs.some((input) => preactInput.test(input) || /surveys-renderer|survey-styles/.test(input))) {
            throw new Error(
                'Automatic surveys orchestration must keep renderer, Preact, and CSS behind its dynamic boundary'
            )
        }
    }

    const contents = (keys) =>
        keys.map((key) => {
            const output = outputFiles.get(key)
            if (!output) {
                throw new Error(`Missing generated bundle output ${key}`)
            }
            return output
        })
    const initialKeys = [...initial]
    const totalKeys = Object.keys(result.metafile.outputs)
    if (
        automatic &&
        !initialKeys.some((key) =>
            Object.keys(result.metafile.outputs[key].inputs).some((input) => automaticAnalyticsInput.test(input))
        )
    ) {
        throw new Error('The lazy initial bundle must include the automatic analytics factory')
    }
    const initialInputs = initialKeys.flatMap((key) => Object.keys(result.metafile.outputs[key].inputs))
    if (
        initialInputs.some(
            (input) => rrwebInput.test(input) || /lazy-loaded-session-recorder|replay-runtime/.test(input)
        )
    ) {
        throw new Error('Replay runtime must remain outside initial consumer graphs')
    }
    if (
        staticReplay &&
        initialInputs.some(
            (input) =>
                !coreInput.test(input) &&
                (flagsInput.test(input) ||
                    logsInput.test(input) ||
                    surveysInput.test(input) ||
                    autocaptureInput.test(input))
        )
    ) {
        throw new Error('Static replay must not retain unrelated products')
    }
    await report(`${name} initial`, result, contents(initialKeys), initialKeys, true, staticReplay, false, staticReplay)
    const dynamicKeys = totalKeys.filter((key) => !initial.has(key))
    await report(`${name} dynamic`, result, contents(dynamicKeys), dynamicKeys, false, true, allowSurveys, allowReplay)
    await report(`${name} total`, result, contents(totalKeys), totalKeys, false, true, allowSurveys, allowReplay)
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

await measureStatic('core', 'fixtures/minimal.ts', true)
await measureStatic('eager analytics', 'fixtures/eager.ts', false)
await measureLazy()
await measureStatic('static flags', 'fixtures/static-flags.ts', true, true)
await measureLazy('dynamic flags', 'fixtures/dynamic-flags.ts', false)
await measureStatic('static logs', 'fixtures/static-logs.ts', true, true)
await measureLazy('dynamic logs', 'fixtures/dynamic-logs.ts', false)
await measureStatic('static surveys', 'fixtures/static-surveys.ts', true, true, true)
await measureLazy('dynamic surveys', 'fixtures/dynamic-surveys.ts', false, true)
await measureStatic('static autocapture', 'fixtures/static-autocapture.ts', true, true)
await measureLazy('dynamic autocapture', 'fixtures/dynamic-autocapture.ts', false)
await measureLazy('static replay', 'fixtures/static-replay.ts', false, false, true, true)
await measureLazy('dynamic replay', 'fixtures/dynamic-replay.ts', false, false, false, true)
const replayTypes = await build({ ...buildOptions, entryPoints: ['fixtures/replay-types.ts'] })
if (replayTypes.outputFiles.some((file) => file.text.trim()))
    throw new Error('Replay type imports must not retain runtime code')
stdout.write(`Budget status: ${COMPLIANT_BASELINE_PENDING}\n`)
