import { defineNuxtPlugin } from '#app'

export default defineNuxtPlugin((nuxtApp) => {
  console.log('--------- CUSTOM PLUGIN START1 ------------')
  // const client = new PostHog('phc_VXlGk6yOu3agIn0h7lTmSOECAGWCtJonUJDAN4CexlJ', {
  //   host: 'http://localhost:8010',
  // })

  // client.debug(true)

  nuxtApp.hooks.hook('page:loading:start', async () => {
    console.log('----------- HOOK page:loading:start START ------------')
    console.log('page is loading')
    console.log('----------- HOOK page:loading:start END ------------')
  })

  nuxtApp.hooks.hook('vue:error', async (error) => {
    console.log('----------- HOOK vue:error START ------------')
    console.log(error)
    console.log('----------- HOOK vue:error END ------------')
  })

  nuxtApp.hooks.hook('app:error', async (error) => {
    console.log('----------- HOOK app:error START ------------')
    console.log(error)
    console.log('----------- HOOK app:error END ------------')
  })

  console.log('--------- CUSTOM PLUGIN END ------------')
})
