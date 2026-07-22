// Fetches a single page with native fetch — no headless browser, no crawling
// beyond the redirects the page itself issues. Body is read from a stream and
// capped at MAX_BODY_BYTES; a huge page never gets buffered whole in memory.

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (compatible; TechStackDetectorBot/1.0; +https://mcpize.com/mcp/tech-stack-detector-mcp)';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512 * 1024;

export class UnreachableError extends Error {}

export interface PageSignals {
    finalUrl: string;
    httpStatus: number;
    headers: Record<string, string>;
    cookies: Record<string, string>;
    metas: Record<string, string[]>;
    scriptSrcs: string[];
    html: string;
    blocked: boolean;
}

const describeFetchError = (error: unknown): string => {
    if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return `Request timed out after ${FETCH_TIMEOUT_MS}ms`;
        }
        return error.message;
    }
    return String(error);
};

// Reads at most `maxBytes` from the response body, then cancels the stream so
// the underlying connection stops downloading the rest of a huge page.
const readCappedBody = async (response: Response, maxBytes: number): Promise<string> => {
    const body = response.body;
    if (!body) return '';

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let received = 0;
    let html = '';

    try {
        while (received < maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            html += decoder.decode(value, { stream: true });
        }
    } finally {
        await reader.cancel().catch(() => {});
    }

    return html;
};

const parseCookies = (setCookieList: string[]): Record<string, string> => {
    const cookies: Record<string, string> = {};
    for (const line of setCookieList) {
        const [pair] = line.split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) {
            cookies[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
        }
    }
    return cookies;
};

export { parseCookies };

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const extractAttrs = (tag: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTR_RE.exec(tag))) {
        attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
    }
    return attrs;
};

// Regex-based, not a DOM parser — matches Cheerio's `meta[name], meta[property]`
// selection closely enough for fingerprint matching without adding a parser dependency.
const extractMetas = (html: string): Record<string, string[]> => {
    const metas: Record<string, string[]> = {};
    for (const tagMatch of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = extractAttrs(tagMatch[0]);
        const name = (attrs.name || attrs.property)?.toLowerCase();
        const content = attrs.content;
        if (!name || content === undefined) continue;
        (metas[name] ??= []).push(content);
    }
    return metas;
};

const extractScriptSrcs = (html: string): string[] => {
    const srcs: string[] = [];
    for (const tagMatch of html.matchAll(/<script\b[^>]*>/gi)) {
        const src = extractAttrs(tagMatch[0]).src;
        if (src) srcs.push(src);
    }
    return srcs;
};

export { extractMetas, extractScriptSrcs };

// Best-effort signatures for the common anti-bot/challenge walls. Deliberately
// conservative (specific markers, not generic "access denied" guessing) so we
// under-flag rather than mislabel a genuinely tech-free page as BLOCKED.
const BLOCK_STATUS_CODES = new Set([403, 429]);
const CHALLENGE_MARKERS: RegExp[] = [
    /just a moment/i,
    /checking your browser before accessing/i,
    /attention required[\s\S]{0,80}cloudflare/i,
    /captcha-delivery\.com/i,
    /Access to this page has been denied/i,
    /Please verify you are a human/i,
    /_Incapsula_resource/i,
    /perimeterx/i,
    /px-captcha/i,
    /Pardon Our Interruption/i,
    /distil_r_captcha/i,
];

const looksBlocked = (httpStatus: number, headers: Record<string, string>, html: string): boolean => {
    if (BLOCK_STATUS_CODES.has(httpStatus)) return true;
    // Cloudflare often serves its JS challenge as a 503 while the browser check runs.
    if (httpStatus === 503 && /cloudflare/i.test(headers.server ?? '') && /(just a moment|checking your browser)/i.test(html)) {
        return true;
    }
    return CHALLENGE_MARKERS.some((pattern) => pattern.test(html));
};

export { looksBlocked };

export async function fetchPageSignals(url: URL, userAgent: string): Promise<PageSignals> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': userAgent,
                Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch (error) {
        throw new UnreachableError(describeFetchError(error));
    }

    const html = await readCappedBody(response, MAX_BODY_BYTES);

    const headers: Record<string, string> = {};
    for (const [name, value] of response.headers.entries()) {
        headers[name.toLowerCase()] = value;
    }
    const setCookieList = response.headers.getSetCookie?.() ?? [];
    if (setCookieList.length) headers['set-cookie'] = setCookieList.join(', ');

    return {
        finalUrl: response.url || url.toString(),
        httpStatus: response.status,
        headers,
        cookies: parseCookies(setCookieList),
        metas: extractMetas(html),
        scriptSrcs: extractScriptSrcs(html),
        html,
        blocked: looksBlocked(response.status, headers, html),
    };
}
