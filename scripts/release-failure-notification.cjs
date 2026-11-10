/* oxlint-disable no-console */
const { readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const unsuccessful = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])
const npmPublishJobs = ['Publish packages', 'Publish posthog-js']

const isJob = (job, name) => job.name === name || job.name.startsWith(`${name} (`)

function readThreadTimestamp(directory, attempt) {
    if (!directory) return undefined
    try {
        // Failed-job reruns reuse the approval thread from the latest earlier attempt.
        const attempts = readdirSync(directory)
            .map((name) => /^release-slack-thread-(\d+)$/.exec(name)?.[1])
            .filter((value) => value && Number(value) <= attempt)
            .sort((a, b) => Number(b) - Number(a))
        if (attempts.length === 0) return undefined
        const timestamp = readFileSync(
            join(directory, `release-slack-thread-${attempts[0]}`, 'thread-ts.txt'),
            'utf8'
        ).trim()
        return /^\d+\.\d+$/.test(timestamp) ? timestamp : undefined
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not read Slack thread:', error.message)
        return undefined
    }
}

module.exports = async function releaseFailureNotification({ github, context, channel, threadDirectory }) {
    const run = context.payload.workflow_run
    const threadTs = readThreadTimestamp(threadDirectory, run.run_attempt)
    const destination = { channel, ...(threadTs ? { thread_ts: threadTs } : {}) }
    let jobs
    try {
        jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
            ...context.repo,
            run_id: run.id,
            attempt_number: run.run_attempt,
            per_page: 100,
        })
    } catch (error) {
        console.error('Failed to inspect release jobs:', error.status ?? error.name, error.message)
        return {
            ...destination,
            text: [
                `⚠️ Could not inspect release jobs for \`${context.repo.owner}/${context.repo.repo}\` (attempt ${run.run_attempt}).`,
                'Please check this release manually; individual job results are unavailable.',
                `<${run.html_url}|View release logs> (run: ${run.conclusion})`,
            ].join('\n'),
            unfurl_links: false,
            unfurl_media: false,
        }
    }

    if (jobs.length === 0 && run.conclusion === 'cancelled') {
        return null
    }

    const failedJobs = jobs.filter((job) => unsuccessful.has(job.conclusion))
    const versionBump = jobs.find((job) => job.name.startsWith('Bump versions and commit to '))
    if (
        run.conclusion === 'failure' &&
        failedJobs.length === 1 &&
        versionBump?.conclusion === 'failure' &&
        versionBump.steps?.length === 0 &&
        jobs.some(
            (job) =>
                job.name === 'Notify Slack - Rejected' &&
                job.steps?.some((step) => step.name === 'Notify Slack - Rejected' && step.conclusion === 'success')
        )
    ) {
        return null
    }

    const npmPublished = npmPublishJobs.every((name) => {
        const cells = jobs.filter((job) => isJob(job, name))
        return cells.length > 0 && cells.every((job) => job.conclusion === 'success')
    })
    const releasedNotification = jobs.find((job) => job.name === 'Notify Slack - Released')
    const problems = failedJobs.map((job) => `• <${job.html_url}|${job.name}>: ${job.conclusion}`)

    if (run.conclusion !== 'success' && failedJobs.length === 0) {
        for (const name of npmPublishJobs) {
            if (!jobs.some((job) => isJob(job, name))) problems.push(`• ${name}: never ran`)
        }
    }

    if (npmPublished && (!releasedNotification || releasedNotification.conclusion === 'skipped')) {
        problems.push('• The released Slack notification did not run.')
    }

    if (problems.length === 0 && run.conclusion === 'success') {
        return null
    }

    return {
        ...destination,
        text: [
            npmPublished
                ? `⚠️ npm packages published; follow-up problems for \`${context.repo.owner}/${context.repo.repo}\` (attempt ${run.run_attempt}).`
                : `❌ Release process failed or was cancelled for \`${context.repo.owner}/${context.repo.repo}\` (attempt ${run.run_attempt}).`,
            ...problems,
            `<${run.html_url}|View release logs> (run: ${run.conclusion})`,
        ].join('\n'),
        unfurl_links: false,
        unfurl_media: false,
    }
}
