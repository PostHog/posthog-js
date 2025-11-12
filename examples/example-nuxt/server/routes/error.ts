export default defineEventHandler(() => {
  throw new Error('Test server error from Nitro')
})
