# Website Technology Detector: Tech Stack Scanner

Detect what technology any website runs on — CMS, web framework, JavaScript libraries, ecommerce platform, analytics/tag managers, web server, CDN, hosting, and marketing/pixel tags — from a single URL. A BuiltWith / Wappalyzer-style technology lookup, built as an MCP tool an agent can call directly.

An MCP server hosted on [MCPize](https://mcpize.com). Also published as an [Apify Actor](https://apify.com/apifmcpfactory/tech-stack-detector) with the same fingerprint core.

## What it does

Website Technology Detector fetches a single public page — the URL you give it, plus whatever redirect it issues — and matches its HTTP response headers, cookies, HTML markup, meta tags and `<script>` src patterns against a fingerprint dataset of over 7,500 technologies. It returns every technology it finds with a category, a confidence score, and the evidence that triggered the match. No headless browser: it's a plain, fast HTTP fetch, which is exactly why it's cheap enough to run in bulk.

**Who it's for:** agencies scoping a prospect's site before a pitch, sales and lead-gen teams qualifying leads by tech stack, competitive researchers tracking what tools competitors use, security teams doing passive recon on exposed software/versions, and developers who just want to know what a site is built with.

## Why it's built this way

- **Real fingerprint matching, not a guess** — the same webappanalyzer/Wappalyzer-style dataset used by well-known tech-lookup tools, refreshed monthly.
- **No headless browser** — a single lightweight `fetch`, capped and streamed, never a multi-second Puppeteer/Playwright launch. Fast and cheap enough to bulk-check dozens of sites.
- **Honest about failure** — a blocked or anti-bot-protected site is reported as `BLOCKED`, never silently reported as "no technology detected." That distinction is the main way naive detectors mislead people.
- **Confidence-scored, with evidence** — every technology comes with a 0-100 confidence score and a short note on what matched (a header, a cookie, a script src, markup), not a black-box yes/no.
- **Bulk-ready** — scan up to 50 URLs in one call, 5 at a time, with a pass/fail summary.
- **Nothing stored** — pages are fetched, matched, and forgotten. No crawling beyond the page you asked for.

## BuiltWith / Wappalyzer alternative

Both BuiltWith and the Wappalyzer browser extension are great for checking one site at a time by hand. This server wraps the same kind of fingerprint-matching technique as a structured MCP tool — call it from an agent, a script, or a workflow, get typed JSON back (not a page you have to read), and check up to 50 sites in a single call instead of one tab at a time.

## Use cases

- **Agency prospecting** — check what a prospect's current site is built on before a pitch or proposal.
- **Sales / lead-gen qualification** — filter a lead list by CMS or ecommerce platform (e.g. only Shopify or only WordPress sites).
- **Competitive research** — see which analytics, tag managers, or marketing tools competitors run.
- **Security recon** — passively identify exposed software and versions from public headers/markup as a first-pass reconnaissance step.
- **Bulk customer/lead-list enrichment** — run a CSV of domains through `bulk_detect_stack` to tag each one by platform.

## Tools

### `detect_stack`

Fetch one public page and detect its technology stack; returns validity, category, confidence and evidence per technology, and honestly distinguishes "blocked" from "nothing detected."

| Input | Type | Description |
| --- | --- | --- |
| `url` | `string` (required) | A website URL, e.g. `"https://wordpress.org"` or just `"wordpress.org"` (`https://` is assumed). |

Example call:

```json
{ "url": "wordpress.org" }
```

Example output:

```json
{
  "input": "wordpress.org",
  "finalUrl": "https://wordpress.org/",
  "httpStatus": 200,
  "status": "OK",
  "technologies": [
    { "name": "WordPress", "category": "CMS", "confidence": 100, "evidence": "meta: generator, html markup" },
    { "name": "PHP", "category": "Programming languages", "confidence": 100, "evidence": "implied by WordPress" },
    { "name": "Cloudflare", "category": "CDN", "confidence": 100, "evidence": "header: server" }
  ],
  "categoriesSummary": { "CMS": 1, "Programming languages": 1, "CDN": 1 }
}
```

### `bulk_detect_stack`

Detect the technology stack for up to 50 URLs in one call, processed 5-at-a-time; returns one result per URL plus a pass/fail summary. A single bad URL never fails the batch.

| Input | Type | Description |
| --- | --- | --- |
| `urls` | `string[]` (required) | 1-50 website URLs to scan. |

Example call:

```json
{ "urls": ["wordpress.org", "shopify.com"] }
```

Output: `{ results: [ per-url detect_stack objects ], summary: { total, ok, no_tech, unreachable, blocked, invalid_input } }`.

## FAQ

**What CMS does a site use?** Call `detect_stack` with the URL — if it's built on WordPress, Shopify, Wix, Drupal, Ghost, or any of thousands of other platforms, it'll show up under the CMS or Ecommerce category with a confidence score.

**How do I detect a website's framework?** Same call — JavaScript and web frameworks (React, Vue, Next.js, Laravel, Django, and hundreds more) are detected from script patterns and response headers alongside everything else.

**What technologies does a website use overall?** `detect_stack` returns every match in one call: CMS, frameworks, analytics, CDN, hosting, ecommerce, marketing pixels — not just one category at a time.

**Is this site on Shopify or WordPress?** Check the `technologies` array in the response for `"Shopify"` or `"WordPress"` by name, or check `categoriesSummary` for a quick `"Ecommerce"` vs `"CMS"` signal.

**Can I bulk-check a list of sites?** Yes — `bulk_detect_stack` accepts up to 50 URLs per call, checked 5 at a time. For larger lists, split into batches of 50.

**What if a site blocks the check?** You'll get `status: "BLOCKED"` (403, rate-limiting, or a known anti-bot/challenge wall) instead of a false "no technology detected." That distinction matters — a blocked check tells you nothing about the site's actual stack, so don't read it as one.

**Does it use a headless browser?** No. It's a single HTTP fetch of the page's HTML and headers — no JavaScript execution, no browser automation. That keeps it fast and keeps this server's own resource use low, but it also means technologies that only reveal themselves after client-side JavaScript runs won't be detected.

## Trust & limits

Fetches only the single public page at the URL you give it (and whatever redirect that page itself issues) — no login or paywall bypass, no anti-bot evasion, no crawling beyond that one page. The tool identifies itself honestly via its User-Agent. Nothing is stored: pages are fetched, matched against the fingerprint dataset, and forgotten. This is a lookup aid, not a guarantee — some technologies are genuinely undetectable without running JavaScript, and a low-confidence match is a hint, not a certainty.

## Using this from an AI agent (MCP)

```json
// detect_stack
{ "url": "wordpress.org" }

// bulk_detect_stack
{ "urls": ["wordpress.org", "shopify.com"] }
```

## Local development

```bash
npm install
npm run dev     # http://localhost:8080/mcp, hot reload
npm test        # vitest
npm run build   # tsc + copies the fingerprint dataset into dist/
```

## Deployment

```bash
mcpize login
mcpize deploy
mcpize publish --show
```

## License

MIT
