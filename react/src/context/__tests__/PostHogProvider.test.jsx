import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider, PostHogContext } from '..'

describe('PostHogProvider component', () => {
    given(
        'render',
        () => () => render(<PostHogProvider client={given.posthog}>{given.childComponent}</PostHogProvider>)
    )
    given('childComponent', () => <div>Test</div>)
    given('posthog', () => ({}))

    it('should render children components', () => {
        expect(given.render().getByText('Test')).toBeTruthy()
    })
})
