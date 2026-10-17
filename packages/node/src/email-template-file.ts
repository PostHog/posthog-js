/** What an email template file publishes. A file has no plain-text part. */
export interface TemplateFileContent {
  subject: string
  preheader?: string
  html: string
}

// One left-to-right scan, so a comment hides the tags in it and a quoted attribute can hold `<!--` or `>`.
const ELEMENT = /<!--[\s\S]*?(?:-->|$)|<title\b[^>]*>([\s\S]*?)<\/title\s*>|(<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>)/gi
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED_CHARACTERS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Reads the subject from `<title>` and the preheader from `<meta name="preheader">`. The HTML is the whole file. */
export function parseTemplateFile(html: string): TemplateFileContent {
  let title: string | undefined
  let preheader: string | undefined
  for (const [, titleText, metaTag] of html.matchAll(ELEMENT)) {
    title ??= titleText
    if (metaTag !== undefined && preheader === undefined) {
      preheader = preheaderOf(metaTag)
    }
  }
  return { subject: subjectOf(title ?? ''), ...(preheader !== undefined && { preheader }), html }
}

function subjectOf(title: string): string {
  return decodeCharacterReferences(title)
    .replace(/[\t\n\f\r ]+/g, ' ')
    .trim()
}

function preheaderOf(metaTag: string): string | undefined {
  const attributes = attributesOf(metaTag)
  return attributes.get('name')?.toLowerCase() === 'preheader'
    ? decodeCharacterReferences(attributes.get('content') ?? '')
    : undefined
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
