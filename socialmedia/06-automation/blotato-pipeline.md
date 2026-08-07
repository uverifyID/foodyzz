# Blotato Publishing Pipeline

> The brief asks for social posts prepared for publishing via the Blotato API, driven from the blog RSS feed. This is the implementation plan.
>
> Full technical reference with source citations: [../00-research/rss-and-blotato-technical.md](../00-research/rss-and-blotato-technical.md).

---

## The finding that shapes the whole design

**Blotato has no native RSS support.** Not in the API, not in the web app. Its content-source endpoint accepts `youtube | tiktok | article | pdf | audio | twitter | text | perplexity-query` — there is no `rss` type, and a search of Blotato's full documentation export returns zero hits for RSS as a product feature.

Blotato is strictly the **publishing sink**. Something else has to poll the feed.

This is Blotato's own documented pattern, not an inference — their official template #8 uses RSS.app as an external feed generator and n8n's RSS Feed Trigger as the poller.

```
foodyzz.com/rss-latest.xml
      ↓
n8n RSS Feed Trigger        (poll every 15 min)
      ↓
dedupe on guid              (belt and braces)
      ↓
AI rewrite → per-platform copy
      ↓
human approval queue        ← see "the approval gate" below
      ↓
Blotato "Publish Post" ×N
      ↓
Instagram · Facebook · TikTok
```

---

## The approval gate — do not skip this

The brief says *"All content must be final, verified, and ready to schedule or publish."* Every claim Foodyzz makes about pricing, certification or NYC law is fact-checkable and consequential. An LLM rewriting a blog post into a caption can drop a qualifier — "up to 50 miles **in eco mode with pedal assist**" becomes "50 mile range" — and that is a false advertising claim published automatically.

**Recommendation: run the pipeline in draft mode.** Blotato's `POST /v2/posts` supports scheduling, and TikTok posts support `isDraft`. Have n8n generate the copy and stage it, then a person approves before it goes out. Ten seconds per post.

**Full autopilot is appropriate only for:** blog-link posts that quote the blog's own headline and first paragraph verbatim, with no rewriting. Anything that generates a *new* claim gets human eyes.

---

## Prerequisites

| # | Item | Status |
|---|---|---|
| 1 | A blog at `foodyzz.com/blog` | ❌ Doesn't exist — see [../02-seo/blog-hosting-plan.md](../02-seo/blog-hosting-plan.md) |
| 2 | `/rss.xml` and `/rss-latest.xml` | ❌ Doesn't exist |
| 3 | Blotato account, paid tier | ❌ |
| 4 | n8n (self-hosted free, or Cloud ~$24/mo) | ❌ |
| 5 | IG, FB, TikTok accounts connected in Blotato | ❌ Accounts not created yet |

