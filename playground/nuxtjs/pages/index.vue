<template>
  <div>
    <h1>Welcome to the Index Page</h1>
    <p>This is the index page of our Nuxt 3 application.</p>
    <nuxt-link to="/about">
      <button>Go to About Page</button>
    </nuxt-link>
  </div>
</template>

<script>
export default {
  head: {
    title: 'Index Page',
  },
};
</script>
