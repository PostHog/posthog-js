# Contributing

Contributions are always welcome, no matter how large or small!

We want this community to be friendly and respectful to each other. Please follow it in all your interactions with the project. Before contributing, please read the [code of conduct](./CODE_OF_CONDUCT.md).

## Development workflow

This project is a monorepo managed using [pnpm workspaces](https://pnpm.io/workspaces). It contains the following packages:

- The library package in the root directory.
- An example app in the `example/` directory.

To get started with the project, run:

```sh
pnpm install --frozen-lockfile
```

> Since the project relies on pnpm workspaces, you cannot use [`npm`](https://github.com/npm/cli) or [`yarn`](https://yarnpkg.com/) for development.

## CI-aligned checks

Run the same core checks CI uses before opening a PR:

```sh
pnpm lint
pnpm typecheck
pnpm prepare
```

CI also verifies the example app builds on Android and iOS. You can run the matching local commands with:

```sh
pnpm example build:android
pnpm example build:ios
```

## Working with the example app

To start the packager:

```sh
pnpm example start
```

To run the example app on Android:

```sh
pnpm example android
```

To run the example app on iOS:

```sh
pnpm example ios
```

The example app is configured to use the local version of the library, so JavaScript changes are reflected without a rebuild, while native code changes require rebuilding the example app.

If you want to use Android Studio or Xcode to edit the native code, you can open `example/android` or `example/ios` respectively. To edit the Objective-C or Swift files, open `example/ios/PosthogReactNativePluginExample.xcworkspace` in Xcode and find the source files at `Pods > Development Pods > posthog-react-native-plugin`.

To edit the Java or Kotlin files, open `example/android` in Android Studio and find the source files at `posthog-react-native-plugin` under `Android`.

### Commit message convention

We follow the [conventional commits specification](https://www.conventionalcommits.org/en) for our commit messages:

- `fix`: bug fixes, e.g. fix crash due to deprecated method.
- `feat`: new features, e.g. add new method to the module.
- `refactor`: code refactor, e.g. migrate from class components to hooks.
- `docs`: changes to documentation.
- `test`: adding or updating tests.
- `chore`: tooling changes, e.g. change CI config.

## Sending a pull request

- Prefer small pull requests focused on one change.
- Verify that the CI-aligned checks above are passing.
- Review the documentation to make sure it looks good.
- Follow the pull request template when opening a pull request.
- For pull requests that change the API or implementation, discuss with maintainers first by opening an issue.
