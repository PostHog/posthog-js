import { render, JSX } from 'preact'

import { ProductTourStep, ProductTourAppearance } from '../../posthog-product-tours-types'
import { document as _document } from '../../utils/globals'
import { ProductTourSurveyStepInner } from './components/ProductTourSurveyStepInner'
import { ProductTourTooltipInner } from './components/ProductTourTooltipInner'
import { getProductTourStylesheet, addProductTourCSSVariablesToElement } from './product-tours-utils'

const document = _document as Document

export interface RenderProductTourPreviewOptions {
    step: ProductTourStep
    appearance?: ProductTourAppearance
    parentElement: HTMLElement
    stepIndex?: number
    totalSteps?: number
    style?: JSX.CSSProperties
}

export function renderProductTourPreview({
    step,
    appearance,
    parentElement,
    stepIndex = 0,
    totalSteps = 1,
    style,
}: RenderProductTourPreviewOptions): void {
    parentElement.innerHTML = ''

    const shadowHost = document.createElement('div')
    addProductTourCSSVariablesToElement(shadowHost, appearance)
    parentElement.appendChild(shadowHost)
    const shadow = shadowHost.attachShadow({ mode: 'open' })

    const stylesheet = getProductTourStylesheet()
    if (stylesheet) {
        shadow.appendChild(stylesheet)
    }

    const renderTarget = document.createElement('div')
    shadow.appendChild(renderTarget)

    const isSurveyStep = step.type === 'survey'
    const tooltipClass = isSurveyStep ? 'ph-tour-tooltip ph-tour-survey-step' : 'ph-tour-tooltip'

    render(
        <div class="ph-tour-container">
            <div
                class={tooltipClass}
                style={{
                    position: 'relative',
                    animation: 'none',
                    ...(step.maxWidth && { width: `${step.maxWidth}px`, maxWidth: `${step.maxWidth}px` }),
                    ...style,
                }}
            >
                {isSurveyStep ? (
                    <ProductTourSurveyStepInner
                        step={step}
                        appearance={appearance}
                        stepIndex={stepIndex}
                        totalSteps={totalSteps}
                    />
                ) : (
                    <ProductTourTooltipInner
                        step={step}
                        appearance={appearance}
                        stepIndex={stepIndex}
                        totalSteps={totalSteps}
                    />
                )}
            </div>
        </div>,
        renderTarget
    )
}
