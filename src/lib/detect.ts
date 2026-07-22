// Local technology-detection engine over the bundled webappanalyzer fingerprint
// dataset (community-maintained Wappalyzer fork; see scripts/update-fingerprints.mjs
// for how src/fingerprints/*.json gets refreshed). All matching happens in-process
// against a page's headers/cookies/meta tags/script srcs/HTML — no network calls,
// no headless browser.
//
// Ported from the apifmcpfactory/tech-stack-detector Apify Actor's detection core,
// with per-technology evidence tracking added so callers can see *why* a match fired.
import { readFileSync } from 'node:fs';

interface RawTechnology {
    cats?: number[];
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    meta?: Record<string, string | string[]>;
    html?: string | string[];
    scriptSrc?: string | string[];
    implies?: string | string[];
}

interface Pattern {
    regex: RegExp | null;
    confidence: number;
    version: string | null;
}

interface NamedPatterns {
    name: string;
    patterns: Pattern[];
}

interface CompiledTechnology {
    name: string;
    cats: number[];
    headers: NamedPatterns[];
    cookies: NamedPatterns[];
    meta: NamedPatterns[];
    html: Pattern[];
    scriptSrc: Pattern[];
    implies: { name: string; confidence: number }[];
}

export interface DetectionInput {
    headers: Record<string, string | string[] | undefined>;
    metas: Record<string, string[]>;
    html: string;
    scriptSrcs: string[];
    cookies: Record<string, string>;
}

export interface DetectedTechnology {
    name: string;
    categories: string[];
    version: string | null;
    confidence: number;
    evidence: string;
}

// Only this much of the page HTML is scanned, matching the cap already applied
// when the page was fetched (see lib/fetchPage.ts) — kept here too as a safety
// net for callers that pass in a larger string directly (e.g. tests).
const HTML_SCAN_LIMIT = 512 * 1024;

// Fingerprint patterns look like "regex\;confidence:50\;version:\1".
const parsePattern = (raw: string): Pattern => {
    const [source, ...tags] = raw.split('\\;');
    let confidence = 100;
    let version: string | null = null;
    for (const tag of tags) {
        if (tag.startsWith('confidence:')) confidence = Number(tag.slice('confidence:'.length)) || 0;
        if (tag.startsWith('version:')) version = tag.slice('version:'.length);
    }
    let regex: RegExp | null = null;
    try {
        regex = new RegExp(source, 'i');
    } catch {
        // A few dataset regexes are not valid JavaScript regexes — skip those patterns.
    }
    return { regex, confidence, version };
};

const toPatternList = (value: string | string[] | undefined): Pattern[] => {
    if (value === undefined) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map(parsePattern);
};

const toNamedPatterns = (value: Record<string, string | string[]> | undefined): NamedPatterns[] => {
    if (!value) return [];
    return Object.entries(value).map(([name, raw]) => ({
        name: name.toLowerCase(),
        patterns: toPatternList(raw),
    }));
};

const parseImplies = (value: string | string[] | undefined): { name: string; confidence: number }[] => {
    if (value === undefined) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((raw) => {
        const [name, ...tags] = raw.split('\\;');
        let confidence = 100;
        for (const tag of tags) {
            if (tag.startsWith('confidence:')) confidence = Number(tag.slice('confidence:'.length)) || 0;
        }
        return { name, confidence };
    });
};

// Resolves version templates like "\1" or "\1?found:fallback" using regex capture groups.
const resolveVersion = (template: string, match: RegExpExecArray): string | null => {
    const ternary = template.match(/^(.*)\?([^:]*)(?::(.*))?$/);
    const substitute = (t: string): string => t.replace(/\\(\d)/g, (_, digit) => match[Number(digit)] ?? '');
    let version: string;
    if (ternary) {
        version = substitute(ternary[1]) ? substitute(ternary[2]) : substitute(ternary[3] ?? '');
    } else {
        version = substitute(template);
    }
    version = version.trim();
    return version || null;
};

