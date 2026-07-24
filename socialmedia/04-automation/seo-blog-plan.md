# SEO & Blog Plan — Decision: Static Blog, No Arvow

## The question
Arvow can't publish to a hand-coded static HTML site (it needs WordPress/Ghost/Webflow/Wix). The site
(`htmlweb/`, live at unihamper.com) is static. So: do we even need Arvow?

## Decision: **No Arvow. Build a static blog inside `htmlweb/blog/`.**
We already control the static site and can update it anytime. A static blog is actually **better** for
a brand-new site racing to rank: it's the fastest-loading option (Core Web Vitals = ranking factor),
has zero monthly cost, no CMS to secure/maintain, and gives us total control over on-page SEO. The only
thing Arvow gave us that we lose is *hands-off autoblog volume* — and we replace that with the
`content-creator` subagent generating posts on demand, which we then commit as static HTML.

### Why this beats adding WordPress/Arvow right now
| | Static blog (chosen) | WordPress + Arvow |
|---|---|---|
| Cost | $0 | ~$39+/mo Arvow + WP hosting/plugins |
| Speed / Core Web Vitals | 🟢 Fastest | 🟡 Heavier |
| Maintenance/security | 🟢 None | 🔴 WP updates, plugins, spam |
| Control over SEO/markup | 🟢 Total | 🟡 Theme-limited |
| Hands-off volume | 🟡 Subagent-assisted | 🟢 Fully auto |
| Fits "keep updating the site we built" | 🟢 Yes | 🔴 New stack |

**Revisit Arvow/WordPress only if** we later want 20–40 auto-published posts/month and don't mind the
cost + maintenance. For launch and the first few months, static wins.

## How the static blog works
```
content-creator subagent  ─▶  writes SEO post (markdown in 01-blog/drafts/)
        │
        ▼  (Claude renders to HTML using the site's template)
htmlweb/blog/<slug>.html   ─▶  commit + upload to Hostinger public_html/blog/
        │
        ├─▶ update htmlweb/sitemap.xml   (add the new URL)
        └─▶ update htmlweb/blog/feed.xml (hand-built RSS — powers the Blotato social pipeline)
        │
        ▼
Google Search Console  ─▶  submit sitemap / request indexing (replaces Arvow's auto-index)
```

### Structure to add to the site
```
htmlweb/
├── blog/
│   ├── index.html          ← blog landing (lists posts, links from homepage nav)
│   ├── feed.xml            ← RSS 2.0 feed (we maintain it; triggers social pipeline)
│   ├── how-to-do-laundry-in-college.html
│   └── uber-for-laundry.html
```
Each post inherits the homepage's `<head>` SEO pattern (title, meta description, canonical, OG/Twitter,
`max-image-preview:large`) **plus** `Article` + `BreadcrumbList` **JSON-LD schema** and a
`published/modified` date. The `content-creator` already writes meta title, description, slug, H1/H2/H3,
and internal links — so drafts are render-ready.

## On-page SEO checklist (per post)
- One `<h1>` = primary keyword, natural. Descriptive H2/H3.
- `<title>` ≤ 60 chars, meta description ≤ 155 chars (both already in drafts).
- Canonical URL, OG + Twitter tags, `Article` JSON-LD (author=UniHamper, datePublished).
- 3–5 internal links (to other posts + app CTAs: "Request a pickup", "List your laundromat").
- Descriptive image `alt` text; compressed images; lazy-load below the fold.
- Add the URL to `sitemap.xml` and `feed.xml`; ping Search Console.

## Free/cheap SEO tool stack (replaces Arvow)
- **Google Search Console** — submit sitemap, monitor indexing + queries. Free. (Add the verification token — the site's `<head>` already has a placeholder for it.) 🔴 Do this first.
- **Bing Webmaster Tools** — free, quick win.
- **Google Business Profiles** — for laundromats once onboarded (local SEO).
- **Keyword research** — Google autocomplete + "People also ask" + free tier of Ubersuggest/Keywords Everywhere; the `marketing-strategist` already produced `keyword-map.md`.
- **Schema** — hand-added JSON-LD (Article, FAQ, LocalBusiness later per campus).

## Publishing cadence
- **content-creator** drafts 1–2 posts/week from `blog-backlog.md` (12 unblocked titles ready).
- Claude renders + commits to `htmlweb/blog/`, updates sitemap + feed, you upload to Hostinger.
- Start with the 2 finished drafts (`01-blog/drafts/`) as the first posts.

## Brand-consistency note (found while inspecting the site)
`htmlweb/index.html` uses `theme-color=#3B4FE0` (blue) and a blue-ish OG image, but the confirmed brand
(mktweb) is **neo-brutalist orange `#FF4D00`**. Minor inconsistency to reconcile: align the static site's
theme-color/OG to the orange brand kit when convenient (not a launch blocker). ⚠️ CONFIRM direction.

## What Blotato still needs from this
The hand-built `feed.xml` is the RSS trigger the social pipeline reads (see `blotato-publishing.md`).
So even without Arvow, Stage 5 ("social content from RSS") works — we just author the feed ourselves.
