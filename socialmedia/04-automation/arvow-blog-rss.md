> ⛔ **DECISION (2026-07-09): We are NOT using Arvow.** unihamper.com is a static site (`htmlweb/`)
> and we control it directly, so we're building a **static blog + hand-built RSS** instead — faster,
> free, no CMS to maintain. See **[`seo-blog-plan.md`](seo-blog-plan.md)** for the actual plan.
> This file is kept only as the record of what Arvow does, in case we want auto-blog volume later.

---

# Arvow — Auto-Blog + RSS (evaluated, deferred)

Arvow (formerly Journalist AI) is an end-to-end AI SEO system: it finds low-competition keywords,
writes fully-formatted SEO articles (images, internal/external links, schema), **auto-publishes** to
your CMS, emits an **RSS feed**, and **submits each post to Google Search Console** for fast indexing.
It can autoblog from **keywords, RSS, YouTube, or news events**. From ~$39/mo, 150+ languages.

Docs: https://arvow.com/ · Autoblog: https://arvow.com/autoblog

## Why Arvow for UniHamper
- Turns our `00-strategy/keyword-map.md` into a steady stream of ranked blog posts with near-zero effort.
- The **RSS feed it produces is the trigger** for the social pipeline: new blog → captions → Blotato.
- Auto-indexing to Search Console matters a lot for a brand-new 0-authority domain racing to Aug 1.

## 🔴 The blocker to solve first (Hostinger CMS)
Arvow publishes into **WordPress, Ghost, Webflow, Wix, Shopify, or Blogger** — **not** a hand-coded
static HTML site. unihamper.com is currently "basic HTML on Hostinger." **Decision needed:**

- **Recommended:** install **WordPress on the Hostinger account** at a subpath/subdomain — e.g.
  `unihamper.com/blog` or `blog.unihamper.com`. Hostinger offers 1-click WordPress. Keep the marketing
  homepage as-is; WordPress only powers `/blog`. Arvow connects to WordPress cleanly and it gives us a
  native RSS feed at `/blog/feed/`.
- Alternatives: Ghost (clean, fast, native RSS) or Webflow CMS (if the site moves there later).

Until a supported CMS exists, Arvow can't auto-publish and there's no RSS. **Manual blog posting still
works** — the two ready drafts in `01-blog/drafts/` can be hand-posted meanwhile.

## Setup checklist (once CMS is chosen)
1. Stand up the CMS (WordPress on Hostinger recommended) at `/blog`. ⚠️ CONFIRM path.
2. Create Arvow account; connect the CMS (WordPress API/app-password). ⚠️ CONFIRM: Arvow key + CMS creds.
3. Connect **Google Search Console** for unihamper.com so Arvow can auto-submit for indexing.
4. Seed Arvow's keyword list from `00-strategy/keyword-map.md` (start with the 10 quick-wins).
5. Set autoblog cadence — start **2–3 posts/week**, ramp as authority grows. Keep human review ON at first.
6. Configure brand voice/guardrails in Arvow to match `brand-source-of-truth.md` (no invented prices, no $/lb, real CTAs). **Review the first 5 posts by hand** before trusting auto-publish — autoblog tools can hallucinate; our no-invented-facts rule is non-negotiable.

## Feeding vs. reviewing
- Let Arvow **draft**, but keep publishing **human-approved** through launch. A wrong price or a made-up
  campus in an indexed post is worse than a slower blog. Our subagents (`content-creator`) can also write
  the flagship pillar posts by hand (the two drafts already done) while Arvow handles volume/long-tail.

## RSS → social handoff
- WordPress RSS: `https://unihamper.com/blog/feed/` (verify actual path).
- The social pipeline (or n8n) watches this feed; each new item → `content-creator` generates 1–2
  captions/platform (per `caption-library.md`) → `graphic-designer` specs the visual → Blotato schedules.
- This is exactly the Stage 5 "social content from RSS" the brief asked for.

## ⚠️ CONFIRM items
- **CMS decision** (WordPress on Hostinger recommended) — the #1 unblocker
- Arvow account + API key; CMS credentials
- Google Search Console access for unihamper.com
- Confirm the RSS feed URL once the blog is live
- Keep auto-publish OFF until first 5 posts are human-verified

Sources: [Arvow](https://arvow.com/) · [Arvow Autoblog](https://arvow.com/autoblog) · [Review](https://thatmarketingbuddy.com/software/arvow)
