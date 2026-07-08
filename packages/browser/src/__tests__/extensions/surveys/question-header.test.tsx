import '@testing-library/jest-dom'

import { render } from '@testing-library/preact'
import { QuestionHeader } from '../../../extensions/surveys/components/QuestionHeader'
import { SurveyQuestionType } from '../../../posthog-surveys-types'

// The question-header--empty class replaces a :has(.survey-question:empty) CSS rule that
// crashes some WebKit builds. Keep it driven from JS so the crashing selector never returns.
describe('QuestionHeader', () => {
    it.each([
        ['empty question and no description', '', undefined, true],
        ['question text present', 'What is your favorite color?', undefined, false],
        ['no question but a description', '', 'A description', false],
        ['both question and description present', 'A question', 'A description', false],
    ])('%s', (_label, question, description, expectEmpty) => {
        const { container } = render(
            <QuestionHeader
                question={{
                    type: SurveyQuestionType.Open,
                    question: question as string,
                    description: description as string | undefined,
                    descriptionContentType: 'text',
                }}
                forceDisableHtml={false}
            />
        )

        const header = container.querySelector('.question-header')
        expect(header).not.toBeNull()
        if (expectEmpty) {
            expect(header).toHaveClass('question-header--empty')
        } else {
            expect(header).not.toHaveClass('question-header--empty')
        }
    })
})
