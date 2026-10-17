/** What an email template file publishes. A file has no plain-text part. */
export interface TemplateFileContent {
  subject: string
  preheader?: string
  html: string
}

const COMMENT_START = '<!--'
const COMMENT_END = '-->'
const TAG_NAME = /<(?:title|meta)\b/iy
const TITLE_OPEN = /<title\b[^>]*>/iy
const TITLE_CLOSE = /<\/title\s*>/gi
const META_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/iy
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g
const NAMED_CHARACTERS: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Reads the subject from `<title>` and the preheader from `<meta name="preheader">`. The HTML is the whole file. */
export function parseTemplateFile(html: string): TemplateFileContent {
  const { title, preheader } = scanHead(html)
  return { subject: subjectOf(title ?? ''), ...(preheader !== undefined && { preheader }), html }
}

/**
 * One left-to-right pass in linear time: a comment hides the tags in it, a title hides the tags in it,
 * and a quoted attribute can hold `>` or `<!--`. The first title and the first preheader win. A tag that never
 * closes holds the rest of the file, as in a browser.
 */
function scanHead(html: string): { title?: string; preheader?: string } {
  let title: string | undefined
  let preheader: string | undefined
  let titleCanClose = true
  let position = html.indexOf('<')
  while (position !== -1 && (title === undefined || preheader === undefined)) {
    let next = position + 1
    if (html.startsWith(COMMENT_START, position)) {
      const commentEnd = html.indexOf(COMMENT_END, position + COMMENT_START.length)
      if (commentEnd === -1) {
        break
      }
      next = commentEnd + COMMENT_END.length
    } else if (matchesAt(TAG_NAME, html, position)) {
      const isTitle = html.slice(position + 1, position + 6).toLowerCase() === 'title'
      const tag = isTitle ? TITLE_OPEN : META_TAG
      if (!matchesAt(tag, html, position)) {
        break
      }
      next = tag.lastIndex
      if (isTitle && titleCanClose) {
        TITLE_CLOSE.lastIndex = next
        const close = TITLE_CLOSE.exec(html)
        if (close) {
          title ??= html.slice(next, close.index)
          next = TITLE_CLOSE.lastIndex
        } else {
          titleCanClose = false
        }
      } else if (!isTitle) {
        preheader ??= preheaderOf(html.slice(position, next))
      }
    }
    position = html.indexOf('<', next)
  }
  return { title, preheader }
}

function matchesAt(pattern: RegExp, html: string, position: number): boolean {
  pattern.lastIndex = position
  return pattern.test(html)
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
