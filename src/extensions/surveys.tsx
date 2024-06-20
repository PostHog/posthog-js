import { PostHog } from '../posthog-core'
import { Survey, SurveyType } from '../posthog-surveys-types'

import { window as _window, document as _document } from '../utils/globals'
import {
    style,
    defaultSurveyAppearance,
    createShadow,
    getContrastingTextColor,
    getSurveySeenKey,
} from './surveys/surveys-utils'
import * as Preact from 'preact'
import { createWidgetShadow, createWidgetStyle } from './surveys-widget'
import { FeedbackWidget } from './surveys/components/FeedbackWidget'
import { SurveyPopup } from './surveys/components/SurveyPopup'

// We cast the types here which is dangerous but protected by the top level generateSurveys call
const window = _window as Window & typeof globalThis
const document = _document as Document

export class SurveyManager {
    private posthog: PostHog
    private surveysInFocus: Set<string>

    constructor(posthog: PostHog) {
        this.posthog = posthog
        // We use a set to keep track of surveys in focus to prevent multiple surveys from showing at the same time
        // This is important for correctly displaying popover surveys with a delay, where we want to show them
        // in order of their delay, rather than evaluate them all at once.
        // NB: This set should only ever have 0 or 1 items in it at a time.
        this.surveysInFocus = new Set<string>()
    }

    private canShowNextEventBasedSurvey = (): boolean => {
        // with event based surveys, we need to show the next survey without reloading the page.
        // A simple check for div elements with the class name pattern of PostHogSurvey_xyz doesn't work here
        // because preact leaves behind the div element for any surveys responded/dismissed with a <style> node.
        // To alleviate this, we check the last div in the dom and see if it has any elements other than a Style node.
        // if the last PostHogSurvey_xyz div has only one style node, we can show the next survey in the queue
        // without reloading the page.
        const surveyPopups = document.querySelectorAll(`div[class^=PostHogSurvey]`)
        if (surveyPopups.length > 0) {
            return surveyPopups[surveyPopups.length - 1].shadowRoot?.childElementCount === 1
        }
        return true
    }

    private handlePopoverSurvey = (survey: Survey): void => {
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
            this.addSurveyToFocus(survey.id)
            const shadow = createShadow(style(survey?.appearance), survey.id)
            Preact.render(
                <SurveyPopup
                    key={'popover-survey'}
                    posthog={this.posthog}
                    survey={survey}
                    removeSurveyFromFocus={this.removeSurveyFromFocus}
                />,
                shadow
            )
        }
    }

    private handleWidget = (survey: Survey): void => {
        const shadow = createWidgetShadow(survey)
        const surveyStyleSheet = style(survey.appearance)
        shadow.appendChild(Object.assign(document.createElement('style'), { innerText: surveyStyleSheet }))
        Preact.render(
            <FeedbackWidget
                key={'feedback-survey'}
                posthog={this.posthog}
                survey={survey}
                removeSurveyFromFocus={this.removeSurveyFromFocus}
            />,
            shadow
        )
    }

    private handleWidgetSelector = (survey: Survey): void => {
        const selectorOnPage =
            survey.appearance?.widgetSelector && document.querySelector(survey.appearance.widgetSelector)
        if (selectorOnPage) {
            if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0) {
                this.handleWidget(survey)
            } else if (document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 1) {
                // we have to check if user selector already has a survey listener attached to it because we always have to check if it's on the page or not
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

    public callSurveysAndEvaluateDisplayLogic = (forceReload: boolean = false): void => {
        this.posthog?.getActiveMatchingSurveys((surveys) => {
            const nonAPISurveys = surveys.filter((survey) => survey.type !== 'api')

            // Create a queue of surveys sorted by their appearance delay, where surveys with no delay come first,
            // followed by surveys with a delay in ascending order.
            // This lets us show surveys with no delay first, and then show the rest in order of their delay.
            const nonAPISurveyQueue = nonAPISurveys.sort(
                (a, b) => (a.appearance?.surveyPopupDelaySeconds || 0) - (b.appearance?.surveyPopupDelaySeconds || 0)
            )

            nonAPISurveyQueue.forEach((survey) => {
                // We only evaluate the display logic for one survey at a time
                if (this.surveysInFocus.size > 0) {
                    return
                }
                if (survey.type === SurveyType.Widget) {
                    if (
                        survey.appearance?.widgetType === 'tab' &&
                        document.querySelectorAll(`.PostHogWidget${survey.id}`).length === 0
                    ) {
                        this.handleWidget(survey)
                    }
                    if (survey.appearance?.widgetType === 'selector' && survey.appearance?.widgetSelector) {
                        this.handleWidgetSelector(survey)
                    }
                }

                if (survey.type === SurveyType.Popover && this.canShowNextEventBasedSurvey()) {
                    this.handlePopoverSurvey(survey)
                }
            })
        }, forceReload)
    }

    private addSurveyToFocus = (id: string): void => {
        this.surveysInFocus.add(id)
    }

    private removeSurveyFromFocus = (id: string): void => {
        this.surveysInFocus.delete(id)
    }

    // Expose internal state and methods for testing
    public getTestAPI() {
        return {
            addSurveyToFocus: this.addSurveyToFocus,
            removeSurveyFromFocus: this.removeSurveyFromFocus,
            surveysInFocus: this.surveysInFocus,
            canShowNextEventBasedSurvey: this.canShowNextEventBasedSurvey,
            handleWidget: this.handleWidget,
            handlePopoverSurvey: this.handlePopoverSurvey,
            handleWidgetSelector: this.handleWidgetSelector,
        }
    }
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
        <SurveyPopup
            key="surveys-render-preview"
            survey={survey}
            forceDisableHtml={forceDisableHtml}
            style={{
                position: 'relative',
                right: 0,
                borderBottom: `1px solid ${survey.appearance?.borderColor}`,
                borderRadius: 10,
                color: textColor,
            }}
            previewPageIndex={previewPageIndex}
            removeSurveyFromFocus={() => {}}
        />,
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
        <FeedbackWidget
            key={'feedback-render-preview'}
            forceDisableHtml={forceDisableHtml}
            survey={survey}
            readOnly={true}
            removeSurveyFromFocus={() => {}}
        />,
        root
    )
}

// This is the main exported function
export function generateSurveys(posthog: PostHog) {
    // NOTE: Important to ensure we never try and run surveys without a window environment
    if (!document || !window) {
        return
    }

    const surveyManager = new SurveyManager(posthog)
    surveyManager.callSurveysAndEvaluateDisplayLogic(true)

    // recalculate surveys every second to check if URL or selectors have changed
    setInterval(() => {
        surveyManager.callSurveysAndEvaluateDisplayLogic(false)
    }, 1000)
}
