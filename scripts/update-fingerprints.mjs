// Downloads the webappanalyzer fingerprint dataset (community-maintained Wappalyzer fork)
// and bundles it into src/fingerprints/ so the server needs no network access at runtime
// to detect technologies. Usage: npm run update-fingerprints (then `npm run build` to
// refresh dist/fingerprints/ too).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src';
const OUT_DIR = path.join(process.cwd(), 'src', 'fingerprints');

const fetchJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    return res.json();
};

await mkdir(OUT_DIR, { recursive: true });

const categories = await fetchJson(`${BASE}/categories.json`);

// Technologies are split into 27 files: _.json plus a.json through z.json.
const letters = ['_', ...'abcdefghijklmnopqrstuvwxyz'];
const technologies = {};
for (const letter of letters) {
    const chunk = await fetchJson(`${BASE}/technologies/${letter}.json`);
    Object.assign(technologies, chunk);
    process.stdout.write(`${letter} `);
}
console.log();

await writeFile(path.join(OUT_DIR, 'categories.json'), JSON.stringify(categories));
await writeFile(path.join(OUT_DIR, 'technologies.json'), JSON.stringify(technologies));

console.log(`Saved ${Object.keys(technologies).length} technologies in ${Object.keys(categories).length} categories to ${OUT_DIR}`);
