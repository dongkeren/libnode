# Buildchain Release Notes

`libnode` uses Buildchain v1 for shared Kungfu GitHub Actions and for
repository-local lifecycle metadata.

## Version State

`buildchain.toml` declares `package.json#version` as the release version state.
For this repository the package version follows the upstream Node.js version
that the embedded `node` submodule builds, for example `22.22.3`.

The npm package is `@kungfu-tech/libnode` and is configured for public
publishing to the official npm registry.

## Lifecycle

The configured lifecycle keeps the existing libnode build order:

1. install JavaScript build helpers with Yarn;
2. build the embedded Node.js shared library;
3. build the `link_node` addon;
4. package the node-pre-gyp prebuilt archive;
5. check the final diff.

The full lifecycle is intentionally expensive. Release PRs should rely on the
GitHub matrix workflow for Linux, macOS arm64, and Windows verification.

The workflow invokes Yarn through Corepack so the runner does not rely on a
preinstalled global Yarn binary.

## No-build Preflight

The migration can be validated before running the expensive native build. The
published Buildchain v1 `validate-config` action checks that
`buildchain.toml` is present, that `package.json#version` is readable as version
state, and that the required `install`, `build`, and `verify` lifecycle stages
are declared.

That preflight is intentionally structural. It does not run
`corepack yarn make`, `corepack yarn build`, or `corepack yarn package`.

The repository runs this check through
`.github/workflows/buildchain-preflight.yml` on PRs into the development, alpha,
and release lines:

```yaml
uses: kungfu-systems/buildchain/actions/validate-config@v1
with:
  config-required: "true"
  require-version-state: "true"
  require-lifecycle-stages: "install,build,verify"
```

The local preflight result for this adaptation is:

```text
configPath: buildchain.toml
versionFiles: package.json
lifecycleStages: install, build, verify
```

## Release Workflow

Release verification still builds platform artifacts in this repository because
libnode has platform-specific native outputs. Shared Buildchain v1 actions are
used for reusable release steps such as publishing prebuilt artifacts.

Production publishing remains gated by a reviewed PR into the release channel
and by successful artifact staging.
