import { URL } from 'node:url'

export const BROWSER_TOPICS = [
    {
        slug: 'setup',
        title: 'Setup',
        description: 'Initialize, configure, debug, and shut down the SDK',
        capabilities: ['setup', 'shutdown', 'debug'],
    },
    {
        slug: 'events',
        title: 'Events and properties',
        description: 'Capture custom events, AI events, logs, and super properties',
        capabilities: ['capture', 'capture-ai', 'logs', 'register', 'unregister'],
    },
    {
        slug: 'identity',
        title: 'Identity and groups',
        description: 'Identify users, set person properties, reset sessions, and group analytics',
        capabilities: [
            'identify',
            'alias',
            'reset',
            'get-distinct-id',
            'set-person-properties',
            'create-person-profile',
            'group',
            'group-identify',
        ],
    },
    {
        slug: 'feature-flags',
        title: 'Feature flags',
        description: 'Evaluate flags, payloads, callbacks, and flag override properties',
        capabilities: [
            'get-feature-flag',
            'get-feature-flag-payload',
            'get-feature-flag-result',
            'get-feature-flags',
            'is-feature-enabled',
            'on-feature-flags',
            'reload-feature-flags',
            'set-person-properties-for-flags',
            'reset-person-properties-for-flags',
            'set-group-properties-for-flags',
            'reset-group-properties-for-flags',
        ],
    },
    {
        slug: 'session-replay',
        title: 'Session replay',
        description: 'Start, stop, and inspect session recording and session IDs',
        capabilities: [
            'start-session-recording',
            'stop-session-recording',
            'is-session-replay-active',
            'get-session-id',
        ],
    },
    {
        slug: 'error-tracking',
        title: 'Error tracking',
        description: 'Capture exceptions, control autocapture, and record exception steps',
        capabilities: ['capture-exception', 'exception-steps'],
    },
    {
        slug: 'surveys',
        title: 'Surveys',
        description: 'Fetch, match, render, and manage in-app surveys',
        capabilities: ['surveys'],
    },
    {
        slug: 'privacy',
        title: 'Privacy and consent',
        description: 'Opt in, opt out, and query explicit consent state',
        capabilities: ['opt-in', 'is-opt-out', 'consent-gating'],
    },
]

const INDEX_START = '<!-- BEGIN GENERATED INDEX -->'
const INDEX_END = '<!-- END GENERATED INDEX -->'

const ALLOWED_EXACT_HOSTS = new Set(['posthog.com', 'example.com', 'yourdomain.com', 'localhost', '127.0.0.1'])
const ALLOWED_HOST_SUFFIXES = ['.posthog.com', '.example.com', '.yourdomain.com']

/**
 * Groups rendered sdk-specs capability entries into higher-level topic pages.
 * Throws if any mapped capability isn't declared in `topicSpecs`, preventing silent unlisted pages that posthog.com wouldn't route.
 */
export function groupCapabilitiesIntoTopics(capabilityEntries, utilsEntry, topicSpecs = BROWSER_TOPICS) {
    const bySlug = new Map(capabilityEntries.map((entry) => [entry.slug, entry]))
    const assigned = new Set()
    const topics = []

    for (const spec of topicSpecs) {
        const sections = []
        const labels = []
        const signatures = []
        for (const slug of spec.capabilities) {
            const entry = bySlug.get(slug)
            if (!entry) continue
            assigned.add(slug)
            sections.push(...entry.sections)
            labels.push(...entry.labels)
            signatures.push(...(entry.signatures ?? entry.labels))
        }
        if (sections.length > 0) {
            topics.push({
                slug: spec.slug,
                title: spec.title,
                description: spec.description,
                sections,
                labels,
                signatures,
            })
        }
    }

    const unassigned = capabilityEntries.filter((entry) => !assigned.has(entry.slug)).map((entry) => entry.slug)
    if (unassigned.length > 0) {
        throw new Error(
            `Unassigned SDK capability(s): ${unassigned.join(', ')}. Assign each to a topic in BROWSER_TOPICS.`
        )
    }

    if (utilsEntry?.sections?.length) {
        topics.push({
            slug: 'utils',
            title: 'SDK utils',
            description: 'Samplers, toolbar, early access features, and helper utilities',
            sections: [...utilsEntry.sections],
            labels: [...(utilsEntry.labels ?? [])],
            signatures: [...(utilsEntry.signatures ?? utilsEntry.labels ?? [])],
        })
    }

    return topics
}

