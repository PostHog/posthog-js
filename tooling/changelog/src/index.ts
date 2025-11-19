import githubChangelog from '@changesets/changelog-github'

const getReleaseLine = async (changesets, type, options) => {
    const date = new Date().toISOString().split('T')[0]
    const line = await githubChangelog.getReleaseLine(changesets, type, options)
    return `${line} (${date})`
}

export default { getReleaseLine, getDependencyReleaseLine: githubChangelog.getDependencyReleaseLine }
