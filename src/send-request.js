export const encodePostDataBody = (data) => {
    let body_data
    if (Array.isArray(data)) {
        body_data = 'data=' + encodeURIComponent(data)
    } else {
        body_data = 'data=' + encodeURIComponent(data['data'])
    }
    // delete data['data']

    if (data['compression']) {
        body_data += '&compression=' + data['compression']
        // delete data['compression']
    }

    return body_data
}
