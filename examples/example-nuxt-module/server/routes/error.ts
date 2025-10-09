export default defineEventHandler((event) => {
  setTimeout(() => {
    throw new Error('Some unawaited nitro error')
  }, 1000)

  setTimeout(() => {
    Promise.reject(new Error('Some uncaught nitro promise rejection'))
  }, 1000)

  throw new Error('Test server error from Nitro')
})
