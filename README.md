# Setup ppr-tool

GitHub Action that installs [`ppr-tool`](https://github.com/private-package-registry/ppr-tool), the
private package registry publisher, on the runner and configures it for the given registry.
It downloads the requested release asset, verifies it against the release's `SHA256SUMS`, adds
`ppr-tool` to `PATH`, and exports `PPR_REGISTRY` and `PPR_STATE`. It does not install language
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
      version: v0.1.0   # optional; defaults to latest
  - run: ppr-tool stage --manifest artifacts/release/release.json
  - run: ppr-tool verify --release "$PPR_RELEASE_ID" -- node tools/test-install.mjs
  - run: ppr-tool commit --release "$PPR_RELEASE_ID"
```

| Input | Required | Description |
|---|---|---|
| `registry` | yes | HTTPS origin of the private package registry, without path, query or credentials |
| `version` | no | `ppr-tool` release tag (`v0.1.0`) or `latest` (default) |

Pin `version` to a release tag for reproducible builds; `latest` is convenient for development.
Pin this Action to a release tag or full commit SHA as usual. The Action runs on Node 24 runners
on Linux, macOS and Windows.

The publication state file written under `RUNNER_TEMP` contains a session credential. Do not cache,
upload or log it. Registry OIDC trust for your repository is configured by the registry administrator.

Setting `PPR_TOOL_RELEASES_URL` to an HTTPS (or loopback HTTP) base URL makes the Action download
`<base>/<tag>/ppr-tool.mjs` and `<base>/<tag>/SHA256SUMS` from there instead of GitHub Releases,
for internal mirrors and tests.

## Development

`npm ci`, `npm run typecheck`, `npm test`. Run `npm run build` and commit `dist/action.cjs` when changing the source.

## License

[MIT](LICENSE)
