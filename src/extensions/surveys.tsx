import { PostHog } from '../posthog-core'
import { Survey, SurveyType } from '../posthog-surveys-types'
import { window as _window, document as _document } from '../utils/globals'
import {
    style,
    defaultSurveyAppearance,
    sendSurveyEvent,
    dismissedSurveyEvent,
    createShadow,
    getContrastingTextColor,
    SurveyContext,
    getDisplayOrderQuestions,
    getSurveySeenKey,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { h } from 'preact'
import { createWidgetShadow, createWidgetStyle } from './surveys-widget'
import { useState, useEffect, useRef, useContext, useMemo } from 'preact/hooks'
import { SurveyProvider } from './surveys/contexts/SurveyContext'
import { SurveyRenderer, WidgetRenderer } from './surveys/components/SurveyRenderer'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

// Initialize the set of surveys that are actively displayed
// const surveysToActivelyDisplay = new Set<string>()

export const handleWidgetSelector = (posthog: PostHog, survey: Survey) => {
    const selectorOnPage = survey.appearance?.widgetSelector && document.querySelector(survey.appearance.widgetSelector)
    if (selectorOnPage) {
        if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0) {
            handleWidget(posthog, survey)
        } else if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 1) {
            if (!selectorOnPage.getAttribute('PHWidgetSurveyClickListener')) {
                const surveyPopup = document
                    .querySelector(`.PostHogWidget${survey.id}`)
                    ?.shadowRoot?.querySelector(`.survey-form`) as HTMLFormElement
                selectorOnPage.addEventListener('click', () => {
                    if (surveyPopup) {
                        surveyPopup.style.display = surveyPopup.style.display === 'none' ? 'block' : 'none'
                        surveyPopup.addEventListener('PHSurveyClosed', () => (surveyPopup.style.display = 'none'))
                    }
                })
                selectorOnPage.setAttribute('PHWidgetSurveyClickListener', 'true')
            }
        }
    }
}

const canShowNextSurvey = (): boolean => {
    const surveyPopups = document.querySelectorAll(`div[class^=PostHogSurvey]`)
    if (surveyPopups.length > 0) {
        return surveyPopups[surveyPopups.length - 1].shadowRoot?.childElementCount === 1
    }
    return true
}

const handlePopoverSurvey = (posthog: PostHog, survey: Survey) => {
    const surveyWaitPeriodInDays = survey.conditions?.seenSurveyWaitPeriodInDays
    const lastSeenSurveyDate = localStorage.getItem(`lastSeenSurveyDate`)
    if (surveyWaitPeriodInDays && lastSeenSurveyDate) {
        const today = new Date()
        const diff = Math.abs(today.getTime() - new Date(lastSeenSurveyDate).getTime())
        const diffDaysFromToday = Math.ceil(diff / (1000 * 3600 * 24))
        if (diffDaysFromToday < surveyWaitPeriodInDays) {
            return
        }
    }

    if (!localStorage.getItem(getSurveySeenKey(survey))) {
        // surveysToActivelyDisplay.add(survey.id)
        const shadow = createShadow(style(survey?.appearance), survey.id)
        Preact.render(h(SurveyProvider, {}, h(SurveyRenderer, { key: 'popover-survey', posthog, survey })), shadow)
    }
}

export const callSurveys = (posthog: PostHog, forceReload: boolean = false) => {
    posthog?.getActiveMatchingSurveys((surveys) => {
        const nonAPISurveys = surveys.filter((survey) => survey.type !== 'api')

        nonAPISurveys.sort((a, b) => (a.appearance?.surveyPopupDelay || 0) - (b.appearance?.surveyPopupDelay || 0))

        nonAPISurveys.forEach((survey) => {
            // if (surveysToActivelyDisplay.size > 0) {
            //     return
            // }
            if (survey.type === SurveyType.Widget) {
                if (
                    survey.appearance?.widgetType === 'tab' &&
                    document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0
                ) {
                    handleWidget(posthog, survey)
                }
                if (survey.appearance?.widgetType === 'selector' && survey.appearance?.widgetSelector) {
                    handleWidgetSelector(posthog, survey)
                }
            }

            if (survey.type === SurveyType.Popover && canShowNextSurvey()) {
                handlePopoverSurvey(posthog, survey)
            }
        })
    }, forceReload)
}

export const renderSurveysPreview = ({
    survey,
    parentElement,
    previewPageIndex,
    forceDisableHtml,
}: {
    survey: Survey
    parentElement: HTMLElement
    previewPageIndex: number
    forceDisableHtml?: boolean
}) => {
    const surveyStyleSheet = style(survey.appearance)
    const styleElement = Object.assign(document.createElement('style'), { innerText: surveyStyleSheet })

    // Remove previously attached <style>
    Array.from(parentElement.children).forEach((child) => {
        if (child instanceof HTMLStyleElement) {
            parentElement.removeChild(child)
        }
    })

    parentElement.appendChild(styleElement)
    const textColor = getContrastingTextColor(
        survey.appearance?.backgroundColor || defaultSurveyAppearance.backgroundColor || 'white'
    )

    Preact.render(
        h(
            SurveyProvider,
            {},
            h(SurveyRenderer, {
                key: 'surveys-render-preview',
                survey,
                forceDisableHtml,
                style: {
                    position: 'relative',
                    right: 0,
                    borderBottom: `1px solid ${survey.appearance?.borderColor}`,
                    borderRadius: 10,
                    color: textColor,
                },
                previewPageIndex,
            })
        ),
        parentElement
    )
}

export const renderFeedbackWidgetPreview = ({
    survey,
    root,
    forceDisableHtml,
}: {
    survey: Survey
    root: HTMLElement
    forceDisableHtml?: boolean
}) => {
    const widgetStyleSheet = createWidgetStyle(survey.appearance?.widgetColor)
    const styleElement = Object.assign(document.createElement('style'), { innerText: widgetStyleSheet })
    root.appendChild(styleElement)
    Preact.render(
        h(
            SurveyProvider,
            {},
            h(WidgetRenderer, {
                key: 'feedback-render-preview',
                forceDisableHtml,
                survey,
                readOnly: true,
            })
        ),
        root
    )
}

// This is the main exported function
export function generateSurveys(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run surveys without a window environment
    if (!document || !window) {
        return
    }
    callSurveys(posthog, true)

    // recalculate surveys every second to check if URL or selectors have changed
    setInterval(() => {
        callSurveys(posthog, false)
    }, 1000)
}

const handleWidget = (posthog: PostHog, survey: Survey) => {
    const shadow = createWidgetShadow(survey)
    const surveyStyleSheet = style(survey.appearance)
    shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
    Preact.render(h(SurveyProvider, {}, h(WidgetRenderer, { key: 'feedback-survey', posthog, survey })), shadow)
}
