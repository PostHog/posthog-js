import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import type { Survey } from 'posthog-js'

export default function SurveyForm() {
    const posthog = usePostHog()
    const [surveys, setSurveys] = useState([] as unknown as Survey[])
    const [selectedSurvey, setSelectedSurvey] = useState('')

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSurvey(event.target.value)
    }

    useEffect(() => {
        posthog.surveys.getSurveys((surveys: Survey[]) => {
            setSurveys(surveys)
            if (surveys.length > 0) {
                setSelectedSurvey(surveys[0].id)
            }
        })
    }, [])

    const arraySurveyItems = surveys.map((survey) => (
        <option key={survey.id} value={survey.id}>
            {survey.name}
        </option>
    ))

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap">
                <select value={selectedSurvey} onChange={handleChange}>
                    <option value="">Select a survey</option>
                    {arraySurveyItems}
                </select>
                <button
                    onClick={() => posthog.renderSurvey(selectedSurvey, '#survey-container')}
                    disabled={!selectedSurvey}
                >
                    Render Survey below
                </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <div id="survey-container">
                    <h1>hello world</h1>
                </div>
            </div>
        </>
    )
}
