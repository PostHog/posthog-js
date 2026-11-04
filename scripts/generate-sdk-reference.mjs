/**
 * Generates an SDK's reference as plain Markdown from its source doc comments, with TypeDoc and
 * typedoc-plugin-markdown. Our code only groups and orders the symbols and writes the front matter.
 *
 * A `posthog-capability: <slug>` line in a doc comment puts a symbol under that PostHog/sdk-specs
 * capability, in the sdk-specs README's order. Untagged class members go to SDK utils.
 *
 *     node scripts/generate-sdk-reference.mjs <browser|node|react-native> [--sdk-specs DIR] [--major N] [--source DIR]
 *
 * `--sdk-specs` is a PostHog/sdk-specs checkout, and defaults to $SDK_SPECS. Build the package and its
 * dependencies first, because TypeDoc reads the built `@posthog/core` types.
 *
 * `--source` reads another checkout of this repo, for a release branch that isn't checked out here.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
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
const TAG = /^[ \t]*posthog-capability:[ \t]*([a-z0-9-]+)[ \t]*\n?/m
const MEMBER_KINDS = Kind.Method | Kind.Accessor | Kind.Property | Kind.Constructor
const TYPE_KINDS = Kind.Interface | Kind.TypeAlias | Kind.Enum | Kind.Class

/** Each sdk-specs capability's slug and title in sentence case, in the README's order. */
function capabilities(checkout) {
    const readme = fs.readFileSync(path.join(checkout, 'README.md'), 'utf8')
    const rows = [...readme.matchAll(/^\| ([^|]+?) \| \[`openspec\/specs\/([a-z0-9-]+)\/spec\.md`\]/gm)]
    const acronyms = { id: 'ID', ai: 'AI', http: 'HTTP', mcp: 'MCP' }
    const titles = Object.fromEntries(
        rows.map(([, name, slug]) => [
            slug,
            name
                .split(' ')
                .map((w) => acronyms[w.toLowerCase()] ?? w.toLowerCase())
                .join(' '),
        ])
    )
    const order = [...FIRST, ...Object.keys(titles).filter((s) => !FIRST.includes(s))]
    return Object.fromEntries(
        order.filter((s) => titles[s]).map((s) => [s, titles[s][0].toUpperCase() + titles[s].slice(1)])
    )
}

const commentOf = (r) => r.comment ?? r.signatures?.find((s) => s.comment)?.comment ?? r.getSignature?.comment

/** The capability tag. It is stripped from the doc comments TypeDoc renders. */
function tag(refl) {
    let found
    for (const r of [refl, ...(refl.signatures ?? []), refl.getSignature, refl.setSignature].filter(Boolean)) {
        for (const part of r.comment?.summary ?? []) {
            const m = TAG.exec(part.text)
            if (m) {
                found ??= m[1]
                part.text = part.text.replace(TAG, '').replace(/\n{3,}/g, '\n\n')
            }
        }
    }
    return found
}

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
    return (refl, name) => {
        let md = ctx.partials.member(refl, { headingLevel: 3 }).trim()
        // Links point at pages this one doesn't have, and the site reads Markdown as MDX 1.
        md = md.replace(/\[([^\]]+)\]\((?:[^)\s]*\.md[^)\s]*|#[^)\s]*)\)/g, '$1')
        md = md.replace(/<br>/g, '<br />').replace(/<code>(.*?)<\/code>/g, '`$1`')
        md = md.replace(
            /^#+ (?:Inherited from|Overrides|Implementation of|Implementations)\n[\s\S]*?(?=^#|(?![\s\S]))/gm,
            ''
        )
        md = md.replace(/\n{3,}/g, '\n\n')
        return /^#{1,6} /.test(md) ? md.replace(/^#{1,6} .*$/m, `### \`${name}\``) : `### \`${name}\`\n\n${md}`
    }
}

function reference(app, project, config, caps) {
    const render = renderer(app, project)
    const order = Object.keys(caps)
    const exported = project.children.filter(isPublic)
    const main = exported.find((c) => c.name === 'PostHog')
    const members = (cls) =>
        (cls.children ?? []).filter(
            (m) => m.kindOf(MEMBER_KINDS) && isPublic(m) && (!m.kindOf(Kind.Property) || commentOf(m))
        )
    const used = new Set()
    const entries = (cls, m) => {
        const label = m.kind === Kind.Constructor ? `new ${cls.name}(...)` : `${cls.name}.${m.name}`
        used.add(m)
        return { tag: tag(m), md: () => render(m, label) }
    }
    const mine = members(main)
        .map((m) => entries(main, m))
        .sort((a, b) => (order.indexOf(a.tag) + 1 || 1e9) - (order.indexOf(b.tag) + 1 || 1e9))
    const out = []
    for (const [slug, title] of Object.entries(caps)) {
        const tagged = mine.filter((e) => e.tag === slug)
        if (tagged.length) out.push(`## ${title}`, ...tagged.map((e) => e.md()))
    }
    const loose = exported.filter(
        (r) => r.kindOf(Kind.Function) || (r.kindOf(Kind.Variable) && r.type?.declaration?.signatures)
    )
    for (const r of loose) used.add(r)
    const untagged = mine.filter((e) => !caps[e.tag])
    out.push('## SDK utils', ...untagged.map((e) => e.md()), ...loose.map((r) => render(r, r.name)))
    // Types: everything the rendered symbols mention, and what those mention in turn.
    const types = new Set()
    const queue = [...used]
    while (queue.length) {
        for (const t of referenced(queue.pop())) {
            if (t.kindOf(TYPE_KINDS) && isPublic(t) && t !== main && !types.has(t) && project.children.includes(t)) {
                types.add(t)
                queue.push(t)
            }
        }
    }
    const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name))
    return [...out, '## Types', ...sorted.map((t) => render(t, t.name))]
}

function frontMatter(title, sections, logo) {
    const slug = (h) =>
        h
            .toLowerCase()
            .replace(/[^\w\- ]/g, '')
            .replace(/ /g, '-')
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
            fenced ^= /^\s*```/.test(line)
            if (fenced || !/^#{1,5} /.test(line)) return [line]
            return line.startsWith('# ') ? [] : [`#${line}`]
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
const declared = Number(JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version.split('.')[0])
const major = Number(values.major ?? declared)

const app = await Application.bootstrapWithPlugins({
    entryPoints: [path.join(pkgDir, config.entry)],
    tsconfig: path.join(pkgDir, 'tsconfig.json'),
    plugin: [fileURLToPath(import.meta.resolve('typedoc-plugin-markdown'))],
    excludePrivate: true,
    excludeProtected: true,
    excludeExternals: true,
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

let body
app.renderer.on(MarkdownRendererEvent.BEGIN, () => {
    const started = nest(fs.readFileSync(path.join(pkgDir, 'docs/getting-started.md'), 'utf8'))
    body = ['## Getting started', started, ...reference(app, project, config, capabilities(specs))]
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
