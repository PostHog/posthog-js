import { h, ComponentChildren } from 'preact'
import { ProductTourStep } from '../../../posthog-product-tours-types'
import { getStepHtml } from '../product-tours-utils'
import { cancelSVG } from '../../surveys/icons'

export interface ProductTourBannerProps {
    step: ProductTourStep
    onDismiss: () => void
    onTriggerTour?: () => void
}

interface BannerWrapperProps {
    class: string
    children: ComponentChildren
}

interface LinkWrapperProps extends BannerWrapperProps {
    href: string
}

interface ButtonWrapperProps extends BannerWrapperProps {
    onClick: () => void
}

function LinkWrapper({ class: className, href, children }: LinkWrapperProps): h.JSX.Element {
    return (
        <a class={className} href={href} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    )
}

function ButtonWrapper({ class: className, onClick, children }: ButtonWrapperProps): h.JSX.Element {
    return (
        <div
            class={className}
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onClick()
                }
            }}
            style={{ cursor: 'pointer' }}
        >
            {children}
        </div>
    )
}

function StaticWrapper({ class: className, children }: BannerWrapperProps): h.JSX.Element {
    return <div class={className}>{children}</div>
}

export function ProductTourBanner({ step, onDismiss, onTriggerTour }: ProductTourBannerProps): h.JSX.Element {
    const config = step.bannerConfig ?? { behavior: 'sticky' }
    const action = config.action

    const classNames = ['ph-tour-banner', config.behavior === 'sticky' && 'ph-tour-banner--sticky']
        .filter(Boolean)
        .join(' ')

    const content = (
        <>
            <div class="ph-tour-banner-content" dangerouslySetInnerHTML={{ __html: getStepHtml(step) }} />

            <button
                class="ph-tour-banner-dismiss"
                onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onDismiss()
                }}
                aria-label="Close banner"
            >
                {cancelSVG}
            </button>
        </>
    )

    if (action?.type === 'link' && action.link) {
        return (
            <LinkWrapper class={classNames} href={action.link}>
                {content}
            </LinkWrapper>
        )
    }

    if (action?.type === 'trigger_tour' && onTriggerTour) {
        return (
            <ButtonWrapper class={classNames} onClick={onTriggerTour}>
                {content}
            </ButtonWrapper>
        )
    }

    return <StaticWrapper class={classNames}>{content}</StaticWrapper>
}
