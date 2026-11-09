#!/usr/bin/env node
/**
 * Fetches the pinned Typst packages into the workspace-local package path.
 *
 * The Typst CLI's own downloader uses the OS TLS stack. In the development
 * environment this can fail with SEC_E_NO_CREDENTIALS. Node's HTTPS client
 * works, so we download the immutable package tarballs and unpack them into
 * `.typst/packages/preview/<name>/<version>`, which is what
 * `typst --package-path .typst/packages` expects.
 */

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const PACKAGES = [
  { name: "cetz", version: "0.5.3" },
  { name: "oxifmt", version: "1.0.0" },
];

const root = process.cwd();
const packageRoot = join(root, ".typst", "packages", "preview");

const download = async (url, destination) => {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
};

for (const pkg of PACKAGES) {
  const destination = join(packageRoot, pkg.name, pkg.version);
  const marker = join(destination, "typst.toml");
  if (existsSync(marker)) {
    console.log(`✓ ${pkg.name}@${pkg.version} already present`);
    continue;
  }

  const tarball = join(tmpdir(), `umler-${pkg.name}-${randomUUID()}.tar.gz`);
  const url = `https://packages.typst.org/preview/${pkg.name}-${pkg.version}.tar.gz`;

  console.log(`↓ ${pkg.name}@${pkg.version}`);
  await download(url, tarball);

  mkdirSync(destination, { recursive: true });
  const result = spawnSync("tar", ["-xzf", tarball, "-C", destination], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`tar failed for ${pkg.name}@${pkg.version}`);
  }
  console.log(`✓ ${pkg.name}@${pkg.version}`);
}

console.log(`\nTypst package path: ${join(root, ".typst", "packages")}`);
