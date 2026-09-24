import { branch, delay, email, fn, group, onSchedule, path, person, secret, step, trigger, workflow } from '../index.js'

const wait = delay('1d', { name: 'Wait a day' })
const onPaidPlan = [person('plan', 'exact', ['pro'])] as const

const soon = 'soon'
// @ts-expect-error - 'soon' is not a duration
delay(soon, { name: 'Wait' })

branch({
    name: 'Which plan?',
    branches: [
        {
            name: 'Paid plan',
            when: onPaidPlan,
            // @ts-expect-error - an empty branch path emits a branch edge aimed at the no-match target
            then: [],
        },
    ],
})

branch({
    name: 'Which plan?',
    // @ts-expect-error - a branch with no branches is a conditional that decides nothing
    branches: [],
})

// @ts-expect-error - an empty workflow has no first action for the trigger to point at
path()

email({
    name: 'Welcome',
    from: { integrationIds: [12] },
    to: 'someone@example.com',
    subject: 'Welcome',
    text: 'Hello',
    html: '<p>Hello</p>',
    // @ts-expect-error - the SDK has no `templateUuid`
    templateUuid: '0199d0c0-0000-7000-8000-000000000000',
})

// @ts-expect-error - `from` is required
email({
    name: 'Welcome',
    to: 'someone@example.com',
    subject: 'Welcome',
    text: 'Hello',
    html: '<p>Hello</p>',
})
email({
    name: 'Welcome',
    // @ts-expect-error - the sender list is a non-empty tuple
    from: { integrationIds: [] },
    to: 'someone@example.com',
    subject: 'Welcome',
    text: 'Hello',
    html: '<p>Hello</p>',
})

fn({
    name: 'Post to Slack',
    templateId: 'template-slack',
    inputs: { text: 'Hello', secret: secret('SLACK_TOKEN'), blocks: [{ type: 'section' }] },
})
fn({
    name: 'Post to Slack',
    templateId: 'template-slack',
    inputs: {
        // @ts-expect-error - function inputs must be JSON or a secret
        transform: () => 'Hello',
    },
})

// @ts-expect-error - `key` is how push finds the workflow again, so it is required
workflow({
    name: 'No key',
    on: onSchedule(),
    steps: path(wait),
    exit: { reason: 'Done' },
})

workflow({
    key: 'converts',
    name: 'Converts',
    // @ts-expect-error - the conversion variants arrive together with the goal
    exitCondition: 'exit_on_conversion',
    on: onSchedule(),
    steps: path(wait),
    exit: { reason: 'Done' },
})

// @ts-expect-error - groupTypeIndex is required
const accountTier = group('tier', 'exact', ['enterprise'])
void accountTier

step({
    type: 'function_sms',
    name: 'Send a text message',
    config: { template_id: 'template-twilio', inputs: { message: { value: 'Hello' } } },
    on_error: 'continue',
    output_variable: { key: 'sms_result', label: 'SMS result' },
})
step({
    type: 'function_sms',
    name: 'Send a secret text',
    config: { template_id: 'template-twilio', inputs: { message: secret('SMS_MESSAGE') } },
})
step({
    type: 'function_sms',
    name: 'Send a text with a misplaced secret',
    // @ts-expect-error - a secret is accepted only as a whole entry of config.inputs
    config: { template_id: 'template-twilio', auth: { token: secret('SMS_TOKEN') } },
})

trigger({ type: 'webhook', inputs: { auth_header: secret('WEBHOOK_AUTH') } })
// @ts-expect-error - a secret is accepted only as a whole entry of config.inputs
trigger({ type: 'webhook', auth: { header: secret('WEBHOOK_AUTH') } })

workflow({
    key: 'manual-start',
    name: 'Manual start',
    on: trigger(
        {
            type: 'manual',
            template_id: 'template-source-webhook',
            inputs: { event: { value: '$workflow_triggered' }, distinct_id: { value: '{request.body.user_id}' } },
        },
        { name: 'Manual trigger' }
    ),
    steps: path(wait),
    variables: [{ key: 'plan', type: 'string', default: 'free', label: 'Plan' }],
    exit: { name: 'Finished', description: 'Done without errors.', reason: 'Done' },
})

person('email', 'icontains', 'example.com')
person('email', 'is_set')
person('version', 'semver_gte', '1.2.3')
// @ts-expect-error - value operators need a value
person('email', 'icontains')
// @ts-expect-error - set operators need no author value
person('email', 'is_set', 'yes')
