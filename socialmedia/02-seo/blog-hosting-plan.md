# Where to Host the Blog — and How to Get RSS Out of It

> The brief asks two questions this file answers: *"Advise where I can post blogs — since I am using a static web page"* and, implicitly, how to produce the RSS feed the Blotato automation depends on.
>
> **The RSS feed the brief's automation assumes does not exist yet.** Neither does the blog. This is the foundation the whole content pipeline sits on.

---

## Current state

- `foodyzz.com` is **5 hand-written static HTML files** on Hostinger: `index`, `contact`, `privacy`, `terms`, `404`.
- Deployment is: upload the contents of `website/` into `public_html/`, hidden files included so `.htaccess` ships.
- `.htaccess` does real work: forces HTTPS, redirects `www` → apex, strips `.html` from URLs (`/contact.html` → `/contact`), strips trailing slashes, and rewrites internally back to `.html`.
- `sitemap.xml` lists 4 extensionless URLs. `robots.txt` allows everything.
- **There is no `/blog`, no CMS, no RSS, no markdown pipeline, no post template anywhere in the repo.**

Any blog solution must not break the `.htaccess` behaviour, because the extensionless URLs are already indexed.

---

## The options, honestly compared

| Option | SEO | Effort | Cost | RSS | Verdict |
|---|---|---|---|---|---|
| **A. Static site generator → `/blog` subdirectory** | **Best** — all authority accrues to foodyzz.com | Medium setup, low ongoing | $0 | Native, first-class | ✅ **Recommended** |
| B. Blog on a subdomain (`blog.foodyzz.com`) | Worse — Google treats subdomains as substantially separate; a new site gets none of the apex's authority and the apex gets none of the blog's | Low | $0 | Native | ❌ Don't |
| C. Hosted platform (Ghost/Substack/Medium) on their domain | Worst — you build *their* domain, not yours | Lowest | $0–$25/mo | Native | ❌ Don't |
| D. WordPress in a subdirectory on Hostinger | Good SEO, but a PHP+MySQL app bolted onto a static site | High ongoing (updates, security, spam) | Included in most Hostinger plans | Native, but **excludes featured images by default** | ⚠️ Only if you want a non-technical editor |
| E. Hand-write HTML posts | Same SEO as A | Punishing at 2 posts/week | $0 | **Would have to be hand-maintained — this is where it breaks** | ❌ Don't |

### Why subdirectory over subdomain

This is the one decision with a lasting cost. A subdirectory (`foodyzz.com/blog/...`) consolidates every link and every ranking signal into one domain. A subdomain splits them. For a brand-new domain with no authority — which is exactly what foodyzz.com is — splitting is strictly worse. There is no upside to trade against.

### Why not WordPress

It would work. But it means a database, a PHP runtime, a login to secure, plugin updates, and comment spam on a site that currently has 22 lines of JavaScript and a perfect security posture. And its RSS feed **omits featured images by default**, which is the number-one thing that breaks a WordPress→Blotato pipeline — every post would publish as text-only until you add a plugin or a `functions.php` filter. Pick D only if a non-technical person needs to publish without touching git.

---

## Recommendation: Astro, built into `website/blog/`

**Astro**, because it produces plain static HTML with no client-side JavaScript by default, its `@astrojs/rss` package is first-class, and it handles Markdown content collections with schema validation — which is exactly the shape of this workload.

Eleventy is an equally defensible choice if you prefer something smaller; Hugo is fine if you want a single binary and no Node. All three are fine. **The important decision was subdirectory-vs-subdomain, and that one is settled.**

### Structure

```
website/                    ← what gets uploaded to public_html/
  index.html                ← existing hand-written pages, untouched
  contact.html
  privacy.html
  terms.html
  .htaccess                 ← needs ONE addition, see below
  sitemap.xml               ← needs the blog URLs merged in
  blog/                     ← generated output, committed
    index.html
    nyc-ebike-laws-2026/index.html
    ...
  rss.xml                   ← 20 items, full content, for humans and search
  rss-latest.xml            ← 1–3 items, for the automation trigger

blog-src/                   ← Astro project, NOT uploaded
  src/content/blog/*.md
  astro.config.mjs          ← site: 'https://foodyzz.com', base: '/blog'
  package.json
```

Build with `outDir: '../website/blog'`. Commit the output so deployment stays "upload `website/`" with no build step on the server.

### The `.htaccess` change

The existing rules strip `.html` and rewrite internally. Astro emits directory-style URLs (`/blog/post-name/index.html`), which Apache serves natively via `DirectoryIndex`. **Add one exclusion so the existing rewrite rules skip `/blog`:**

```apache
# Leave /blog alone — Astro emits directory-index URLs that Apache serves natively
RewriteCond %{REQUEST_URI} ^/blog/ [OR]
RewriteCond %{REQUEST_URI} ^/rss
RewriteRule ^ - [L]
```

