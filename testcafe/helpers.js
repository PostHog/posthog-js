export async function retryUntilResults(operation, limit = 50) {
    const attempt = (count, resolve, reject) => {
        if (count === limit) {
            return reject(new Error('Failed to fetch results in 10 attempts'))
        }

        setTimeout(() => {
            operation()
                .then((results) => (results.length > 0 ? resolve(results) : attempt(count + 1, resolve, reject)))
                .catch(reject)
        }, 300)
    }

    return new Promise((...args) => attempt(0, ...args))
}
