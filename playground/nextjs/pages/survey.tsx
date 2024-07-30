import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import { Survey } from 'posthog-js'

export default function SurveyForm() {
    const posthog = usePostHog()
    const [surveys, setSurveys] = useState([] as unknown as Survey[])
    const [selectedSurvey, setSelectedSurvey] = useState('0190bc7b-7096-0000-126d-1e5e7021a80e')
    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedSurvey(event.target.value)
    }

    useEffect(() => {
        posthog.surveys.getSurveys((surveys: Survey[]) => {
            setSurveys(surveys)
        })
    }, [])

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
