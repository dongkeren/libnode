# Buildchain Release Notes

`libnode` uses Buildchain v2 for shared Kungfu GitHub Actions and for
repository-local lifecycle metadata.

## Version State

`buildchain.toml` declares `package.json#version` as the release version state.
For this repository the package version follows the upstream Node.js version
that the embedded `node` submodule builds, plus a libnode package revision, for
example `22.22.3-kf.0`.

This repository uses Buildchain v2 anchored/manual version semantics:

- `package.json#version` remains the npm package version.
- `libnode.release.json` is the anchor manifest for the upstream Node.js tag,
  commit, and libnode revision.
- Buildchain validates the configured version state and anchor manifest, but it
  does not derive the next libnode anchor automatically.
- Opening a future Node train, such as a `v24` line, is a manual source change:
  update `libnode.release.json`, `package.json#version`, and the `node`
  submodule/tag contract in one reviewed change.

The npm package is `@kungfu-tech/libnode` and is configured for public
publishing to the official npm registry.

## Lifecycle

The configured lifecycle keeps the existing libnode build order:

1. install JavaScript build helpers with pnpm;
2. build the embedded Node.js shared library;
3. build the `link_node` addon;
4. package the platform-specific npm tarball under `build/stage/npm`;
5. check the final diff.

The full lifecycle is intentionally expensive. Release PRs should rely on the
GitHub matrix workflow for Linux, macOS arm64, and Windows verification.

The workflow invokes pnpm through Corepack so the runner does not rely on a
preinstalled global package manager binary.

## No-build Preflight

The migration can be validated before running the expensive native build. The
published Buildchain v2 `validate-config` action checks that
`buildchain.toml` is present, that `package.json#version` is readable as version
state, that `libnode.release.json` is present as the anchor manifest, and that
the required `install`, `build`, and `verify` lifecycle stages are declared.

That preflight is intentionally structural. It does not run
`corepack pnpm make`, `corepack pnpm build`, or `corepack pnpm package`.

The repository runs this check through
`.github/workflows/buildchain-preflight.yml` on PRs into the development, alpha,
and release lines:

```yaml
uses: kungfu-systems/buildchain/actions/validate-config@v2
with:
  config-required: 'true'
  require-version-state: 'true'
  require-lifecycle-stages: 'install,build,verify'
```

The local preflight result for this adaptation is:

```text
configPath: buildchain.toml
versionStrategy: anchored
versionNext: manual
anchorManifest: libnode.release.json
versionFiles: package.json
lifecycleStages: install, build, verify
```

## Publish-Gate Workflow

Release verification still builds platform artifacts in this repository because
libnode has platform-specific native outputs. Those artifacts are npm tarballs:
one package per supported platform, plus the main package tarball from the
Linux x64 release build.

Actual npm publication is driven by reviewed `publish-gate/*` source branches,
not by a merge into `release/*` alone. The branch name is the auditable release
decision and must include the exact package version that already exists in the
checked-out tree:

```text
publish-gate/alpha/v22/v22.22/22.22.3-kf.0
publish-gate/release/v22/v22.22/22.22.3-kf.0
```

The `Publish Gate` workflow passes the gate branch to Buildchain as
`publish-source-ref`. Buildchain resolves that branch to `publish-source-sha`,
checks out and builds from the locked SHA, verifies `package.json#version`
against the branch suffix, and emits `release-manifest-json`.

Before touching npm, the publish job checks the gate branch again with
Buildchain's `verify-publish-source-lock.mjs`. If the branch has moved since
the build resolved it, the job fails closed and a new run is required.

Alpha publication uses npm dist-tag `alpha`. Release publication uses dist-tag
`latest`, but defaults to promotion semantics: every package tarball must
already exist in the registry with matching integrity, normally from the alpha
run, and then `latest` is moved only after the full package set is verified.

The npm package set is published or promoted in platform-first/main-last order.
The main `@kungfu-tech/libnode` package is the last visible package so npm
optional dependency resolution can see the platform packages immediately.
