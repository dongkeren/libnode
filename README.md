# Shared lib (so/dylib/dll) for Node.js

This project provides shared lib for [Node.js](https://nodejs.org).

## Usage

Install via npm or pnpm:

```
npm install @kungfu-tech/libnode
```

The main package resolves the matching platform package installed through npm
optional dependencies, such as `@kungfu-tech/libnode-darwin-arm64`,
`@kungfu-tech/libnode-linux-x64`, or `@kungfu-tech/libnode-win32-x64`.

### Compile and Link

Get the path for shared lib for compilers:

```
node -p "require('@kungfu-tech/libnode').libpath"
```

Get the headers path:

```
node -p "require('@kungfu-tech/libnode').include"
```

## Build with GitHub Actions

The `Build` and `Release - Verify` workflows run through Kungfu Buildchain and build the Node.js version pinned by `libnode.release.json` and `.gitmodules`. Each runner packages its native output as an npm platform tarball under `build/stage/npm`.

Npm publication is handled only by Buildchain publish-gate promotion. Reviewed
channel branches prepare release material; package publication enters through
`publish-gate/alpha/<line>/<version>` for dist-tag `alpha` or
`publish-gate/release/<line>/<version>` for dist-tag `latest`. The reusable
Buildchain workflow locks that gate branch to an exact source SHA before build
and publish, and the promotion action rejects publish side effects unless the
same source-lock protocol is present. The exact npm version is read from
`package.json` and `libnode.release.json`, and must match the publish-gate
consumer version.

npm publication uses GitHub Trusted Publishing from the GitHub-hosted publish
job. The workflow does not use `NPM_PUSH_TOKEN` or npm dist-tag recovery tokens
for the normal path; package access is authorized by the trusted publisher
records on npm for this repository and workflow file.

For self-hosted runners, set `KF_NODE_GIT_URL` to a local network Git service when available. `KF_NODE_REFERENCE` can also point at a runner-local bare mirror to reduce repeated object transfer. If those variables are not set, the prepare step falls back to the public Node.js GitHub repository.

Compiler caching is enabled opportunistically with `KF_COMPILER_CACHE=auto` in `buildchain.toml`. Linux and macOS use `ccache` when it is installed on the runner. Windows uses Node.js `vcbuild.bat ccache <path>` mode when `ccache.exe` is available; set `KF_NODE_WIN_CCACHE_PATH` when the verified `ccache.exe`/`cl.exe` wrapper directory is not on `PATH`. Set `KF_DISABLE_COMPILER_CACHE=true` to force a clean uncached build. Unix builds default to `make -j <cpu count>`; set `KF_BUILD_JOBS=<n>` when a runner needs a lower or higher explicit job count.

Windows runners that do not have `python.exe` on `PATH` bootstrap a standalone Python from the LAN cache. Override `KF_WINDOWS_PYTHON_URL` and `KF_WINDOWS_PYTHON_SHA256` when refreshing that cached tool.
