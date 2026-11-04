import createDOMPurify from 'dompurify'

// Match nh3_clean_with_allow_list in PostHog/posthog's products/surveys/backend/api/survey.py.
const allowedTags = [
    'a',
    'abbr',
    'acronym',
    'area',
    'article',
    'aside',
    'b',
    'bdi',
    'bdo',
    'blockquote',
    'br',
    'caption',
    'center',
    'cite',
    'code',
    'col',
    'colgroup',
    'data',
    'dd',
    'del',
    'details',
    'dfn',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'i',
    'img',
    'ins',
    'kbd',
    'li',
    'map',
    'mark',
    'nav',
    'ol',
    'p',
    'pre',
    'q',
    'rp',
    'rt',
    'rtc',
    'ruby',
    's',
    'samp',
    'small',
    'span',
    'strike',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'time',
    'tr',
    'tt',
    'u',
    'ul',
    'var',
    'wbr',
]
const globalAttributes = ['style', 'lang', 'title', 'width', 'height']
const tableCellAttributes = [
    'abbr',
    'align',
    'axis',
    'bgcolor',
    'char',
    'charoff',
    'colspan',
    'headers',
    'height',
    'nowrap',
    'rowspan',
    'scope',
    'valign',
    'width',
]
const allowedAttributes: Record<string, string[]> = {
    // Retain explicit rel tokens so an author's noreferrer choice is not lost.
    a: ['href', 'hreflang', 'target', 'rel'],
    bdo: ['dir'],
    blockquote: ['cite'],
    col: ['align', 'char', 'charoff', 'span'],
    colgroup: ['align', 'char', 'charoff', 'span'],
    del: ['cite', 'datetime'],
    hr: ['align', 'size', 'width'],
    img: ['align', 'alt', 'height', 'src', 'width'],
    ins: ['cite', 'datetime'],
    ol: ['start', 'type'],
    q: ['cite'],
    table: ['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'frame', 'rules', 'summary', 'width'],
    tbody: ['align', 'char', 'charoff', 'valign'],
    td: tableCellAttributes,
    tfoot: ['align', 'char', 'charoff', 'valign'],
    th: tableCellAttributes,
    thead: ['align', 'char', 'charoff', 'valign'],
    tr: ['align', 'bgcolor', 'char', 'charoff', 'valign'],
}

let surveySanitizer: ReturnType<typeof createDOMPurify> | undefined

export function sanitizeSurveyHtml(html: string): string {
    const sanitized = (surveySanitizer ??= createDOMPurify()).sanitize(html, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: [],
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
        ADD_ATTR: (attributeName, tagName) =>
            globalAttributes.indexOf(attributeName) !== -1 ||
            (Object.prototype.hasOwnProperty.call(allowedAttributes, tagName) &&
                (allowedAttributes[tagName] || []).indexOf(attributeName) !== -1),
        RETURN_DOM_FRAGMENT: true,
    })
    const links = sanitized.querySelectorAll<HTMLAnchorElement>('a')
    for (let i = 0; i < links.length; i++) {
        links.item(i).relList.add('noopener')
    }
    const container = document.createElement('div')
    container.appendChild(sanitized)
    return container.innerHTML
}