Place this **above** the existing extensionless-URL rules. Test `/contact`, `/contact.html`, `/blog/`, `/blog/some-post/` and `/rss.xml` after deploying — the trailing-slash-strip rule is the one most likely to fight with directory indexes.

### Two feeds, deliberately

```
/rss.xml          20 items, full content — for readers, Feedly, Google
/rss-latest.xml   1–3 items — for the n8n trigger
```

Blotato's own documentation says *"Make sure your RSS feed is configured to output only 1 item at a time"* for an automation trigger. The reason is that on its first poll, n8n has no `lastItemDate` stored — point it at a 20-item feed and it can fire on all twenty at once and publish twenty social posts in a burst. Two feeds costs nothing and removes the failure mode entirely.

---

## RSS non-negotiables

The full technical spec — including the n8n node's source code behaviour — is in [../00-research/rss-and-blotato-technical.md](../00-research/rss-and-blotato-technical.md). The five things that will break the pipeline if you get them wrong:

1. **A valid RFC-822 `<pubDate>` on every single item.** n8n's RSS trigger detects new items by comparing `item.isoDate` against a stored `lastItemDate`. No parseable date means either duplicate-posting on every poll, or silent never-firing. This is the highest-risk failure mode in the entire automation.
2. **Full HTML in `<content:encoded>`**, not a 160-character excerpt. The AI rewrite step needs real material; a truncated description produces thin social copy.
3. **Absolute URLs everywhere.** Blotato's `mediaUrls` requires publicly accessible URLs — a relative `/images/x.jpg` fails.
4. **An image exposed as `<enclosure>` or `<media:content>`.** Otherwise every post publishes as text-only. In Astro, `sanitize-html` strips `<img>` by default — you must `.concat(['img'])` or images silently vanish from the feed.
5. **Low item count on the trigger feed.** See above.

**Do not backdate posts or republish with an older date** — n8n will silently skip them. And two posts published in the same second can collide.

**Validate before connecting Blotato:** run the feed through https://validator.w3.org/feed/ (confirmed live, and its `check.cgi?url=` pattern is scriptable into CI), then point the n8n RSS trigger at it and hit "Fetch Test Event". Check that the output JSON has a parsed `isoDate`, non-empty `content`, and an absolute image URL. A feed can be perfectly valid RSS 2.0 and still break the pipeline.

---

## Google Business Profile & local SEO

### The blocker

Google Business Profile requires either a physical address customers can visit, or a **service-area business** with a verified address (which stays hidden) plus **a phone number**.

**Foodyzz currently publishes no phone number and no street address.** The site says only "Foodyzz HQ, New York, NY." That means **no GBP, no map pack, no `LocalBusiness` schema** — for a business whose entire market is a single city and whose competitors all have local presence.

**Getting a phone number is the single highest-ROI local-SEO action available, and it is a business decision, not a technical one.** See `../OPEN-QUESTIONS.md` Q7.

### Once a phone number exists

1. Create the GBP as a **service-area business**, service area = the boroughs actually served (Manhattan today).
2. Primary category: **Bicycle Rental Service**. Secondary: Electric Vehicle Charging Station is wrong; consider Bicycle Store.
3. Verification is usually by postcard to the real address, sometimes video. Budget 1–2 weeks.
4. Add hours. The only defensible published hours today are the **5:00–9:00 PM delivery window** — but that is a delivery window, not support hours. Decide and publish real ones.
5. Add photos: the bike, the certification mark on the frame, a delivery in progress. GBP rewards photo volume.
6. Add products for each plan with real prices.
7. **Reviews:** ask every customer after a successful return or a rent-to-buy payoff. Never incentivise, never gate. Respond to all of them.

### NAP consistency

Name, Address, Phone must match **byte-for-byte** everywhere: GBP, the website footer, the app stores, Facebook, and any directory. Inconsistency is the most common local-SEO own goal.

### Schema to add

The site already has a strong JSON-LD `@graph` — `Organization`, `WebSite`, two `MobileApplication` nodes, `Service` with an offer catalogue, and a 7-question `FAQPage`. Genuinely good work. What's missing:

- **`Product` + `Offer` with the real prices** for both models and all three plans. Currently the `Service` node has an offer catalogue with no prices. This is the biggest schema gap and it directly feeds rich results.
- **`LocalBusiness`** — blocked on the phone/address.
- **`BreadcrumbList`** on the home page and every blog post.
- **`BlogPosting`** on each post, with `datePublished` and `dateModified`.
- **`AggregateRating`** — only once real reviews exist. **Never fabricate this.**

### Other technical fixes

- **Meta description on the home page is 232 characters** — it will truncate in results. Cut to ~155.
- **Merge blog URLs into `sitemap.xml`**, or emit a sitemap index with a separate blog sitemap. Astro can generate this.
- **Submit to Google Search Console and Bing Webmaster Tools** on day one. There is currently no verification meta tag on the site.
- **`hreflang`** once Spanish and French pages exist — Whizz already does this correctly and it is why their `/es/` pages rank.
