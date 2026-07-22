import { describe, expect, it } from 'vitest';

import { normalizeTargetUrl } from '../src/lib/normalize.js';

describe('normalizeTargetUrl', () => {
    it('adds https:// when no scheme is present', () => {
        expect(normalizeTargetUrl('wordpress.org')?.toString()).toBe('https://wordpress.org/');
        expect(normalizeTargetUrl('www.example.com/path')?.toString()).toBe('https://www.example.com/path');
    });

    it('keeps an existing http(s) scheme', () => {
        expect(normalizeTargetUrl('http://example.com')?.toString()).toBe('http://example.com/');
        expect(normalizeTargetUrl('https://example.com/a?b=1')?.toString()).toBe('https://example.com/a?b=1');
    });

    it('rejects non-http(s) schemes', () => {
        expect(normalizeTargetUrl('ftp://example.com')).toBeNull();
        expect(normalizeTargetUrl('javascript:alert(1)')).toBeNull();
        expect(normalizeTargetUrl('file:///etc/passwd')).toBeNull();
    });

    it('rejects empty or malformed input', () => {
        expect(normalizeTargetUrl('')).toBeNull();
        expect(normalizeTargetUrl('   ')).toBeNull();
        expect(normalizeTargetUrl('not a url')).toBeNull();
        // @ts-expect-error testing non-string input defensively
        expect(normalizeTargetUrl(undefined)).toBeNull();
    });

    it('trims whitespace', () => {
        expect(normalizeTargetUrl('  example.com  ')?.hostname).toBe('example.com');
    });
});