/** True for configuration types bundled in config.md (PostHogConfig, SessionRecordingOptions, ConfigDefaults, *Config). */
export function isConfigType(name) {
    return (
        name === 'PostHogConfig' ||
        name === 'SessionRecordingOptions' ||
        name === 'ConfigDefaults' ||
        name.endsWith('Config')
    )
}

function transformOutsideFences(markdown, transformLine) {
    let fenced = false
    return markdown
        .split('\n')
        .map((line) => {
            if (line.trimStart().startsWith('```')) {
                fenced = !fenced
                return line
            }
            return fenced ? line : transformLine(line)
        })
        .join('\n')
}

/** Rewrites relative `/docs/...` Markdown links to `https://posthog.com/docs/....md`, preserving `#anchors`. */
export function rewriteRelativeDocsLinks(markdown) {
    return transformOutsideFences(markdown, (line) =>
        line.replace(/\]\(\/docs\/([^)#\s]+)(#[^)\s]*)?\)/g, (_match, rawPath, hash = '') => {
            const cleanPath = rawPath.replace(/\/+$/, '')
            const target = cleanPath.endsWith('.md') ? cleanPath : `${cleanPath}.md`
            return `](https://posthog.com/docs/${target}${hash})`
        })
    )
}

/** Strict domain allowlist: only PostHog-owned domains, PostHog GitHub repos, or RFC 2606 example placeholders. */
export function isAllowedSkillUrl(rawUrl) {
    let parsed
    try {
        parsed = new URL(rawUrl)
    } catch {
        return false
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    if (ALLOWED_EXACT_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
        return true
    }
    if (host === 'github.com' && /^\/posthog(\/|$)/i.test(parsed.pathname)) {
        return true
    }
    return false
}

/** Strips Markdown and bare links pointing outside the strict PostHog allowlist. */
export function stripNonPostHogLinks(markdown) {
    return transformOutsideFences(markdown, (line) => {
        let out = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, url) =>
            isAllowedSkillUrl(url) ? match : label
        )
        out = out.replace(/<(https?:\/\/[^>\s]+)>/g, (match, url) => (isAllowedSkillUrl(url) ? match : ''))
        out = out.replace(/(\bSee\s+)?https?:\/\/[^\s)\]<>"'`]+/g, (match) => {
            const urlMatch = match.match(/https?:\/\/[^\s)\]<>"'`]+/)
            const url = urlMatch ? urlMatch[0].replace(/[.,;:!?]+$/, '') : ''
            return isAllowedSkillUrl(url) ? match : ''
        })
        return out
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+\|/g, ' |')
            .trimEnd()
    })
}

/** Returns any disallowed external URLs found outside fenced code blocks. */
export function findDisallowedSkillUrls(markdown) {
    const disallowed = []
    transformOutsideFences(markdown, (line) => {
        for (const match of line.matchAll(/https?:\/\/[^\s)\]<>"'`]+/g)) {
            const url = match[0].replace(/[.,;:!?]+$/, '')
            if (!isAllowedSkillUrl(url)) disallowed.push(url)
        }
        return line
    })
    return [...new Set(disallowed)]
}

/** Replaces the generated reference index block between comment markers in SKILL.md. */
export function updateSkillIndex(skillMarkdown, indexTable) {
    const startIdx = skillMarkdown.indexOf(INDEX_START)
    const endIdx = skillMarkdown.indexOf(INDEX_END)
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        throw new Error(`SKILL.md must contain ${INDEX_START} and ${INDEX_END} markers`)
    }
    const before = skillMarkdown.slice(0, startIdx + INDEX_START.length)
    const after = skillMarkdown.slice(endIdx)
    return `${before}\n${indexTable.trim()}\n${after}`
}

/** Formats a compact method or constructor signature from a TypeDoc reflection for the SKILL.md index table. */
export function formatCompactSignature(label, reflection) {
    const sig = reflection?.signatures?.[0]
    if (!sig) return label
    const params = (sig.parameters ?? [])
        .map((p) => {
            const rest = p.flags?.isRest ? '...' : ''
            const optional = p.flags?.isOptional || typeof p.defaultValue === 'string' ? '?' : ''
            return `${rest}${p.name}${optional}`
        })
        .join(', ')
    if (label === 'new PostHog(...)') return `new PostHog(${params})`
    const base = label.startsWith('PostHog.') ? `posthog.${label.slice('PostHog.'.length)}` : label
    return `${base}(${params})`
}

export function formatSkillIndexTable(entries) {
    const rows = entries.map(
        ({ file, description, signatures }) => `| \`./references/${file}\` | ${description} | ${signatures} |`
    )
    return ['| Reference file | Covers | Key signatures |', '| --- | --- | --- |', ...rows].join('\n')
}
