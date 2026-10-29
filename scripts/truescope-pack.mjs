#!/usr/bin/env node
// Build a self-contained, npm-installable cyrus-ai tarball for the Truescope fork.
//
// Usage (after `pnpm install && pnpm build`):
//   node scripts/truescope-pack.mjs <out-dir> [version]
//
// Uses `pnpm deploy` with a hoisted (npm-style) node_modules, then bundles the
// whole tree via bundleDependencies so `npm install -g <tgz>` installs exactly
// what was built — including the fork's patched cyrus-* packages — without
// resolving anything from the registry.
//
// The tarball contains platform-specific binaries (Claude SDK, Codex, Cursor),
// so it only works on the OS/CPU it was built on. CI builds one per arch.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [outArg, versionArg] = process.argv.slice(2);
if (!outArg) {
	console.error("usage: truescope-pack.mjs <out-dir> [version]");
	process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const out = resolve(outArg);
// npm tarballs keep their contents under a top-level `package/` directory.
const app = join(out, "package");
rmSync(out, { recursive: true, force: true });

const run = (cmd, args, cwd) =>
	execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] })
		.toString()
		.trim();
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
// Unlink before writing so an edit can never leak back into the source tree
// through a hard link (pnpm's default import method on Linux).
const writeJson = (f, v) => {
	rmSync(f);
	writeFileSync(f, `${JSON.stringify(v, null, "\t")}\n`);
};

run(
	"pnpm",
	[
		"--filter",
		"cyrus-ai",
		"deploy",
		"--prod",
		"--legacy",
		"--config.node-linker=hoisted",
		// Real copies, not hard links: npm drops hard-link entries when it
		// unpacks a tarball, and on Linux pnpm hard-links identical files.
		"--config.package-import-method=copy",
		app,
	],
	root,
);

// npm rejects `workspace:` ranges even on bundled packages, so pin them to the
// bundled versions in cyrus-ai and every bundled cyrus-* package.
const modules = join(app, "node_modules");
const versions = Object.fromEntries(
	readdirSync(modules)
		.filter((name) => name.startsWith("cyrus-"))
		.map((name) => [
			name,
			readJson(join(modules, name, "package.json")).version,
		]),
);
const pinWorkspaceRanges = (file) => {
	const pkg = readJson(file);
	for (const field of [
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
			if (!range.startsWith("workspace:")) continue;
			if (!versions[dep]) throw new Error(`${file}: ${dep} is not bundled`);
			pkg[field][dep] = versions[dep];
		}
	}
	delete pkg.devDependencies;
	return pkg;
};
for (const name of Object.keys(versions)) {
	const file = join(modules, name, "package.json");
	writeJson(file, pinWorkspaceRanges(file));
}

const appPkg = pinWorkspaceRanges(join(app, "package.json"));
if (versionArg) appPkg.version = versionArg;
appPkg.bundleDependencies = true;
delete appPkg.scripts;
writeJson(join(app, "package.json"), appPkg);

// pnpm leaves its own state files behind; they must not ship.
for (const f of [".modules.yaml", ".pnpm-workspace-state-v1.json", ".pnpm"]) {
	if (existsSync(join(modules, f)))
		rmSync(join(modules, f), { recursive: true });
}

// Tar it ourselves: `npm pack` crashes ("Exit handler never called") on a
// tree this size on Linux. .bin links are recreated by npm on install.
const tgz = join(out, `cyrus-ai-${appPkg.version}.tgz`);
run("tar", ["-czf", tgz, "--exclude=.bin", "-C", out, "package"], out);
rmSync(app, { recursive: true, force: true });
console.log(tgz);
