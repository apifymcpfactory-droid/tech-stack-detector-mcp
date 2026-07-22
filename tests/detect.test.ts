import { describe, expect, it } from 'vitest';

import { datasetStats, detectTechnologies } from '../src/lib/detect.js';

const emptyInput = { headers: {}, metas: {}, html: '', scriptSrcs: [], cookies: {} };

describe('detectTechnologies', () => {
    it('loaded the bundled fingerprint dataset', () => {
        expect(datasetStats.technologyCount).toBeGreaterThan(1000);
        expect(datasetStats.categoryCount).toBeGreaterThan(10);
    });

    it('detects WordPress via its meta generator tag, with version and evidence', () => {
        const results = detectTechnologies({
            ...emptyInput,
            metas: { generator: ['WordPress 6.4'] },
        });
        const wp = results.find((r) => r.name === 'WordPress');
        expect(wp).toBeDefined();
        expect(wp!.version).toBe('6.4');
        expect(wp!.confidence).toBeGreaterThan(0);
        expect(wp!.evidence).toContain('meta: generator');
        expect(wp!.categories).toContain('CMS');
    });

    it('applies implies relationships transitively (WordPress implies PHP and MySQL)', () => {
        const results = detectTechnologies({
            ...emptyInput,
            metas: { generator: ['WordPress 6.4'] },
        });
        const names = results.map((r) => r.name);
        expect(names).toContain('PHP');
        expect(names).toContain('MySQL');
        const php = results.find((r) => r.name === 'PHP')!;
        expect(php.evidence).toBe('implied by WordPress');
    });

    it('detects Google Analytics via a cookie', () => {
        const results = detectTechnologies({
            ...emptyInput,
            cookies: { _ga: 'GA1.2.123456789.987654321' },
        });
        const ga = results.find((r) => r.name === 'Google Analytics');
        expect(ga).toBeDefined();
        expect(ga!.evidence).toContain('cookie: _ga');
        expect(ga!.categories).toContain('Analytics');
    });

    it('detects Cloudflare via a response header', () => {
        const results = detectTechnologies({
            ...emptyInput,
            headers: { server: 'cloudflare' },
        });
        const cf = results.find((r) => r.name === 'Cloudflare');
        expect(cf).toBeDefined();
        expect(cf!.evidence).toContain('header: server');
        expect(cf!.categories).toContain('CDN');
    });

    it('returns nothing for a page with no recognizable signals', () => {
        expect(detectTechnologies(emptyInput)).toEqual([]);
    });

    it('sorts results by confidence, descending', () => {
        const results = detectTechnologies({
            ...emptyInput,
            metas: { generator: ['WordPress 6.4'] },
            cookies: { _ga: 'GA1.2.1.1' },
        });
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
        }
    });
});
