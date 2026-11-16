/**
 * Generates an SDK's reference as plain Markdown from its source doc comments, with TypeDoc and
 * typedoc-plugin-markdown. Our code only groups and orders the symbols and writes the front matter.
 *
 * The package's docs/capabilities.json maps each PostHog member's label to a PostHog/sdk-specs
 * capability, shown in the sdk-specs README's order. Its `utils` lists the members that go to SDK utils, and
 * its `hidden` lists the internal and deprecated members that the page leaves out.
 *
 *     node scripts/generate-sdk-reference.mjs <browser|node|react-native> [--sdk-specs DIR] [--major N] [--source DIR]
 *
 * `--sdk-specs` is a PostHog/sdk-specs checkout, and defaults to $SDK_SPECS. Build the package and its
 * dependencies first, because TypeDoc reads the built `@posthog/core` types.
 *
 * `--source` reads the code from another checkout of this repo, for a release branch that isn't checked out
 * here. The docs/ folder still comes from this checkout.
 *
 * `--major` defaults to the package.json major, plus one when a major changeset for the package is pending.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import readChangesets from '@changesets/read'
import { Application, ReflectionKind as Kind, ReflectionType } from 'typedoc'
import { MarkdownPageEvent, MarkdownRendererEvent } from 'typedoc-plugin-markdown'

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGES = {
    browser: {
        id: 'posthog-js',
        name: 'JavaScript Web',
        logo: 'javascript',
        entry: 'src/entrypoints/module.no-external.es.ts',
    },
    node: { id: 'posthog-node', name: 'Node.js', logo: 'nodejs', entry: 'src/entrypoints/index.node.ts' },
    'react-native': { id: 'posthog-react-native', name: 'React Native', logo: 'react', entry: 'src/index.ts' },
}
const FIRST = ['setup', 'capture', 'identify']
const MEMBER_KINDS = Kind.Method | Kind.Accessor | Kind.Property | Kind.Constructor
const TYPE_KINDS = Kind.Interface | Kind.TypeAlias | Kind.Enum | Kind.Class

/** Each sdk-specs capability's slug and title in sentence case, in the README's order. */
function capabilities(checkout) {
    const readme = fs.readFileSync(path.join(checkout, 'README.md'), 'utf8')
    const acronyms = { id: 'ID', ai: 'AI', http: 'HTTP', mcp: 'MCP' }
    const prefix = '[`openspec/specs/'
    const titles = {}
    // A capability row is `| Name | [`openspec/specs/<slug>/spec.md`](...) |`.
    for (const line of readme.split('\n')) {
        const [, name, spec] = line.split('|').map((cell) => cell.trim())
        if (!line.startsWith('| ') || !spec?.startsWith(prefix) || !spec.includes('/spec.md`]')) continue
        const words = name.split(' ').map((w) => acronyms[w.toLowerCase()] ?? w.toLowerCase())
        titles[spec.slice(prefix.length, spec.indexOf('/spec.md'))] = words.join(' ')
    }
    const order = [...FIRST, ...Object.keys(titles).filter((s) => !FIRST.includes(s))]
    return Object.fromEntries(
        order.filter((s) => titles[s]).map((s) => [s, titles[s][0].toUpperCase() + titles[s].slice(1)])
    )
}

const commentOf = (r) => r.comment ?? r.signatures?.find((s) => s.comment)?.comment ?? r.getSignature?.comment

const isPublic = (r) =>
    !r.name.startsWith('_') && !r.flags.isPrivate && !r.flags.isProtected && !commentOf(r)?.hasModifier('@internal')

/** Reflections referenced by a type, so Types lists what the documented symbols mention. */
function referenced(refl) {
    const out = new Set()
    const visit = (t) => {
        if (!t) return
        if (t.type === 'reference' && t.reflection) out.add(t.reflection)
        if (t instanceof ReflectionType) walk(t.declaration)
        for (const key of [
            'elementType',
            'objectType',
            'indexType',
            'checkType',
            'extendsType',
            'trueType',
            'falseType',
        ])
            visit(t[key])
        for (const key of ['types', 'typeArguments', 'elements']) (t[key] ?? []).forEach(visit)
    }
    const walk = (r) => {
        visit(r.type)
        ;(r.signatures ?? []).forEach(walk)
        ;(r.parameters ?? []).forEach(walk)
        ;(r.typeParameters ?? []).forEach((p) => visit(p.type))
        ;(r.children ?? []).forEach(walk)
        ;[r.getSignature, r.setSignature, r.indexSignatures].flat().filter(Boolean).forEach(walk)
        ;(r.extendedTypes ?? []).forEach(visit)
    }
    walk(refl)
    return out
}

