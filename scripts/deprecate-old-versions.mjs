
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { spawnSync } from 'child_process'
import { subDays, startOfDay, format, isBefore } from 'date-fns'
import { compare } from 'compare-versions'

// edit this file to change the deprecation settings
import deprecationJson from '../deprecation.json' with { type: 'json' }
const { deprecateOlderThanDays, deprecateBeforeVersion, message } = deprecationJson

const argv = yargs(hideBin(process.argv)).argv
const dryRun = argv.dryRun !== 'false'

const runNpmView = () => {
    const result = spawnSync('npm', ['view', 'posthog-js', '--json'], { encoding: 'utf-8' })
    return JSON.parse(result.stdout.trim())
}

const runNpmDeprecateBeforeVersion = () => {
    const command = ['deprecate', `posthog-js@<${deprecateBeforeVersion}`, message]
    if (dryRun) {
        console.log('Dry run: command', 'npm', command)
    } else {
        spawnSync('npm', command, { stdio: 'inherit' })
    }
}
const runNpmDeprecateBeforeOrEqualVersion = (version) => {
    const command = ['deprecate', `posthog-js@<=${version}`, message]
    if (dryRun) {
        console.log('Dry run: command', 'npm', command)
    } else {
        spawnSync('npm', command, { stdio: 'inherit' })
    }
}

const main = async () => {
    if (dryRun) {
        console.log()
        console.log('!!! Doing dry run, run with --dry-run=false to actually deprecate versions !!!')
        console.log()
    }

    let viewResult = runNpmView()
    let currentVersion = viewResult.version
    console.log(`Current version: ${currentVersion}`)

    if (compare(currentVersion, deprecateBeforeVersion, '<')) {
        throw new Error('Current version is older than the deprecation version! Aborting.')
    }

    // were there any versions older than the deprecation version?
    let shouldDeprecateBeforeVersion = false
    for (const [version, dateString] of Object.entries(viewResult.time)) {
        if (version === 'created' || version === 'modified') {
            continue
        }
        if (compare(version, deprecateBeforeVersion, '<')) {
            shouldDeprecateBeforeVersion = true
            break
        }
    }

    if (shouldDeprecateBeforeVersion) {
        runNpmDeprecateBeforeVersion()
    } else {
        console.log(`No versions older than ${deprecateBeforeVersion} to deprecate, skipping...`)
    }

    // fetch the latest metadata
    viewResult = runNpmView()
    currentVersion = viewResult.version

    const now = new Date()
    const deprecateBeforeDate = startOfDay(subDays(now, deprecateOlderThanDays))
    console.log(`Finding versions older than ${format(deprecateBeforeDate, 'yyyy-MM-dd')} to deprecate...`)

    let highestVersionToDeprecate = undefined
    let highestVersionToDeprecateDate = undefined
    for (const [version, dateString] of Object.entries(viewResult.time)) {
        if (version === 'created' || version === 'modified') {
            continue
        }
        if (compare(currentVersion, version, '=')) {
            continue
        }
        if (compare(currentVersion, version, '<')) {
            console.log(`Skipping future version ${version} released on ${dateString}`)
            continue
        }
        const date = new Date(dateString)
        if (isBefore(date, deprecateBeforeDate)) {
            if (!highestVersionToDeprecate || compare(highestVersionToDeprecate, version, '<')) {
                highestVersionToDeprecate = version
                highestVersionToDeprecateDate = date
            }
        }
    }
    if (highestVersionToDeprecate) {
        console.log(`Deprecating up to and including version ${highestVersionToDeprecate} released on ${format(highestVersionToDeprecateDate, 'yyyy-MM-dd')} ...`)
        runNpmDeprecateBeforeOrEqualVersion(highestVersionToDeprecate)
    }
}


main().catch(e => {
    console.error(e)
    process.exit(1)
})
