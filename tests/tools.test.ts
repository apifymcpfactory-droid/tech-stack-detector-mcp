import { describe, expect, it, vi } from 'vitest';

import * as fetchPageModule from '../src/lib/fetchPage.js';
import { bulkDetectStack, detectStack, MAX_BULK_SIZE } from '../src/tools.js';

const basePage = {
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    headers: {},
    cookies: {},
    metas: {},
    scriptSrcs: [],
    html: '',
    blocked: false,
};

describe('detectStack', () => {
    it('returns INVALID_INPUT without fetching for an unparseable URL', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals');
        const result = await detectStack('not a url');
        expect(result).toMatchObject({ input: 'not a url', status: 'INVALID_INPUT', finalUrl: null, httpStatus: null });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('returns INVALID_INPUT for a non-http(s) scheme without fetching', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals');
        const result = await detectStack('javascript:alert(1)');
        expect(result.status).toBe('INVALID_INPUT');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('maps a network failure to UNREACHABLE, not NO_TECH_DETECTED', async () => {
        const spy = vi
            .spyOn(fetchPageModule, 'fetchPageSignals')
            .mockRejectedValue(new fetchPageModule.UnreachableError('DNS lookup failed'));
        const result = await detectStack('https://this-does-not-exist.example');
        expect(result.status).toBe('UNREACHABLE');
        spy.mockRestore();
    });

    it('maps a blocked response to BLOCKED, not NO_TECH_DETECTED', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockResolvedValue({
            ...basePage,
            httpStatus: 403,
            blocked: true,
        });
        const result = await detectStack('https://blocked.example');
        expect(result.status).toBe('BLOCKED');
        expect(result.technologies).toEqual([]);
        spy.mockRestore();
    });

    it('returns NO_TECH_DETECTED when the page fetches fine but nothing matches', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockResolvedValue({ ...basePage });
        const result = await detectStack('https://plain.example');
        expect(result.status).toBe('NO_TECH_DETECTED');
        expect(result.technologies).toEqual([]);
        spy.mockRestore();
    });

    it('returns OK with detected technologies and a categoriesSummary', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockResolvedValue({
            ...basePage,
            metas: { generator: ['WordPress 6.4'] },
        });
        const result = await detectStack('https://wp.example');
        expect(result.status).toBe('OK');
        expect(result.technologies.some((t) => t.name === 'WordPress')).toBe(true);
        expect(result.categoriesSummary.CMS).toBeGreaterThanOrEqual(1);
        spy.mockRestore();
    });
});

describe('bulkDetectStack', () => {
    it('rejects a batch larger than the hard cap with a clear message', async () => {
        const tooMany = Array.from({ length: MAX_BULK_SIZE + 1 }, (_, i) => `https://example.com/${i}`);
        await expect(bulkDetectStack(tooMany)).rejects.toThrow(/at most 50/);
    });

    it('never runs more than 5 fetches concurrently', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockImplementation(async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight--;
            return { ...basePage };
        });

        const urls = Array.from({ length: 15 }, (_, i) => `https://example.com/${i}`);
        await bulkDetectStack(urls);

        expect(maxInFlight).toBeLessThanOrEqual(5);
        spy.mockRestore();
    });

    it('preserves input order in the results array', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockImplementation(async (url: URL) => {
            const delay = url.toString().endsWith('/0') ? 20 : 1;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return { ...basePage, finalUrl: url.toString() };
        });

        const urls = ['https://example.com/0', 'https://example.com/1', 'https://example.com/2'];
        const { results } = await bulkDetectStack(urls);

        expect(results.map((r) => r.input)).toEqual(urls);
        spy.mockRestore();
    });

    it('never fails the whole batch on one bad URL, and the summary tallies correctly', async () => {
        const spy = vi.spyOn(fetchPageModule, 'fetchPageSignals').mockImplementation(async (url: URL) => {
            const href = url.toString();
            if (href.includes('unreachable')) throw new fetchPageModule.UnreachableError('boom');
            if (href.includes('blocked')) return { ...basePage, blocked: true };
            if (href.includes('wp')) return { ...basePage, metas: { generator: ['WordPress 6.4'] } };
            return { ...basePage };
        });

        const { results, summary } = await bulkDetectStack([
            'https://wp.example',
            'https://plain.example',
            'https://blocked.example',
            'https://unreachable.example',
            'not-a-url but invalid',
        ]);

        expect(results).toHaveLength(5);
        expect(summary).toEqual({ total: 5, ok: 1, no_tech: 1, unreachable: 1, blocked: 1, invalid_input: 1 });
        spy.mockRestore();
    });
});