function renderer(app, project) {
    const theme = app.renderer.theme
    const page = new MarkdownPageEvent(project)
    page.project = project
    page.filename = page.url = 'reference.md'
    const ctx = theme.getRenderContext(page)
    // The reference is one page, so a reflection renders as plain text, not a link to another page.
    ctx.urlTo = () => ''
    // A member doesn't say where it's inherited from or what it overrides. Tables keep their column.
    const inheritance = ctx.partials.inheritance
    ctx.partials.inheritance = (model, options) => (options.headingLevel === -1 ? inheritance(model, options) : '')
    return (refl, name) => {
        const lines = ctx.partials.member(refl, { headingLevel: 3 }).trim().split('\n')
        // The label replaces the plugin's heading, and runs of blank lines become one.
        const body = (lines[0].startsWith('#') ? lines.slice(1) : ['', ...lines]).filter(
            (line, i, all) => line !== '' || all[i - 1] !== ''
        )
        return [`### \`${name}\``, ...body].join('\n')
    }
}

/**
 * The package's capability map, checked against the symbols it names and sdk-specs. Every label must be in
 * exactly one of the map, `utils` and `hidden`. `next` lists labels that only the next major has, and a
 * next major's page doesn't check that the other labels exist.
 */
function capabilityMap(labels, caps, current) {
    const file = JSON.parse(fs.readFileSync(path.join(docsDir, 'capabilities.json'), 'utf8'))
    const { utils, hidden, next, ...mapped } = file
    const problems = []
    const fail = (message) => problems.push(`docs/capabilities.json: ${message}`)
    const listed = [...Object.keys(mapped), ...utils, ...hidden]
    for (const label of listed) {
        if (listed.indexOf(label) !== listed.lastIndexOf(label)) fail(`${label} is listed more than once`)
        if (current && !labels.includes(label) && !next.includes(label)) fail(`no symbol for ${label}`)
    }
    for (const [label, slug] of Object.entries(mapped)) if (!caps[slug]) fail(`${label}: ${slug} isn't in sdk-specs`)
    for (const label of labels) if (!listed.includes(label)) fail(`map ${label}, or add it to utils or hidden`)
    if (problems.length) {
        process.stderr.write(problems.join('\n') + '\n')
        process.exit(1)
    }
    return { mapped, hidden }
}

function reference(app, project, caps, current) {
    const render = renderer(app, project)
    const exported = project.children.filter(isPublic)
    const main = exported.find((c) => c.name === 'PostHog')
    // Every public PostHog member and every other public export goes through the capability map.
    const members = (main.children ?? []).filter((m) => m.kindOf(MEMBER_KINDS) && isPublic(m))
    const others = exported.filter((r) => r !== main && r.kindOf(Kind.Function | Kind.Variable | Kind.Class))
    const labelOf = (r) =>
        r.parent !== main ? r.name : r.kind === Kind.Constructor ? 'new PostHog(...)' : `PostHog.${r.name}`
    const all = [...members, ...others]
    const { mapped, hidden } = capabilityMap(all.map(labelOf), caps, current)
    const shown = all.filter((r) => !hidden.includes(labelOf(r)))
    const out = []
    for (const [slug, title] of Object.entries(caps)) {
        const tagged = shown.filter((r) => mapped[labelOf(r)] === slug)
        if (tagged.length) out.push(`## ${title}`, ...tagged.map((r) => render(r, labelOf(r))))
    }
    out.push('## SDK utils', ...shown.filter((r) => !mapped[labelOf(r)]).map((r) => render(r, labelOf(r))))
    // Types: every exported type, every type a shown symbol mentions, and what those mention in turn.
    // PostHog's base classes are left out, because their members are already PostHog's.
    const bases = new Set()
    for (let c = main; c.extendedTypes?.[0]?.reflection; c = c.extendedTypes[0].reflection) bases.add(c)
    const isType = (t) => t.kindOf(TYPE_KINDS) && isPublic(t) && t !== main && !bases.has(t) && !others.includes(t)
    const types = new Set(exported.filter(isType))
    const queue = [...shown, ...types]
    while (queue.length) {
        for (const t of referenced(queue.pop())) {
            if (isType(t) && !types.has(t)) {
                types.add(t)
                queue.push(t)
            }
        }
    }
    const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name))
    return [...out, '## Types', ...sorted.map((t) => render(t, t.name))]
}

