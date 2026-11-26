const ESCAPED_WHITESPACE = new Set(['n', 't', 'r', 'f', 'b'])

const MAX_KEY_DECODE_LEVELS = 16

// Tests a key as written in raw text at every unescaping level, since the text can nest it any number of times
// (`refresh_tok\\u0065n`), and a key with a literal backslash (`C:\\temp\\token`) reads right only before the
// extra level. A key still escaped after the last level counts as a credential.
function keyIsCredential(raw: string, isCredentialName: (name: string) => boolean): boolean {
  let end = raw.length
  while (end > 0 && raw[end - 1] === '\\') {
    end--
  }
  let key = raw.slice(0, end)
  for (let level = 0; ; level++) {
    if (isCredentialName(key)) {
      return true
    }
    if (!key.includes('\\')) {
      return false
    }
    if (level === MAX_KEY_DECODE_LEVELS) {
      return true
    }
    try {
      key = JSON.parse(`"${key}"`)
    } catch {
      return false
    }
  }
}

// The index just before an escaped separator (`\\n`, `\\u0020`) that ends at `end`, or `end` when there is none.
function beforeEscapedSeparator(text: string, end: number): number {
  let start = -1
  if (ESCAPED_WHITESPACE.has(text[end]) && text[end - 1] === '\\') {
    start = end - 1
  } else if (text[end - 4] === 'u' && text[end - 5] === '\\') {
    const hex = text.slice(end - 3, end + 1)
    if (/^[0-9a-f]{4}$/i.test(hex) && isSeparator(String.fromCharCode(parseInt(hex, 16)))) {
      start = end - 5
    }
  }
  if (start === -1) {
    return end
  }
  while (start >= 0 && text[start] === '\\') {
    start--
  }
  return start
}

// Any whitespace or control character, including ones JSON rejects, so malformed text cannot hide a key.
const isSeparator = (char: string): boolean => char <= ' ' || char.trim() === ''

// Reads the quoted name before each `:`, at any nesting level (`"key":` or `\\"key\\":`), past separators that may
// themselves be escaped (`\\n`). Every walk back stops at the previous quote, so no character is read twice.
function namesCredentialKey(raw: string, isCredentialName: (name: string) => boolean): boolean {
  // Some serializers write the quotes and colon of embedded JSON as `\\u0022` and `\\u003a`.
  const text = raw.replace(/\\u00(22|3a)/gi, (_escape, hex: string) => (hex === '22' ? '"' : ':'))
  for (let colon = text.indexOf(':'); colon !== -1; colon = text.indexOf(':', colon + 1)) {
    // A colon written as `\\u003a` one level down keeps a backslash in front once decoded.
    let close = colon - 1
    while (close >= 0 && text[close] === '\\') {
      close--
    }
    while (close >= 0) {
      const next = isSeparator(text[close]) ? close - 1 : beforeEscapedSeparator(text, close)
      if (next === close) {
        break
      }
      close = next
    }
    // Single quotes cover Python-style output, such as `str(dict)`.
    const quote = text[close]
    if (close <= 0 || (quote !== '"' && quote !== "'")) {
      continue
    }
    const open = text.lastIndexOf(quote, close - 1)
    if (open === -1) {
      continue
    }
    if (keyIsCredential(text.slice(open + 1, close), isCredentialName)) {
      return true
    }
  }
  return false
}

// A form field or URL query parameter, such as in an OAuth token response, `?access_token=` or a `#access_token=`
// fragment, also after a status line or label. Names exclude every character that can start one, so each character is
// read by at most one match.
const FORM_FIELD = /(?:^|[?&#;\s'"])([^&=?#;\s'"]+)=/g

function namesCredentialField(text: string, isCredentialName: (name: string) => boolean): boolean {
  for (const [, name] of text.matchAll(FORM_FIELD)) {
    if (isCredentialName(name)) {
      return true
    }
  }
  return false
}

// Decodes every `%XX` run, keeping a run that is not valid UTF-8 as single bytes, so one bad escape cannot hide the
// rest of a name. `+` is a space in form encoding.
function percentDecode(text: string): string {
  return text.replace(/\+/g, ' ').replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run.replace(/%([0-9a-f]{2})/gi, (_escape, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    }
  })
}

/**
 * Whether raw text names a credential as a quoted key (`"key":` at any nesting level, also single-quoted) or as a form
 * field or query parameter. Percent-encoded text is decoded and scanned again at each level, so a form value holding
 * encoded JSON (`body=%7B%22refresh_token%22...`) is read like plain text. Text still encoded after the last level
 * counts as naming one.
 */
export function namesCredential(text: string, isCredentialName: (name: string) => boolean): boolean {
  for (let level = 0; level <= MAX_KEY_DECODE_LEVELS; level++) {
    if (namesCredentialKey(text, isCredentialName) || namesCredentialField(text, isCredentialName)) {
      return true
    }
    const decoded = percentDecode(text)
    if (decoded === text) {
      return false
    }
    text = decoded
  }
  return true
}
