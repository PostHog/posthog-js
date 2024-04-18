const checkScriptsForSrcExists = (src: string): boolean => {
    const scripts = document.querySelectorAll('body > script')
    let foundScript = false
    for (let i = 0; i < scripts.length; i++) {
        if (scripts[i].src === src) {
            foundScript = true
            break
        }
    }

    return foundScript
}

export const expectScriptToExist = (src: string) => {
    if (!checkScriptsForSrcExists(src)) {
        throw new Error(`Script with src ${src} was not found.`)
    }
}

export const expectScriptToNotExist = (src: string) => {
    if (checkScriptsForSrcExists(src)) {
        throw new Error(`Script with src ${src} was found.`)
    }
}