function frontMatter(title, sections, logo) {
    // The heading's anchor: lowercase letters, digits, `_` and `-`, with spaces as `-`.
    const kept = (c) => c === ' ' || c === '-' || c === '_' || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
    const slug = (h) => [...h.toLowerCase()].filter(kept).join('').split(' ').join('-')
    const toc = sections.filter((s) => s.startsWith('## ')).map((s) => s.slice(3))
    const head = [`title: "${title}"`, 'sidebar: Docs', 'showTitle: true', 'contentMaxWidthClass: max-w-full']
    const entries = toc.map((h) => `  - value: "${h}"\n    url: ${slug(h)}\n    depth: 0`)
    return ['---', ...head, `platformLogo: ${logo}`, 'tableOfContents:', ...entries, '---'].join('\n')
}

/** Moves each heading down one level and drops the H1. Code stays as written. */
function nest(markdown) {
    let fenced = false
    return markdown
        .trim()
        .split('\n')
        .flatMap((line) => {
            fenced ^= line.trimStart().startsWith('```')
            let level = 0
            while (line[level] === '#') level++
            if (fenced || level < 1 || level > 5 || line[level] !== ' ') return [line]
            return level === 1 ? [] : [`#${line}`]
        })
        .join('\n')
}

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { 'sdk-specs': { type: 'string' }, major: { type: 'string' }, source: { type: 'string' } },
})
const config = PACKAGES[positionals[0]]
const specs = values['sdk-specs'] ?? process.env.SDK_SPECS
if (!config || !specs) {
    process.stderr.write(
        'usage: generate-sdk-reference.mjs <browser|node|react-native> [--sdk-specs DIR] [--major N] [--source DIR]' +
            '\n'
    )
    process.exit(1)
}
const pkgDir = path.join(values.source ?? ROOT, 'packages', positionals[0])
// The getting-started page and the capability map always come from this checkout.
const docsDir = path.join(ROOT, 'packages', positionals[0], 'docs')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const declared = Number(pkg.version.split('.')[0])
// A branch for the next major keeps the old version until the release applies its major changeset, so a
// pending one means the code is the next major. It gets the experimental page, and the current pages stay.
const nextMajor = (await readChangesets(values.source ?? ROOT)).some((c) =>
    c.releases.some((r) => r.name === pkg.name && r.type === 'major')
)
const major = Number(values.major ?? declared + Number(nextMajor))

const app = await Application.bootstrapWithPlugins({
    entryPoints: [path.join(pkgDir, config.entry)],
    tsconfig: path.join(pkgDir, 'tsconfig.json'),
    // missing-exports documents the types a page names that the package doesn't export, such as @posthog/core's.
    plugin: ['typedoc-plugin-markdown', 'typedoc-plugin-missing-exports'].map((p) =>
        fileURLToPath(import.meta.resolve(p))
    ),
    excludePrivate: true,
    excludeProtected: true,
    excludeExternals: true,
    excludeInternal: true,
    skipErrorChecking: true,
    logLevel: 'Error',
    // plugin-markdown options
    hidePageHeader: true,
    hideBreadcrumbs: true,
    disableSources: true,
    parametersFormat: 'table',
    propertiesFormat: 'table',
    interfacePropertiesFormat: 'table',
    typeDeclarationFormat: 'table',
    enumMembersFormat: 'table',
    useCodeBlocks: false,
    expandObjects: false,
    router: 'module',
    markdown: fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-reference-')),
})
const project = await app.convert()
if (!project) process.exit(1)
// TypeDoc calls a destructured parameter `__namedParameters` when no `@param` tag names it.
for (const p of project.getReflectionsByKind(Kind.Parameter)) if (p.name === '__namedParameters') p.name = 'options'

let body
app.renderer.on(MarkdownRendererEvent.BEGIN, () => {
    const started = nest(fs.readFileSync(path.join(docsDir, 'getting-started.md'), 'utf8'))
    body = ['## Getting started', started, ...reference(app, project, capabilities(specs), declared >= major)]
})
await app.generateOutputs(project)
fs.rmSync(app.options.getValue('markdown'), { recursive: true, force: true })

const write = (name, sections) => {
    const dir = path.join(ROOT, 'packages', positionals[0], 'references')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, name), sections.join('\n\n') + '\n')
    process.stdout.write(`wrote packages/${positionals[0]}/references/${name}\n`)
}
const title = `PostHog ${config.name} SDK`
write(`${config.id}-${major}.md`, [
    frontMatter(`${title} ${major}.x${declared >= major ? '' : ' (experimental)'}`, body, config.logo),
    ...body,
])
if (declared >= major) write(`${config.id}-reference.md`, [frontMatter(title, body, config.logo), ...body])
