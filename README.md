# PostHog.js

This library allows you to capture events and send those to any [PostHog](https://posthog.com) instance.


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
posthog.capture('[event-name]', {property1: 'value', property2: 'another value'});
```

## Identifying users
To make sure you understand which user is performing actions within your app, you can identify users at any point. From the moment you make this call, all events will be identified with that distinct id.

The ID can by anything, but is usually the unique ID that you identify users by in the database. 
Normally, you would put this below `posthog.init` if you have the information there.

If a user was previously anonymous (because they hadn't signed up or logged in yet), we'll automatically alias their anonymous ID with their new unique ID. That means all their events from before and after they signed up will be shown under the same user.

```js
posthog.identify('[user unique id]');
```

## Sending user information
An ID alone might not be enough to work out which user is who within PostHog. That's why it's useful to send over more metadata of the user. At minimum, we recommend sending the `$email` property.

You can make this call on every page view to make sure this information is up-to-date. Alternatively, you can also do this whenever a user first appears (afer signup) or when they change their information.

```js
posthog.people.set({$email: 'john@gmail.com'});
```

## One-page apps and pageviews
This JS snippet automatically sends pageview events whenever it gets loaded. If you have a one-page app that means it'll only send a pageview once, when your app loads.

To make sure any navigating a user does within your app gets captured, you can make a pageview call manually.

```js
posthog.capture('$pageview');
```

This will automatically send the current URL.

## Complete signup psuedocode

As an example, here is how to put some of the above concepts together.

```js
function signup(email) {
    // Your own internal logic for creating an account and getting a user_id
    let user_id = create_account(email);

    // Identify user with internal ID
    posthog.identify(user_id);
    // Set email or any other data
    posthog.people.set({email: email});
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

# Contributions

Contributions are very welcome! Please open a PR and we'll review it asap. If you have any questions, please shoot an email to hey@posthog.com.
