"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/action.ts
var import_promises = require("node:fs/promises");
var import_node_crypto = require("node:crypto");
var import_node_path = __toESM(require("node:path"), 1);

// src/platform.ts
var ASSETS = {
  "linux/x64": "ppr-tool-x86_64-unknown-linux-musl",
  "linux/arm64": "ppr-tool-aarch64-unknown-linux-musl",
  "darwin/x64": "ppr-tool-x86_64-apple-darwin",
  "darwin/arm64": "ppr-tool-aarch64-apple-darwin",
  "win32/x64": "ppr-tool-x86_64-pc-windows-msvc.exe"
};
function assetName(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}/${arch}`];
  if (!asset) throw new Error(`Unsupported runner platform ${platform}/${arch}: ppr-tool is released for ${Object.keys(ASSETS).join(", ")}`);
  return asset;
}
function binaryName(platform = process.platform) {
  return platform === "win32" ? "ppr-tool.exe" : "ppr-tool";
}

// src/action.ts
var RELEASES = "https://github.com/private-package-registry/ppr-tool/releases";
var SUMS = "SHA256SUMS";
function registryUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Registry must be an origin without credentials, path or query");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Registry requires HTTPS");
  return url.origin;
}
function releaseBase(version) {
  const override = process.env.PPR_TOOL_RELEASES_URL;
  const requested = version.trim() || "latest";
  let tag = "latest";
  if (requested !== "latest") {
    const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(requested);
    if (!match) throw new Error(`Invalid ppr-tool version "${requested}": use latest or a release tag such as v0.0.1`);
    tag = `v${match[1]}`;
  }
  if (override) {
    const base = new URL(override);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("PPR_TOOL_RELEASES_URL requires HTTPS");
    return new URL(`${tag}/`, base.href.endsWith("/") ? base.href : base.href + "/").href;
  }
  return tag === "latest" ? `${RELEASES}/latest/download/` : `${RELEASES}/download/${tag}/`;
}
async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6e4), headers: { "user-agent": `setup-ppr-tool-action/${"0.0.1"}` } });
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`Download of ${url} failed with HTTP ${response.status}`), { fatal: true });
      return { body: Buffer.from(await response.arrayBuffer()), finalUrl: response.url };
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1e3 * (attempt + 1)));
    }
  }
  throw new Error(`Download of ${url} failed: ${lastError instanceof Error ? lastError.message : "network error"}`);
}
function expectedDigest(sums, asset) {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match && match[2] === asset) return match[1];
  }
  throw new Error(`${SUMS} has no entry for ${asset}`);
}
async function main() {
  const registry = registryUrl(process.env.INPUT_REGISTRY || "");
  const temp = process.env.RUNNER_TEMP;
  if (!temp || !process.env.GITHUB_PATH || !process.env.GITHUB_ENV) throw new Error("GitHub Actions runner environment is required");
  const asset = assetName();
  const base = releaseBase(process.env.INPUT_VERSION || "latest");
  const sums = await download(base + SUMS);
  const digest = expectedDigest(sums.body.toString("utf8"), asset);
  const binary = await download(base + asset);
  const actual = (0, import_node_crypto.createHash)("sha256").update(binary.body).digest("hex");
  if (actual !== digest) throw new Error(`ppr-tool download does not match ${SUMS} (expected ${digest}, got ${actual})`);
  const resolved = /\/(v\d[^/]*)\/[^/]*$/.exec(binary.finalUrl)?.[1] ?? "latest";
  const directory = import_node_path.default.join(temp, "ppr-tool-bin");
  const file = import_node_path.default.join(directory, binaryName());
  await (0, import_promises.rm)(directory, { recursive: true, force: true });
  await (0, import_promises.mkdir)(directory, { recursive: true });
  await (0, import_promises.writeFile)(file, binary.body, { mode: 493 });
  await (0, import_promises.chmod)(file, 493);
  await (0, import_promises.appendFile)(process.env.GITHUB_PATH, directory + "\n");
  await (0, import_promises.appendFile)(process.env.GITHUB_ENV, `PPR_REGISTRY=${registry}
PPR_STATE=${import_node_path.default.join(temp, "ppr-tool-state", "state.json")}
`);
  console.log(`ppr-tool ${resolved} (${asset}) ready (sha256 ${actual}). OIDC will be requested when staging.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Setup failed");
  process.exitCode = 1;
});
