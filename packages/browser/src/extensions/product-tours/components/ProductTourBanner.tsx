import { h } from 'preact'
import { ProductTourStep } from '../../../posthog-product-tours-types'
import { getStepHtml } from '../product-tours-utils'
import { cancelSVG } from '../../surveys/icons'

export interface ProductTourBannerProps {
    step: ProductTourStep
    onDismiss: () => void
    onBannerClick?: () => void
}

export function ProductTourBanner({ step, onDismiss, onBannerClick }: ProductTourBannerProps): h.JSX.Element {
    const config = step.bannerConfig ?? { behavior: 'sticky' }
    const hasClickAction = config.action && config.action.type !== 'none'

    const classNames = ['ph-tour-banner', config.behavior === 'sticky' && 'ph-tour-banner--sticky']
        .filter(Boolean)
        .join(' ')

    const handleContentClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement | null
        if (target?.closest('a')) {
            e.stopPropagation()
        }
    }

    return (
        <div
            class={classNames}
            onClick={hasClickAction ? onBannerClick : undefined}
            style={{ cursor: hasClickAction ? 'pointer' : 'default' }}
        >
            <div
                class="ph-tour-banner-content"
                onClick={hasClickAction ? handleContentClick : undefined}
                dangerouslySetInnerHTML={{ __html: getStepHtml(step) }}
            />

            <button
                class="ph-tour-banner-dismiss"
                onClick={(e) => {
                    e.stopPropagation()
                    onDismiss()
                }}
                aria-label="Close banner"
            >
                {cancelSVG}
            </button>
        </div>
    )
}
