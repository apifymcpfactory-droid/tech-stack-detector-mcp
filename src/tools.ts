/**
 * Pure tool functions — business logic only, no MCP dependency.
 * Each function is registered as an MCP tool in index.ts.
 *
 * This separation makes tools easy to unit test without MCP infrastructure.
 */

import { detectTechnologies } from './lib/detect.js';
import { DEFAULT_USER_AGENT, fetchPageSignals, UnreachableError } from './lib/fetchPage.js';
import { normalizeTargetUrl } from './lib/normalize.js';
import type { BulkDetectResult, DetectStackResult, DetectStatus } from './types.js';

// Pages are heavier than a VAT lookup — stay gentle on both the target sites and our own memory budget.
const MAX_BULK_SIZE = 50;
const BULK_CONCURRENCY = 5;

const emptyResult = (
    input: string,
    status: DetectStatus,
    finalUrl: string | null = null,
    httpStatus: number | null = null,
): DetectStackResult => ({
    input,
    finalUrl,
    httpStatus,
    status,
    technologies: [],
    categoriesSummary: {},
});

export interface DetectOptions {
    userAgent?: string | null;
}

// Detects the technology stack behind one URL. Normalizes the URL locally first
// — anything that isn't a well-formed http(s) address returns INVALID_INPUT
// without ever making a request. Fetches the page once (following only the
// redirects it issues itself), caps how much of the body is read, and matches
// fingerprints against headers/cookies/meta tags/script srcs/HTML. Honestly
// distinguishes a blocked/anti-bot response from a page that simply has no
// recognizable technology — collapsing the two is the main way naive
// detectors mislead.
export async function detectStack(rawUrl: string, options: DetectOptions = {}): Promise<DetectStackResult> {
    const input = rawUrl ?? '';
    const url = normalizeTargetUrl(input);
    if (!url) return emptyResult(input, 'INVALID_INPUT');

    const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;

    try {
        const page = await fetchPageSignals(url, userAgent);

        if (page.blocked) {
            return emptyResult(input, 'BLOCKED', page.finalUrl, page.httpStatus);
        }

        const detected = detectTechnologies({
            headers: page.headers,
            metas: page.metas,
            html: page.html,
            scriptSrcs: page.scriptSrcs,
            cookies: page.cookies,
        });

        const categoriesSummary: Record<string, number> = {};
        for (const tech of detected) {
            for (const category of tech.categories) {
                categoriesSummary[category] = (categoriesSummary[category] ?? 0) + 1;
            }
        }

        return {
            input,
            finalUrl: page.finalUrl,
            httpStatus: page.httpStatus,
            status: detected.length > 0 ? 'OK' : 'NO_TECH_DETECTED',
            technologies: detected.map((tech) => ({
                name: tech.name,
                category: tech.categories[0] ?? 'Miscellaneous',
                confidence: tech.confidence,
                evidence: tech.evidence,
            })),
            categoriesSummary,
        };
    } catch (error) {
        if (error instanceof UnreachableError) {
            return emptyResult(input, 'UNREACHABLE');
        }
        return emptyResult(input, 'UNREACHABLE');
    }
}

// Detects the stack for up to MAX_BULK_SIZE URLs using a small worker pool
// (never Promise.all-ing the whole array). Each worker writes its result
// straight into `results[index]` as soon as it completes. A single URL's
// failure never fails the batch.
export async function bulkDetectStack(urls: string[], options: DetectOptions = {}): Promise<BulkDetectResult> {
    if (urls.length > MAX_BULK_SIZE) {
        throw new Error(
            `bulk_detect_stack accepts at most ${MAX_BULK_SIZE} URLs per call; received ${urls.length}. Split into smaller batches.`,
        );
    }

    const results: DetectStackResult[] = new Array(urls.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
        while (nextIndex < urls.length) {
            const index = nextIndex++;
            results[index] = await detectStack(urls[index], options);
        }
    };

    const workerCount = Math.min(BULK_CONCURRENCY, urls.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    const summary = { total: results.length, ok: 0, no_tech: 0, unreachable: 0, blocked: 0, invalid_input: 0 };
    for (const result of results) {
        if (result.status === 'OK') summary.ok++;
        else if (result.status === 'NO_TECH_DETECTED') summary.no_tech++;
        else if (result.status === 'UNREACHABLE') summary.unreachable++;
        else if (result.status === 'BLOCKED') summary.blocked++;
        else summary.invalid_input++;
    }

    return { results, summary };
}

export { MAX_BULK_SIZE };
