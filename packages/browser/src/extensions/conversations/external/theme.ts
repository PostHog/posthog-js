import type { ConversationsTheme, ConversationsThemeColors } from '../../../posthog-conversations-types'
import { createLogger } from '@posthog/browser-common/utils/logger'

const logger = createLogger('[Conversations]')

export const WIDGET_CONTAINER_ID = 'ph-conversations-widget-container'

export const DEFAULT_PRIMARY_COLOR = '#5375ff'

export const DEFAULT_ON_PRIMARY_COLOR = getContrastTextColor(DEFAULT_PRIMARY_COLOR)

export type ThemeToken =
    | 'primary'
    | 'on-primary'
    | 'bg'
    | 'surface'
    | 'text'
    | 'muted'
    | 'border'
    | 'agent-bubble'
    | 'font'
    | 'radius'
    | 'launcher-shadow'
    | 'window-shadow'

type ThemeValues = Partial<Record<ThemeToken, string>>

const DARK_COLORS: Required<Omit<ConversationsThemeColors, 'primary' | 'primaryText'>> = {
    background: '#18181b',
    surface: '#27272a',
    text: '#fafafa',
    mutedText: '#a1a1aa',
    border: '#3f3f46',
    agentBubble: '#27272a',
}

const KEYFRAMES =
    '@keyframes ph-conv-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}' +
    '@keyframes ph-conv-spin{to{transform:rotate(360deg)}}'

/** `var(--ph-conv-<token>, <fallback>)`. The fallback is the light value used when no theme sets the token. */
export const cssVar = (token: ThemeToken, fallback: string): string => `var(--ph-conv-${token}, ${fallback})`

/**
 * Calculate contrasting text color (black or white) based on background brightness
 * Uses HSP (Highly Sensitive Purity) brightness formula
 */
export function getContrastTextColor(hexColor: string): string {
    const hex = hexColor.replace(/^#/, '')
    const fullHex = hex.length === 3 ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] : hex

    const r = parseInt(fullHex.slice(0, 2), 16)
    const g = parseInt(fullHex.slice(2, 4), 16)
    const b = parseInt(fullHex.slice(4, 6), 16)

    // HSP brightness formula
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b))
    return hsp > 127.5 ? '#020617' : 'white'
}

/** Merge a theme patch over a base theme. `dark` is merged one level deeper. */
export function mergeThemes(base: ConversationsTheme | undefined, patch: ConversationsTheme | undefined) {
    return { ...base, ...patch, dark: { ...base?.dark, ...patch?.dark } }
}

function colorValues(colors: ConversationsThemeColors, primary: string, primaryText: string | undefined): ThemeValues {
    return {
        primary,
        'on-primary': primaryText || getContrastTextColor(primary),
        bg: colors.background,
        surface: colors.surface,
        text: colors.text,
        muted: colors.mutedText,
        border: colors.border,
        'agent-bubble': colors.agentBubble,
    }
}

function declarations(values: ThemeValues): string {
    let css = ''
    for (const token in values) {
        const value = values[token as ThemeToken]
        if (!value) {
            continue
        }
        // Values are written into a stylesheet, so they must not be able to end the declaration or rule.
        if (/[{};<>]/.test(value)) {
            logger.warn(`Ignoring invalid conversations theme value for --ph-conv-${token}`)
            continue
        }
        css += `--ph-conv-${token}:${value};`
    }
    return css
}

/**
 * Build the widget's theme stylesheet.
 *
 * Rules use `:where()` so they have zero specificity: any rule a customer writes for the
 * container overrides the SDK's values.
 */
export function buildThemeCss(remoteColor: string | undefined, theme: ConversationsTheme): string {
    const selector = `:where(#${WIDGET_CONTAINER_ID})`
    const primary = theme.primary || remoteColor || DEFAULT_PRIMARY_COLOR
    const light = declarations({
        ...colorValues(theme, primary, theme.primaryText),
        font: theme.fontFamily,
        radius: theme.borderRadius,
        'launcher-shadow': theme.launcherShadow,
        'window-shadow': theme.windowShadow,
    })
    const darkColors: ConversationsThemeColors = { ...theme.dark }
    for (const key in DARK_COLORS) {
        const colorKey = key as keyof typeof DARK_COLORS
        darkColors[colorKey] = darkColors[colorKey] || DARK_COLORS[colorKey]
    }
    // Without its own primary, the dark scheme keeps the light primary and its text color.
    const darkPrimaryText = darkColors.primary ? darkColors.primaryText : darkColors.primaryText || theme.primaryText
    const dark =
        declarations(colorValues(darkColors, darkColors.primary || primary, darkPrimaryText)) + 'color-scheme:dark;'

    let css: string
    switch (theme.colorScheme) {
        case 'dark':
            css = `${selector}{${light}${dark}}`
            break
        case 'auto':
            css = `${selector}{${light}}@media (prefers-color-scheme: dark){${selector}{${dark}}}`
            break
        default:
            css = `${selector}{${light}}`
    }
    return css + KEYFRAMES
}
