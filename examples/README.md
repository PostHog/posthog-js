## Installation

### Export packages

From the workspace root folder, run the following command:
```shell
pnpm package:watch
```
This will watch for file changes across all workspace members and export packages as tarballs inside the target folder.

Note: It takes dependencies into account, if you change @posthog/core, it will reexport all packages that depend on it.

### Install dependencies

Open a new terminal, go to the specific example folder and run the following command:
```
pnpm install
```
Dependencies inside package.json are overridden by tarballs.

You can now run the example, by following instructions inside each example's README.md file.

When changes are made inside the workspace, new tarballs are created and you just need to reinstall the dependencies:
```
pnpm install
```

## Why use tarballs?

Tarball installation is as close to real-world installation as possible. It solves issues with symlinking, node_modules resolutions and sub-dependencies overrides. It also allows for easy inspection of the package contents and testing in other projects.
