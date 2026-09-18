import { expect, test } from '@playwright/test'

for (const mode of ['static', 'dynamic'] as const) {
    test(`${mode} surveys render manually with remote config off, submit, and clean up`, async ({ page }) => {
        await page.goto('/')
        await page.evaluate((mode) => window.surveysHarness.initialize(mode, false, false, false), mode)
        expect(await page.evaluate(() => window.surveysHarness.requests())).toBe(0)
        await page.evaluate(() => window.surveysHarness.display())
        await expect(page.getByText('What can we improve?')).toBeVisible()
        await page.getByRole('textbox').fill('A clearer example')
        await page.getByRole('button', { name: /submit survey/i }).click()
        await expect
            .poll(() =>
                page.evaluate(
                    () => window.surveysHarness.events().filter(({ event }) => event === 'survey sent').length
                )
            )
            .toBe(1)
        const sent = await page.evaluate(() =>
            window.surveysHarness.events().find(({ event }) => event === 'survey sent')
        )
        expect(sent?.properties).toMatchObject({
            $survey_id: 'browser-survey',
            $survey_response_answer: 'A clearer example',
        })
        expect(
            await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('surveys-client')))
        ).toEqual([])
        await page.evaluate(() => window.surveysHarness.dispose())
        await expect(page.locator('.PostHogSurvey-browser-survey')).toHaveCount(0)
    })
}

test('remote-enabled automatic surveys preserve consent and release polling/rendering on disposal', async ({
    page,
}) => {
    await page.goto('/')
    await page.evaluate(() => window.surveysHarness.initialize('dynamic', true, true, true))
    await expect(page.getByText('What can we improve?')).toBeVisible()
    await page.evaluate(() => window.surveysHarness.optOut())
    await page.getByRole('textbox').fill('denied response')
    await page.getByRole('button', { name: /submit survey/i }).click()
    expect(
        await page.evaluate(() => window.surveysHarness.events().filter(({ event }) => event === 'survey sent'))
    ).toEqual([])
    await page.evaluate(() => window.surveysHarness.dispose())
    await expect(page.locator('.PostHogSurvey-browser-survey')).toHaveCount(0)
    const requests = await page.evaluate(() => window.surveysHarness.requests())
    await page.waitForTimeout(1100)
    expect(await page.evaluate(() => window.surveysHarness.requests())).toBe(requests)
})

test('event-targeted survey activates from admitted capture and remembered submission prevents redisplay', async ({
    page,
}) => {
    await page.goto('/')
    await page.evaluate(() => window.surveysHarness.initialize('static', true, true, true, true))
    await expect.poll(() => page.evaluate(() => window.surveysHarness.requests())).toBe(1)
    await expect(page.getByText('What can we improve?')).toHaveCount(0)
    await page.evaluate(() => window.surveysHarness.capture())
    await expect(page.getByText('What can we improve?')).toBeVisible()
    await page.getByRole('textbox').fill('event response')
    await page.getByRole('button', { name: /submit survey/i }).click()
    await expect
        .poll(() =>
            page.evaluate(() => window.surveysHarness.events().filter(({ event }) => event === 'survey sent').length)
        )
        .toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('surveys-client_surveys'))).toContain('browser-survey')
    await page.evaluate(() => window.surveysHarness.initialize('static', true, true, true, true))
    await page.evaluate(() => window.surveysHarness.capture())
    await page.waitForTimeout(1100)
    await expect(page.getByText('What can we improve?')).toHaveCount(0)
})

for (const mode of ['ready', 'denied', 'disposed', 'loading'] as const) {
    test(`survey abandonment at pagehide with analytics ${mode}`, async ({ page, request }, testInfo) => {
        const projectToken = `ph_survey_teardown_${mode}_${testInfo.project.name}_${testInfo.retry}`
        await page.goto('/')
        await page.evaluate(
            ({ projectToken, loading }) => window.surveysHarness.initializeTeardown(projectToken, loading),
            { projectToken, loading: mode === 'loading' }
        )
        await expect(page.getByText('What can we improve?')).toBeVisible()
        await page.getByRole('textbox').fill('First answer')
        await page.getByRole('button', { name: /submit survey/i }).click()
        await expect(page.getByText('Anything else?')).toBeVisible()
        if (mode === 'denied') await page.evaluate(() => window.surveysHarness.optOut())
        if (mode === 'disposed') await page.evaluate(() => window.surveysHarness.dispose())
        if (mode !== 'ready') {
            await page.evaluate(() => window.surveysHarness.pagehide())
            expect(
                await page.evaluate(
                    () => window.surveysHarness.events().filter(({ event }) => event === 'survey abandoned').length
                )
            ).toBe(mode === 'loading' ? 1 : 0)
        }
        await page.goto('/after')
        const requests = async () =>
            (
                (await (await request.get('/requests')).json()) as { headers: Record<string, string>; body: string }[]
            ).filter(({ headers }) => headers.authorization === `Bearer ${projectToken}`)
        const abandoned = async () =>
            (await requests()).flatMap(({ body }) =>
                (JSON.parse(body).batch as { event: string; properties: Record<string, unknown> }[]).filter(
                    ({ event }) => event === 'survey abandoned'
                )
            )
        if (mode === 'ready') {
            await expect.poll(async () => (await abandoned()).length).toBe(1)
            expect((await abandoned())[0]?.properties).toMatchObject({
                $survey_id: 'browser-survey',
                $survey_response_answer: 'First answer',
            })
        } else {
            expect(await abandoned()).toEqual([])
            if (mode === 'loading' || mode === 'denied') expect(await requests()).toEqual([])
        }
    })
}
