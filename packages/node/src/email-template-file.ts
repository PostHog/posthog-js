/** What an email template file publishes. A file has no plain-text part. */
export interface TemplateFileContent {
  subject: string
  preheader?: string
  html: string
}

const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
const META_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED_CHARACTERS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Reads the subject from `<title>` and the preheader from `<meta name="preheader">`. The HTML is the whole file. */
export function parseTemplateFile(html: string): TemplateFileContent {
  const markup = html.replace(COMMENT, '')
  const preheader = preheaderOf(markup)
  return { subject: subjectOf(markup), ...(preheader !== undefined && { preheader }), html }
}

function subjectOf(html: string): string {
  const title = TITLE.exec(html)?.[1] ?? ''
  return decodeCharacterReferences(title)
    .replace(/[\t\n\f\r ]+/g, ' ')
    .trim()
}

function preheaderOf(html: string): string | undefined {
  for (const tag of html.match(META_TAG) ?? []) {
    const attributes = attributesOf(tag)
    if (attributes.get('name')?.toLowerCase() === 'preheader') {
      return decodeCharacterReferences(attributes.get('content') ?? '')
    }
  }
  return undefined
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of tag.slice('<meta'.length).matchAll(ATTRIBUTE)) {
    attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted ?? '')
  }
  return attributes
}

function decodeCharacterReferences(value: string): string {
  return value.replace(CHARACTER_REFERENCE, (reference, decimal, hex, named) => {
    if (named) {
      return NAMED_CHARACTERS[named]
    }
    const codePoint = decimal ? parseInt(decimal, 10) : parseInt(hex, 16)
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : reference
  })
}
