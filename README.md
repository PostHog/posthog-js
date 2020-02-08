# PostHog.js

This library allows you to capture events and send those to any PostHog instance.


## Installation

You can either load the snippet as a script in your HTML:
```html
<script src="https://t.posthog.com/static/array.js"></script>
<script>
    posthog.init("[your-token]")
</script>
```

Or you can include it using npm, by doing either
```bash
yarn add posthog-js
```
or
```bash
npm install --save posthog-js
```

And then include it in your files
```js
import { posthog } from 'posthog-js';
posthog.init("[your-token]");
```

# Usage
## Sending events

By default, PostHog captures every click on certain elements (like `a`, `button`, `input` etc.) and page views. However, if it's often worth sending more context whenever a user does something. In that case, you can send an event with any metadata you may have.

```js
posthog.capture('[event-name]', {property1: 'value', property2: 'another value'})
```

## Identifying users
To make sure you understand which user is performing actions within your app, you can identify users at any point. From the moment you make this call, all events will be identified with that distinct id.

The ID can by anything, but is usually the unique ID that you identify users by in the database. 
Normally, you would put this below `posthog.init` if you have the information there.

```js
posthog.identify('[user unique id]')
```

## Sending user information
An ID alone might not be enough to work out which user is who within PostHog. That's why it's useful to send over more metadata of the user. At minimum, we recommend sending the `$email` property.

You can make this call on every page view to make sure this information is up-to-date. Alternatively, you can also do this whenever a user first appears (afer signup) or when they change their information.

```js
posthog.people.set({$email: 'joe.bloggs@example.com'})
```

## Aliasing users
Before a user signs up, they are anonymous. To make sure you can track users from the moment they hit your website, until they're using the product, make sure you call `alias` right after they sign up. Calling `alias` will also call `identify`.

This will link the users' anonymous ID with your internal ID.

```js
posthog.alias('[user unique id]')
```

## Complete signup psuedocode

As an example, here is how to put some of the above concepts together.

```js
function signup(email) {
    // Your own internal logic for creating an account and getting a user_id
    let user_id = create_account(email);

    // Make sure the anonymous events are linked with the new user
    posthog.alias(user_id);
    // Set email (will be sent once user is identified)
    posthog.people.set({$email: email});
}
```


# Development

To develop, clone the repo and run
```bash
yarn start
```

To create a minified production version, run
```bash
yarn build
```
