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
 *
 * When the package has a MIGRATION.md, the script also writes it as `<id>-migration.md`, the docs site's
 * migration page.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import readChangesets from '@changesets/read'
import { Application, ReflectionKind as Kind, ReflectionType } from 'typedoc'
import { MarkdownPageEvent, MarkdownRendererEvent } from 'typedoc-plugin-markdown'
import {
    BROWSER_TOPICS,
    findDisallowedSkillUrls,
    formatCompactSignature,
    formatSkillIndexTable,
    groupCapabilitiesIntoTopics,
    isConfigType,
    rewriteRelativeDocsLinks,
    stripNonPostHogLinks,
    updateSkillIndex,
} from './sdk-reference-helpers.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGES = {
    browser: {
        id: 'posthog-js',
        name: 'JavaScript Web',
        logo: 'javascript',
        entry: 'src/entrypoints/module.no-external.es.ts',
        extraEntries: ['src/customizations/before-send.ts'],
        splitTopics: true,
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

function buildReferenceData(app, project, caps, current) {
    const render = renderer(app, project)
    const entries = config.extraEntries
        ? project.children.flatMap((r) => (r.kindOf(Kind.Module) && r.name !== '<internal>' ? r.children : [r]))
        : project.children
    const exported = entries.filter(isPublic)
    const main = exported.find((c) => c.name === 'PostHog')
    // Every public PostHog member and every other public export goes through the capability map.
    const members = (main.children ?? []).filter((m) => m.kindOf(MEMBER_KINDS) && isPublic(m))
    const others = exported.filter((r) => r !== main && r.kindOf(Kind.Function | Kind.Variable | Kind.Class))
    const labelOf = (r) =>
        r.parent !== main ? r.name : r.kind === Kind.Constructor ? 'new PostHog(...)' : `PostHog.${r.name}`
    const all = [...members, ...others]
    const { mapped, hidden } = capabilityMap(all.map(labelOf), caps, current)
    const shown = all.filter((r) => !hidden.includes(labelOf(r)))

    const capabilityEntries = []
    for (const [slug, title] of Object.entries(caps)) {
        const tagged = shown.filter((r) => mapped[labelOf(r)] === slug)
        if (tagged.length) {
            capabilityEntries.push({
                slug,
                title,
                labels: tagged.map(labelOf),
                signatures: tagged.map((r) => formatCompactSignature(labelOf(r), r)),
                sections: [`## ${title}`, ...tagged.map((r) => render(r, labelOf(r)))],
            })
        }
    }
    const utilMembers = shown.filter((r) => !mapped[labelOf(r)])
    const utilsEntry = {
        labels: utilMembers.map(labelOf),
        signatures: utilMembers.map((r) => formatCompactSignature(labelOf(r), r)),
        sections: ['## SDK utils', ...utilMembers.map((r) => render(r, labelOf(r)))],
    }

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
    const typeEntries = sorted.map((t) => ({ name: t.name, rendered: render(t, t.name) }))
    const allSections = [
        ...capabilityEntries.flatMap((c) => c.sections),
        ...utilsEntry.sections,
        '## Types',
        ...typeEntries.map((t) => t.rendered),
    ]
    return { capabilityEntries, utilsEntry, typeEntries, allSections }
}

function frontMatter(title, sections, logo) {
    // The heading's anchor: lowercase letters, digits, `_` and `-`, with spaces as `-`.
    const kept = (c) => c === ' ' || c === '-' || c === '_' || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
    const slug = (h) => [...h.toLowerCase()].filter(kept).join('').split(' ').join('-')
    const headings = sections
        .flatMap((s) => s.split('\n'))
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3))
    const head = [`title: "${title}"`, 'sidebar: Docs', 'showTitle: true', 'contentMaxWidthClass: max-w-full']
    const entries = headings.map((h) => `  - value: "${h}"\n    url: ${slug(h)}\n    depth: 0`)
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

