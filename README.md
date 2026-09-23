# Setup ppr-tool

GitHub Action that installs [`ppr-tool`](https://github.com/private-package-registry/ppr-tool), the
private package registry publisher, on the runner and configures it for the given registry.
It downloads the native `ppr-tool` binary for the runner's platform from the requested release,
verifies it against the release's `SHA256SUMS`, adds `ppr-tool` to `PATH`, and exports `PPR_REGISTRY` and `PPR_STATE`. It does not install language
toolchains and does not authenticate: `ppr-tool stage` requests GitHub OIDC (or uses `PPR_TOKEN`) later.

This repository is a read-only mirror of the `action/` module in the private monorepo.

## Usage

```yaml
permissions:
  contents: read
  id-token: write
steps:
  - uses: actions/checkout@v6
  # Native build and archive preparation goes here.
  - uses: private-package-registry/setup-ppr-tool-action@v1
    with:
      registry: ${{ vars.PPR_REGISTRY }}
      version: v0.2.0   # optional; defaults to latest
  - run: ppr-tool stage --product licensing-kit --variant sources artifacts/npm/*.tgz artifacts/nuget/*.nupkg
  - run: ppr-tool verify -- node tools/test-install.mjs
  - run: ppr-tool commit
```

`--commit` defaults to `GITHUB_SHA` on Actions, and `verify`/`commit` read the release from the state
file written by `stage` (`PPR_RELEASE_ID` is also exported). `ppr-tool stage` writes the `release-id`
and `preview-url` step outputs and a package table to the job summary.

| Input | Required | Description |
|---|---|---|
| `registry` | yes | HTTPS origin of the private package registry, without path, query or credentials |
| `version` | no | `ppr-tool` release tag (`v0.2.0`) or `latest` (default) |

Pin `version` to a release tag for reproducible builds; `latest` is convenient for development.
Pin this Action to a release tag or full commit SHA as usual. The Action itself runs on the
runner's bundled Node 24; `ppr-tool` is a standalone binary and needs no Node, so it also works in
`container:` jobs.

| Runner | Release asset |
|---|---|
| Linux x64 | `ppr-tool-x86_64-unknown-linux-musl` (static) |
| Linux ARM64 | `ppr-tool-aarch64-unknown-linux-musl` (static) |
| macOS Intel | `ppr-tool-x86_64-apple-darwin` |
| macOS Apple silicon | `ppr-tool-aarch64-apple-darwin` |
| Windows x64 | `ppr-tool-x86_64-pc-windows-msvc.exe` |

Other platforms fail with an explicit error. The binary is installed as `ppr-tool` (`ppr-tool.exe` on Windows).

The publication state file written under `RUNNER_TEMP` contains a session credential. Do not cache,
upload or log it. Registry OIDC trust for your repository is configured by the registry administrator.

Setting `PPR_TOOL_RELEASES_URL` to an HTTPS (or loopback HTTP) base URL makes the Action download
`<base>/<tag>/<asset>` and `<base>/<tag>/SHA256SUMS` from there instead of GitHub Releases,
for internal mirrors and tests.

## Development

`npm ci`, `npm run typecheck`, `npm test`. Run `npm run build` and commit `dist/action.cjs` when changing the source.
Set `PPR_TOOL_TEST_BINARY` to a real `ppr-tool` build to have the tests run it; otherwise a shell stub is used.

## License

[MIT](LICENSE)
