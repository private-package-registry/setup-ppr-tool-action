// Release asset for each runner platform, as published by ppr-tool's release workflow.
const ASSETS: Record<string, string> = {
  'linux/x64': 'ppr-tool-x86_64-unknown-linux-musl',
  'linux/arm64': 'ppr-tool-aarch64-unknown-linux-musl',
  'darwin/x64': 'ppr-tool-x86_64-apple-darwin',
  'darwin/arm64': 'ppr-tool-aarch64-apple-darwin',
  'win32/x64': 'ppr-tool-x86_64-pc-windows-msvc.exe',
};

export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  const asset = ASSETS[`${platform}/${arch}`];
  if (!asset) throw new Error(`Unsupported runner platform ${platform}/${arch}: ppr-tool is released for ${Object.keys(ASSETS).join(', ')}`);
  return asset;
}

export function binaryName(platform: string = process.platform): string {
  return platform === 'win32' ? 'ppr-tool.exe' : 'ppr-tool';
}
