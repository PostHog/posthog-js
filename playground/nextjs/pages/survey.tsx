import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function Survey() {
    const posthog = usePostHog()
    const [surveys, setSurveys] = useState([] as unknown as Survey[])
    const [selectedSurvey, setSelectedSurvey] = useState('0190bc7b-7096-0000-126d-1e5e7021a80e')
    const handleChange = (event) => {
        // console.log("changed survey selection")
        setSelectedSurvey(event.target.value)
    }

    useEffect(() => {
        posthog.surveys.getSurveys((surveys: Survey[]) => {
            setSurveys(surveys)
        })
    }, [])
    // posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
    //     api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    //     session_recording: {
    //         recordCrossOriginIframes: true,
    //     },
    //     debug: true,
    //     scroll_root_selector: ['#scroll_element', 'html'],
    //     persistence: cookieConsentGiven() ? 'localStorage+cookie' : 'memory',
    //     person_profiles: PERSON_PROCESSING_MODE === 'never' ? 'identified_only' : PERSON_PROCESSING_MODE,
    //     persistence_name: `${process.env.NEXT_PUBLIC_POSTHOG_KEY}_nextjs`,
    //     ...configForConsent(),
    // })

    const arraySurveyItems = surveys.map((survey) => <option value={survey.id}> {survey.name}</option>)

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap">
                <select value={selectedSurvey} onChange={handleChange}>
                    {arraySurveyItems}
                </select>
                <button onClick={() => posthog.renderSurvey(selectedSurvey, '#survey-container')}>
                    Render Survey below
                </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <div id="survey-container">
                    <h1> hello world </h1>
                </div>
            </div>
        </>
    )
}
