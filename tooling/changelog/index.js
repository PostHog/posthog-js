import githubChangelog from '@changesets/changelog-github'

const getReleaseLine = async (...args) => {
    const date = new Date().toISOString().split('T')[0]
    const line = await githubChangelog.getReleaseLine(...args)
    return `${line} - ${date}`
}

const getDependencyReleaseLine = async (...args) => {
    const date = new Date().toISOString().split('T')[0]
    const line = await githubChangelog.getDependencyReleaseLine(...args)
    return `${line} - ${date}`
}

export default { getReleaseLine, getDependencyReleaseLine }
