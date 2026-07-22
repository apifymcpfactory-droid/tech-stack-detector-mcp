import { describe, expect, it } from 'vitest';

import { extractMetas, extractScriptSrcs, looksBlocked, parseCookies } from '../src/lib/fetchPage.js';

describe('extractMetas', () => {
    it('extracts name-based meta tags', () => {
        const html = '<meta name="generator" content="WordPress 6.4">';
        expect(extractMetas(html)).toEqual({ generator: ['WordPress 6.4'] });
    });

    it('extracts property-based (OpenGraph-style) meta tags', () => {
        const html = '<meta property="og:site_name" content="Example">';
        expect(extractMetas(html)).toEqual({ 'og:site_name': ['Example'] });
    });

    it('collects multiple values for a repeated meta name', () => {
        const html = '<meta name="tag" content="a"><meta name="tag" content="b">';
        expect(extractMetas(html)).toEqual({ tag: ['a', 'b'] });
    });

    it('handles single-quoted and unquoted attribute values', () => {
        const html = `<meta name='generator' content='Ghost 5'>`;
        expect(extractMetas(html)).toEqual({ generator: ['Ghost 5'] });
    });

    it('ignores meta tags with no name/property or no content', () => {
        expect(extractMetas('<meta charset="utf-8">')).toEqual({});
    });
});

describe('extractScriptSrcs', () => {
    it('extracts script src attributes', () => {
        const html = '<script src="https://cdn.example.com/wp-includes/js/wp-embed.js"></script>';
        expect(extractScriptSrcs(html)).toEqual(['https://cdn.example.com/wp-includes/js/wp-embed.js']);
    });

    it('ignores inline scripts with no src', () => {
        expect(extractScriptSrcs('<script>console.log(1)</script>')).toEqual([]);
    });

    it('extracts multiple script tags in order', () => {
        const html = '<script src="/a.js"></script><script src="/b.js"></script>';
        expect(extractScriptSrcs(html)).toEqual(['/a.js', '/b.js']);
    });
});

describe('parseCookies', () => {
    it('parses name=value pairs from Set-Cookie lines', () => {
        expect(parseCookies(['sessionid=abc123; Path=/; HttpOnly', 'woocommerce_cart_hash=xyz; Path=/'])).toEqual({
            sessionid: 'abc123',
            woocommerce_cart_hash: 'xyz',
        });
    });

    it('returns an empty object for no cookies', () => {
        expect(parseCookies([])).toEqual({});
    });
});

describe('looksBlocked', () => {
    it('flags 403 and 429 as blocked', () => {
        expect(looksBlocked(403, {}, '<html></html>')).toBe(true);
        expect(looksBlocked(429, {}, '<html></html>')).toBe(true);
    });

    it('flags a Cloudflare JS challenge (503 + marker text)', () => {
        expect(looksBlocked(503, { server: 'cloudflare' }, 'Checking your browser before accessing example.com')).toBe(true);
    });

    it('does not flag an ordinary 503 with no challenge markers', () => {
        expect(looksBlocked(503, { server: 'nginx' }, '<html><body>Service temporarily unavailable</body></html>')).toBe(false);
    });

    it('flags known captcha/challenge markers regardless of status', () => {
        expect(looksBlocked(200, {}, '<script src="https://example.com/captcha-delivery.com/tags.js"></script>')).toBe(true);
    });

    it('does not flag an ordinary page with no tech and no block signals', () => {
        expect(looksBlocked(200, { server: 'nginx' }, '<html><body>Hello world</body></html>')).toBe(false);
    });

    it('does not flag a normal 404 page', () => {
        expect(looksBlocked(404, {}, '<html><body>Page not found</body></html>')).toBe(false);
    });
});
