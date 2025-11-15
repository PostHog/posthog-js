const githubChangelog = require('@changesets/changelog-github')

const getReleaseLine = async (changeset, type, options) => {
    return githubChangelog.getReleaseLine(changeset, type, options)
}

const getDependencyReleaseLine = async (changesets, dependenciesUpdated, options) => {
    return githubChangelog.getDependencyReleaseLine(changesets, dependenciesUpdated, options)
}

async function getChangelogEntry(release, options) {
    const date = new Date().toISOString().split('T')[0]
    const githubEntry = await githubChangelog.getChangelogEntry(release, options)

    return githubEntry.replace(`## ${release.newVersion}`, `## ${release.newVersion} - ${date}`)
}

const defaultChangelogFunctions = {
    getReleaseLine,
    getDependencyReleaseLine,
    getChangelogEntry,
}

module.exports = defaultChangelogFunctions
