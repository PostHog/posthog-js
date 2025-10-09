export default defineEventHandler((event) => {
  throw new Error('Test server error from Nitro')
})
