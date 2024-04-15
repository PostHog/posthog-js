export const checkScriptsForSrc = (src, negate = false) => {
    const scripts = document.querySelectorAll('body > script')
    let foundScript = false
    for (let i = 0; i < scripts.length; i++) {
        if (scripts[i].src === src) {
            foundScript = true
            break
        }
    }

    if (foundScript && negate) {
        throw new Error(`Script with src ${src} was found when it should not have been.`)
    } else if (!foundScript && !negate) {
        throw new Error(`Script with src ${src} was not found when it should have been.`)
    } else {
        return true
    }
}
