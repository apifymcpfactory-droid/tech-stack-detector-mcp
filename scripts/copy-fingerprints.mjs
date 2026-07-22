#!/usr/bin/env node
// tsc does not copy non-.ts assets, so the bundled fingerprint dataset needs
// an explicit copy into dist/ after every build — src/lib/detect.ts resolves
// it relative to its own compiled location (dist/lib/detect.js -> dist/fingerprints/).
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "src", "fingerprints");
const dest = path.join(root, "dist", "fingerprints");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

console.log(`Copied fingerprints to ${path.relative(root, dest)}`);