/** Extracts an H1 title (if present) and returns `{ title, body }`. */
function stripH1(markdown, fallbackTitle) {
    const trimmed = markdown.trim()
    if (!trimmed.startsWith('# ')) return { title: fallbackTitle, body: trimmed }
    const end = trimmed.indexOf('\n')
    const title = (end === -1 ? trimmed : trimmed.slice(0, end)).slice(2).trim()
    const body = end === -1 ? '' : trimmed.slice(end).trim()
    return { title, body }
}

/** Formats a skill reference file: plain Markdown with rewritten PostHog .md links and strict domain lock. */
function prepareSkillMarkdown(sections, targetLabel) {
    const raw = sections.join('\n\n') + '\n'
    const cleaned = stripNonPostHogLinks(rewriteRelativeDocsLinks(raw))
    const disallowed = findDisallowedSkillUrls(cleaned)
    if (disallowed.length > 0) {
        throw new Error(`Disallowed external URL(s) in ${targetLabel}: ${disallowed.join(', ')}`)
    }
    return cleaned
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
// pending one means the code is the next major. It gets its own page, and the current pages stay.
const nextMajor = (await readChangesets(values.source ?? ROOT)).some((c) =>
    c.releases.some((r) => r.name === pkg.name && r.type === 'major')
)
const major = Number(values.major ?? declared + Number(nextMajor))

const app = await Application.bootstrapWithPlugins({
    entryPoints: [config.entry, ...(config.extraEntries ?? [])].map((entry) => path.join(pkgDir, entry)),
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

let started
let refData
app.renderer.on(MarkdownRendererEvent.BEGIN, () => {
    started = nest(fs.readFileSync(path.join(docsDir, 'getting-started.md'), 'utf8'))
    refData = buildReferenceData(app, project, capabilities(specs), declared >= major)
})
await app.generateOutputs(project)
fs.rmSync(app.options.getValue('markdown'), { recursive: true, force: true })

const refsDir = path.join(ROOT, 'packages', positionals[0], 'references')
const write = (name, sections) => {
    fs.mkdirSync(refsDir, { recursive: true })
    fs.writeFileSync(path.join(refsDir, name), sections.join('\n\n') + '\n')
    process.stdout.write(`wrote packages/${positionals[0]}/references/${name}\n`)
}

const title = `PostHog ${config.name} SDK`
const fullBody = ['## Getting started', started, ...refData.allSections]
// Frozen major snapshot always stays a single complete sheet.
write(`${config.id}-${major}.md`, [frontMatter(`${title} ${major}.x`, fullBody, config.logo), ...fullBody])

if (declared >= major) {
    // Website reference always stays a single complete sheet, matching every other PostHog SDK.
    write(`${config.id}-reference.md`, [frontMatter(title, fullBody, config.logo), ...fullBody])

    // Bundled npm skill references (packages/browser/skills/posthog-js/references/) — split by topic when SKILL.md exists.
    if (config.splitTopics) {
        const skillDir = path.join(ROOT, 'packages', positionals[0], 'skills', config.id)
        const skillMdPath = path.join(skillDir, 'SKILL.md')
        if (fs.existsSync(skillMdPath)) {
            const topics = groupCapabilitiesIntoTopics(refData.capabilityEntries, refData.utilsEntry, BROWSER_TOPICS)
            const setupTopic = topics.find((t) => t.slug === 'setup')
            const otherTopics = topics.filter((t) => t.slug !== 'setup')
            const configTypes = refData.typeEntries.filter((t) => isConfigType(t.name))
            const configSections = ['## Configuration reference', ...configTypes.map((t) => t.rendered)]

            const companionGuides = [
                {
                    slug: 'persistence',
                    file: 'persistence.md',
                    fallbackTitle: `${title} persistence`,
                    description: 'Storage modes, cookies, cross-subdomain sync, and consent storage',
                    exports: '`persistence`, `cookieWinsOnConflict`, `cookie_persisted_properties`',
                },
                {
                    slug: 'security',
                    file: 'security.md',
                    fallbackTitle: `${title} security`,
                    description: 'Version pinning, Subresource Integrity (SRI), CSP, nonces, and no-external bundles',
                    exports: '`require_subresource_integrity`, `disable_external_dependency_loading`',
                },
            ]
            const loadedGuides = companionGuides
                .filter((g) => fs.existsSync(path.join(docsDir, g.file)))
                .map((g) => {
                    const parsed = stripH1(fs.readFileSync(path.join(docsDir, g.file), 'utf8'), g.fallbackTitle)
                    return { ...g, title: parsed.title, body: parsed.body }
                })

            const skillRefsDir = path.join(skillDir, 'references')
            fs.mkdirSync(skillRefsDir, { recursive: true })

            const writtenSkillFiles = new Set()
            const writeSkillRef = (filename, sections) => {
                const label = `packages/${positionals[0]}/skills/${config.id}/references/${filename}`
                const content = prepareSkillMarkdown(sections, label)
                fs.writeFileSync(path.join(skillRefsDir, filename), content)
                writtenSkillFiles.add(filename)
                process.stdout.write(`wrote ${label}\n`)
            }

            const indexEntries = []
            const formatSignatures = (sigs) =>
                sigs
                    .slice(0, 5)
                    .map((s) => `\`${s}\``)
                    .join(', ') + (sigs.length > 5 ? `, and ${sigs.length - 5} more` : '')

            writeSkillRef('setup.md', [
                '# Setup and getting started',
                '## Getting started',
                started,
                ...(setupTopic?.sections ?? []),
            ])
            indexEntries.push({
                file: 'setup.md',
                description: setupTopic?.description ?? 'Initialize, configure, debug, and shut down the SDK',
                signatures: formatSignatures(setupTopic?.signatures ?? []),
            })

            writeSkillRef('config.md', ['# Configuration reference', ...configSections])
            indexEntries.push({
                file: 'config.md',
                description: 'All `PostHogConfig` options and nested config types',
                signatures: '`PostHogConfig`, `SessionRecordingOptions`, `ConfigDefaults`',
            })

            for (const topic of otherTopics) {
                const filename = `${topic.slug}.md`
                writeSkillRef(filename, [`# ${topic.title}`, ...topic.sections])
                indexEntries.push({
                    file: filename,
                    description: topic.description,
                    signatures: formatSignatures(topic.signatures),
                })
            }

            for (const guide of loadedGuides) {
                writeSkillRef(guide.file, [`# ${guide.title}`, guide.body])
                indexEntries.push({
                    file: guide.file,
                    description: guide.description,
                    signatures: guide.exports,
                })
            }

            // Remove stale generated skill reference files
            for (const existing of fs.readdirSync(skillRefsDir)) {
                if (existing.endsWith('.md') && !writtenSkillFiles.has(existing)) {
                    fs.rmSync(path.join(skillRefsDir, existing))
                }
            }

            // Update auto-generated index inside SKILL.md and enforce strict PostHog domain lock
            const currentSkill = fs.readFileSync(skillMdPath, 'utf8')
            const updatedSkill = updateSkillIndex(currentSkill, formatSkillIndexTable(indexEntries))
            const disallowed = findDisallowedSkillUrls(updatedSkill)
            if (disallowed.length > 0) {
                throw new Error(`Disallowed external URL(s) in ${skillMdPath}: ${disallowed.join(', ')}`)
            }
            fs.writeFileSync(skillMdPath, updatedSkill)
            process.stdout.write(`updated packages/${positionals[0]}/skills/${config.id}/SKILL.md\n`)
        }
    }
}

// The package's MIGRATION.md, when it has one, is the docs site's migration page. Its H1 becomes the page
// title, so the page shows one title.
const migration = path.join(pkgDir, 'MIGRATION.md')
if (fs.existsSync(migration)) {
    const parsed = stripH1(fs.readFileSync(migration, 'utf8'), `${title} migration guides`)
    const head = ['---', `title: ${JSON.stringify(parsed.title)}`, 'sidebar: Docs', 'showTitle: true', '---'].join('\n')
    write(`${config.id}-migration.md`, [head, parsed.body])
}