**Costs:** Blotato Starter **$29/month** — and API access is **not tier-gated** above the free trial, so Starter is sufficient for the whole pipeline. (Blotato's docs: *"All paid plans include full API access. The free trial is the only state where API is restricted."*) n8n self-hosted is free. Total ~$29–53/month.

---

## Feed requirements — the five that break things

1. **A valid RFC-822 `<pubDate>` on every item.** n8n's RSS trigger detects new items by comparing `item.isoDate` against a stored `lastItemDate`. Miss it or emit an unparseable format and the trigger either fires on everything every poll (duplicate spam) or never fires at all. **This is the single highest-risk failure mode in the pipeline.**
2. **Full HTML in `<content:encoded>`.** A 160-character description gives the AI step nothing and produces thin copy.
3. **Absolute URLs everywhere.** Blotato's `mediaUrls` requires publicly accessible URLs; relative paths fail.
4. **An image as `<enclosure>` or `<media:content>`.** Otherwise every post publishes text-only. In Astro, `sanitize-html` strips `<img>` by default — you must `.concat(['img'])` or images vanish silently.
5. **1–3 items on the trigger feed.** On first run n8n has no `lastItemDate` stored; a 20-item feed can fire on all twenty at once.

**Also:** never backdate a post or republish with an older date — n8n will silently skip it. Two posts in the same second can collide.

---

## Blotato API essentials

**Base:** `https://backend.blotato.com/v2` · **Auth header:** `blotato-api-key: YOUR_KEY`
*API keys may end in `=` (base64 padding) — that's part of the key, keep it.*

**Step 1 — get account IDs** (required before publishing):
```
GET /v2/users/me/accounts
```

**Step 2 — publish:**
```json
POST /v2/posts
{
  "post": {
    "accountId": "…",
    "content": { "text": "…", "mediaUrls": ["https://…"], "platform": "instagram" },
    "target": { "targetType": "instagram" }
  },
  "scheduledTime": "2026-08-15T14:00:00Z"
}
```

`scheduledTime` and `useNextFreeSlot` go at the **root level, beside `post`** — not nested inside it. If neither is provided the post publishes immediately.

**Async:** creates return `201` with an ID, then poll until `status` is `published` or `failed`. **Rate limit: 30 post-creations per minute.**

**Per-platform required fields** — where integrations break:

| Platform | Required |
|---|---|
| Instagram | — (optional: `mediaType`, `altText`, `firstComment`) |
| **Facebook** | **`pageId`** |
| **TikTok** | **`privacyLevel`, `disabledComments`, `disabledDuet`, `disabledStitch`, `isBrandedContent`, `isYourBrand`, `isAiGenerated`** — all mandatory |

**TikTok's flags are policy-relevant, not boilerplate.** For a sponsored or brand post, `isBrandedContent` and `isYourBrand` must be set truthfully. And `isAiGenerated` must be `true` for any AI-generated visual — which, per `../04-visuals/shot-list.md`, we are not producing anyway.

---

## n8n workflow

**Node 1 — RSS Feed Trigger.** URL `https://foodyzz.com/rss-latest.xml`, Poll Times → **Every X = 15 minutes**.

**Node 2 — dedupe.** A Code node holding seen `guid`s. n8n's trigger doesn't use `guid`, only dates — this is the safety net against the date edge cases above.

**Node 3 — AI rewrite.** One call producing all three captions at once. System prompt:

```
You write social captions for Foodyzz, an e-bike rental company for
NYC delivery riders.

HARD RULES — violating any of these is a failure:
- Never invent a price, spec, statistic or date. Use only what is in
  the article text provided.
- Never state a range without its qualifier. It is "up to 50 miles in
  eco mode with pedal assist", never "50 mile range".
- Never say "$19.99/week" without noting the 4-week minimum and the
  $20.97 fee bundle. The real 4-week charge is $100.93.
- Never claim theft coverage, battery swaps, roadside assistance,
  insurance coverage terms, or a helmet policy. Foodyzz has none.
- Never claim five boroughs. Coverage is Manhattan.
- Never describe pending legislation as law.
- Never claim ratings, review counts, customer numbers, or "#1".
- If the article does not support a claim, omit it.

VOICE: plain, numeric, respectful. Short sentences. Lead with the
number. Name the catch before the reader finds it. No hype, no emoji
walls, no fake urgency.

OUTPUT JSON:
{ "instagram": "...", "facebook": "...", "tiktok": "...",
  "hashtags": ["..."], "claims_used": ["..."] }

`claims_used` must list every factual claim you made, so a human can
verify each one.
```

The `claims_used` field is the important part — it turns approval from "read this and hope" into "check these four facts."

**Node 4 — approval.** Either Blotato `isDraft`, or a Slack/email notification with an approve button, or a Google Sheet a person clears each morning. Any of the three works; pick the one that'll actually get done daily.

**Node 5–7 — three Blotato Publish nodes**, one per platform, with the platform-specific fields above.

**Install:** the Blotato n8n node is a **verified community node** built by Blotato. n8n Cloud: Settings → enable Verified Community Nodes → search "Blotato". Self-hosted: `N8N_ENABLE_COMMUNITY_NODES=true`, restart, then install.

---

## Known gotchas

- Binary upload limit is **15MB** — use presigned uploads or a cloud URL for anything larger.
- Source flow is Create Source → **wait 5–10 seconds** → Get Source. Not instant.
- If the workflow keeps generating identical content every run, unpin data from the AI and Create Visual nodes.
- **Zapier has no Blotato app.** Make.com has 9 Blotato modules but **all actions, zero triggers** — you'd pair Make's own RSS watcher with Blotato actions. n8n is the cleaner path.

---

## Validation before going live

1. Run the feed through https://validator.w3.org/feed/ (the `check.cgi?url=` pattern is scriptable into CI).
2. Point the n8n trigger at the feed and hit **Fetch Test Event**. Confirm the output JSON has a parsed `isoDate`, non-empty `content`, and an **absolute** image URL.
3. Publish one post to each platform manually through Blotato before automating anything.
4. Run the full pipeline in draft mode for a week and read every generated caption before enabling scheduling.

**A feed can be perfectly valid RSS 2.0 and still break this pipeline.** Validity and Blotato-readiness are different tests.

---

## What this pipeline is *not* for

The blog→social automation covers maybe **20% of the content calendar**. It cannot produce:

- TikTok video — every script in `../03-social/tiktok-scripts.md` needs a person with a camera
- The "Real question, real number" series — by definition responsive
- Stories, polls, comment replies
- Anything from the caption library that isn't derived from a blog post
- Field content

**Automation is a distribution multiplier for the blog, not a content strategy.** Build it because it makes each blog post work three times over — not because it replaces the work.
