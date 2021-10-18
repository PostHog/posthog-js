export var replacementImageURI =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJibGFjayIvPgo8cGF0aCBkPSJNOCAwSDE2TDAgMTZWOEw4IDBaIiBmaWxsPSIjMkQyRDJEIi8+CjxwYXRoIGQ9Ik0xNiA4VjE2SDhMMTYgOFoiIGZpbGw9IiMyRDJEMkQiLz4KPC9zdmc+Cg=='

/*
 * Check whether a data payload is nearing 5mb. If it is, it checks the data for
 * data URIs (the likely culprit for large payloads). If it finds data URIs, it either replaces
 * it with a generic image (if it's an image) or removes it.
 * @data {object} the rr-web data object
 * @returns {object} the rr-web data object with data uris filtered out
 */
export function filterDataURLsFromLargeDataObjects(data) {
    if (data && typeof data === 'object') {
        var stringifiedData = JSON.stringify(data)
        // String length of 5000000 is an approximation of 5mb
        // Note: with compression, this limit may be able to be increased
        // but we're assuming most of the size is from a data uri which
        // is unlikely to be compressed further
        if (stringifiedData.length > 5000000) {
            // Regex that matches the pattern for a dataURI with the shape 'data:{mime type};{encoding},{data}'. It:
            // 1) Checks if the pattern starts with 'data:' (potentially, not at the start of the string)
            // 2) Extracts the mime type of the data uri in the first group
            // 3) Determines when the data URI ends.Depending on if it's used in the src tag or css, it can end with a ) or "
            var dataURIRegex = /data:([\w\/\-\.]+);(\w+),([^)"]*)/gim
            var matches = stringifiedData.matchAll(dataURIRegex)
            for (var match of matches) {
                if (match[1].toLocaleLowerCase().slice(0, 6) === 'image/') {
                    stringifiedData = stringifiedData.replace(match[0], replacementImageURI)
                } else {
                    stringifiedData = stringifiedData.replace(match[0], '')
                }
            }
        }
        return JSON.parse(stringifiedData)
    }
    return data
}
