const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

// Accepts "example.com", "www.example.com", "https://example.com/path?x=1".
// Adds "https://" when no scheme is present. Returns null for anything that
// isn't a well-formed http(s) URL — callers must treat null as INVALID_INPUT
// and never fetch it.
export function normalizeTargetUrl(raw: string): URL | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;

    return url;
}