// Resolves relative to this compiled file, so it works identically under `tsx`
// (src/lib/detect.ts -> src/fingerprints/*.json) and after `tsc` (build copies
// src/fingerprints/ to dist/fingerprints/ — see scripts/copy-fingerprints.mjs).
const loadJson = (fileName: string): unknown => {
    const url = new URL(`../fingerprints/${fileName}`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
};

const categoryNames = new Map<number, string>();
const technologies: CompiledTechnology[] = [];
const technologyByName = new Map<string, CompiledTechnology>();

const initialize = (): void => {
    const rawCategories = loadJson('categories.json') as Record<string, { name: string }>;
    for (const [id, category] of Object.entries(rawCategories)) {
        categoryNames.set(Number(id), category.name);
    }

    const rawTechnologies = loadJson('technologies.json') as Record<string, RawTechnology>;
    for (const [name, raw] of Object.entries(rawTechnologies)) {
        const compiled: CompiledTechnology = {
            name,
            cats: raw.cats ?? [],
            headers: toNamedPatterns(raw.headers),
            cookies: toNamedPatterns(raw.cookies),
            meta: toNamedPatterns(raw.meta as Record<string, string | string[]> | undefined),
            html: toPatternList(raw.html),
            scriptSrc: toPatternList(raw.scriptSrc),
            implies: parseImplies(raw.implies),
        };
        technologies.push(compiled);
        technologyByName.set(name, compiled);
    }
};

initialize();

interface Hit {
    confidence: number;
    version: string | null;
    evidence: Set<string>;
}

const testPatterns = (patterns: Pattern[], value: string, hit: Hit, evidenceLabel: string): void => {
    for (const pattern of patterns) {
        if (!pattern.regex) continue;
        const match = pattern.regex.exec(value);
        if (!match) continue;
        hit.confidence = Math.min(100, hit.confidence + pattern.confidence);
        if (pattern.version && !hit.version) {
            hit.version = resolveVersion(pattern.version, match);
        }
        hit.evidence.add(evidenceLabel);
    }
};

const describeEvidence = (evidence: Set<string>): string => [...evidence].slice(0, 3).join(', ');

export const detectTechnologies = (input: DetectionInput): DetectedTechnology[] => {
    const html = input.html.slice(0, HTML_SCAN_LIMIT);
    const headerMap = new Map<string, string>();
    for (const [name, value] of Object.entries(input.headers)) {
        if (value === undefined) continue;
        headerMap.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value);
    }

    const hits = new Map<string, Hit>();

    for (const tech of technologies) {
        const hit: Hit = { confidence: 0, version: null, evidence: new Set() };

        for (const { name, patterns } of tech.headers) {
            const value = headerMap.get(name);
            if (value !== undefined) testPatterns(patterns, value, hit, `header: ${name}`);
        }
        for (const { name, patterns } of tech.cookies) {
            const value = input.cookies[name] ?? input.cookies[name.toLowerCase()];
            if (value !== undefined) testPatterns(patterns, value, hit, `cookie: ${name}`);
        }
        for (const { name, patterns } of tech.meta) {
            for (const content of input.metas[name] ?? []) {
                testPatterns(patterns, content, hit, `meta: ${name}`);
            }
        }
        for (const src of input.scriptSrcs) {
            testPatterns(tech.scriptSrc, src, hit, 'script src');
        }
        if (tech.html.length > 0) testPatterns(tech.html, html, hit, 'html markup');

        if (hit.confidence > 0) hits.set(tech.name, hit);
    }

    // Apply "implies" relationships transitively (e.g. WooCommerce implies WordPress).
    const queue = [...hits.keys()];
    while (queue.length > 0) {
        const name = queue.pop()!;
        const tech = technologyByName.get(name);
        const hit = hits.get(name);
        if (!tech || !hit) continue;
        for (const implied of tech.implies) {
            if (!technologyByName.has(implied.name)) continue;
            const impliedConfidence = Math.min(hit.confidence, implied.confidence);
            const existing = hits.get(implied.name);
            if (existing) {
                existing.confidence = Math.min(100, Math.max(existing.confidence, impliedConfidence));
            } else {
                hits.set(implied.name, { confidence: impliedConfidence, version: null, evidence: new Set([`implied by ${name}`]) });
                queue.push(implied.name);
            }
        }
    }

    const results: DetectedTechnology[] = [];
    for (const [name, hit] of hits) {
        const tech = technologyByName.get(name)!;
        results.push({
            name,
            categories: tech.cats.map((id) => categoryNames.get(id) ?? `Category ${id}`),
            version: hit.version,
            confidence: hit.confidence,
            evidence: describeEvidence(hit.evidence),
        });
    }
    results.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
    return results;
};

export const datasetStats = {
    technologyCount: technologies.length,
    categoryCount: categoryNames.size,
};
