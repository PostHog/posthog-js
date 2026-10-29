import {
    buildThemeCss,
    cssVar,
    getContrastTextColor,
    mergeThemes,
} from '../../../extensions/conversations/external/theme'
import { getStyles } from '../../../extensions/conversations/external/components/styles'

const SELECTOR = ':where(#ph-conversations-widget-container)'

const lightBlock = (css: string): string => {
    const start = css.indexOf(`${SELECTOR}{`) + SELECTOR.length + 1
    return css.slice(start, css.indexOf('}', start))
}

describe('conversations theme', () => {
    describe('buildThemeCss', () => {
        it('falls back to the default primary color and computes the text color on it', () => {
            const css = buildThemeCss(undefined, {})

            expect(lightBlock(css)).toBe('--ph-conv-primary:#5375ff;--ph-conv-on-primary:#020617;')
        })

        it('uses the remote config color as the primary color', () => {
            expect(lightBlock(buildThemeCss('#007bff', {}))).toContain('--ph-conv-primary:#007bff;')
        })

        it('lets the client theme override the remote config color', () => {
            const css = buildThemeCss('#007bff', { primary: '#fde047' })

            expect(lightBlock(css)).toContain('--ph-conv-primary:#fde047;')
            expect(lightBlock(css)).toContain('--ph-conv-on-primary:#020617;')
        })

        it('uses primaryText instead of the computed contrast color', () => {
            expect(lightBlock(buildThemeCss(undefined, { primaryText: '#123456' }))).toContain(
                '--ph-conv-on-primary:#123456;'
            )
        })

        it('writes only the light tokens a theme sets, leaving the rest to the inline fallbacks', () => {
            const css = buildThemeCss(undefined, {
                background: '#000',
                fontFamily: 'Inter, sans-serif',
                borderRadius: '16px',
                launcherShadow: 'none',
                windowShadow: '0 0 0 1px #ccc',
            })

            expect(lightBlock(css)).toBe(
                '--ph-conv-primary:#5375ff;--ph-conv-on-primary:#020617;--ph-conv-bg:#000;' +
                    '--ph-conv-font:Inter, sans-serif;--ph-conv-radius:16px;' +
                    '--ph-conv-launcher-shadow:none;--ph-conv-window-shadow:0 0 0 1px #ccc;'
            )
            expect(css).not.toContain('--ph-conv-text')
        })

        it('emits no dark colors for the default light scheme', () => {
            const css = buildThemeCss(undefined, { dark: { background: '#111' } })

            expect(css).not.toContain('#111')
            expect(css).not.toContain('prefers-color-scheme')
        })

        it('applies built-in dark colors after the light ones for the dark scheme', () => {
            const css = buildThemeCss(undefined, { colorScheme: 'dark', background: '#fff' })
            const block = lightBlock(css)

            expect(block.indexOf('--ph-conv-bg:#fff;')).toBeLessThan(block.indexOf('--ph-conv-bg:#18181b;'))
            expect(block).toContain('--ph-conv-text:#fafafa;')
        })

        it('wraps dark colors in a prefers-color-scheme media query for the auto scheme', () => {
            const css = buildThemeCss(undefined, { colorScheme: 'auto', dark: { background: '#111' } })

            expect(lightBlock(css)).not.toContain('#111')
            expect(css).toContain(`@media (prefers-color-scheme: dark){${SELECTOR}{`)
            expect(css).toContain('--ph-conv-bg:#111;')
            expect(css).toContain('--ph-conv-border:#3f3f46;')
        })

        it('uses the dark primary color in the dark scheme and computes its text color', () => {
            const css = buildThemeCss('#1d4ed8', { colorScheme: 'dark', dark: { primary: '#f9fafb' } })

            expect(css).toContain('--ph-conv-primary:#f9fafb;--ph-conv-on-primary:#020617;')
        })

        it('keeps the light primary color and its text color in the dark scheme when no dark primary is set', () => {
            const css = buildThemeCss('#1d4ed8', { colorScheme: 'auto', primaryText: '#ffff00' })
            const media = css.slice(css.indexOf('@media'))

            expect(media).toContain('--ph-conv-primary:#1d4ed8;--ph-conv-on-primary:#ffff00;')
        })

        it('computes the dark text color from the dark primary rather than reusing the light primaryText', () => {
            const css = buildThemeCss(undefined, {
                colorScheme: 'dark',
                primaryText: '#ffffff',
                dark: { primary: '#f9fafb' },
            })

            expect(css).toContain('--ph-conv-primary:#f9fafb;--ph-conv-on-primary:#020617;')
        })

        it('switches native controls to dark only while the dark scheme applies', () => {
            expect(buildThemeCss(undefined, {})).not.toContain('color-scheme')
            expect(lightBlock(buildThemeCss(undefined, { colorScheme: 'dark' }))).toContain('color-scheme:dark;')

            const auto = buildThemeCss(undefined, { colorScheme: 'auto' })
            expect(lightBlock(auto)).not.toContain('color-scheme')
            expect(auto.slice(auto.indexOf('@media'))).toContain('color-scheme:dark;')
        })

        it.each(['red;} body{display:none', 'x{', '</style>'])(
            'drops a value that could escape the rule: %s',
            (value) => {
                const css = buildThemeCss(undefined, { background: value })

                expect(css).not.toContain('--ph-conv-bg')
                expect(css).not.toContain('display:none')
            }
        )

        it('defines the keyframes the widget animates with', () => {
            const css = buildThemeCss(undefined, {})

            expect(css).toContain('@keyframes ph-conv-fade-in')
            expect(css).toContain('@keyframes ph-conv-spin')
        })
    })

    describe('mergeThemes', () => {
        it('merges dark colors one level deep', () => {
            expect(
                mergeThemes(
                    { primary: '#111', dark: { primary: '#222', background: '#333' } },
                    { colorScheme: 'auto', dark: { background: '#444' } }
                )
            ).toEqual({ primary: '#111', colorScheme: 'auto', dark: { primary: '#222', background: '#444' } })
        })

        it('resets a value that the patch sets to undefined', () => {
            expect(mergeThemes({ primary: '#111' }, { primary: undefined }).primary).toBeUndefined()
        })
    })

    describe('getContrastTextColor', () => {
        it.each([
            ['#ffffff', '#020617'],
            ['#fff', '#020617'],
            ['#000000', 'white'],
            ['#1d4ed8', 'white'],
            ['#5375ff', '#020617'],
        ])('returns readable text for %s', (color, expected) => {
            expect(getContrastTextColor(color)).toBe(expected)
        })
    })

    describe('widget styles', () => {
        it('reads themeable values from custom properties with the light theme as fallback', () => {
            const styles = getStyles()

            expect(styles.button.background).toBe(cssVar('primary', '#5375ff'))
            expect(styles.button.color).toBe(cssVar('on-primary', '#020617'))
            expect(styles.button.filter).toMatch(/^var\(--ph-conv-launcher-shadow, drop-shadow\(/)
            expect(styles.window.background).toBe('var(--ph-conv-bg, white)')
            expect(styles.window.borderRadius).toBe('var(--ph-conv-radius, 10px)')
            expect(styles.messageContentAgent.color).toBe('var(--ph-conv-text, #020617)')
            expect(styles.widget.fontFamily).toMatch(/^var\(--ph-conv-font, -apple-system/)
        })

        it('animates with the keyframes defined by the theme stylesheet', () => {
            const styles = getStyles()

            expect(styles.message.animation).toContain('ph-conv-fade-in')
            expect(styles.loadingSpinner.animation).toContain('ph-conv-spin')
        })
    })
})
