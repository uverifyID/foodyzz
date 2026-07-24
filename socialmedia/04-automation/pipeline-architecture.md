# UniHamper — Hands-Off Content Pipeline (Architecture)

Goal: **regular blogs, posts, and videos published to IG, FB, and TikTok with little-to-no daily
input from Raj.** This doc is the map; the three sibling docs cover each tool in detail.

## The three engines
| Engine | Tool | Job |
|---|---|---|
| **Blog / SEO** | [Arvow](arvow-blog-rss.md) | Auto-write + publish SEO blogs to the site; emit an RSS feed |
| **Social publishing** | [Blotato](blotato-publishing.md) | Schedule & auto-post captions + graphics/video to IG/FB/TikTok |
| **Supply leads** | [origami.chat](origami-chat.md) | Auto-find laundromats near campuses for the sales-lead to recruit |

## How it flows (weekly, mostly automated)
```
                 ┌─────────────────────────────────────────────┐
                 │  SOURCE OF TRUTH + STRATEGY (this repo)      │
                 │  brand-source-of-truth · keyword-map ·       │
                 │  content-pillars-calendar                    │
                 └───────────────┬─────────────────────────────┘
                                 │
        ┌────────────────────────┼───────────────────────────┐
        ▼                        ▼                            ▼
 ┌────────────┐          ┌──────────────┐            ┌────────────────┐
 │  ARVOW     │          │ SUBAGENTS    │            │  ORIGAMI.CHAT  │
 │  auto-blog │          │ (this repo)  │            │  finds laundro-│
 │  from      │          │ content-     │            │  mats near     │
 │  keywords/ │          │ creator +    │            │  campuses      │
 │  RSS       │          │ graphic-     │            │                │
 └─────┬──────┘          │ designer     │            └───────┬────────┘
       │ publishes       └──────┬───────┘                    │ lead list
       ▼ blog + RSS             │ captions + visual briefs    ▼
 ┌────────────┐                 ▼                     ┌────────────────┐
 │ unihamper  │          ┌──────────────┐             │  sales-lead    │
 │  /blog     │────RSS──▶│  BLOTATO     │             │  outreach      │
 └────────────┘          │  schedules & │             │  (DM/email)    │
                         │  auto-posts  │             └────────────────┘
                         │  IG/FB/TikTok│
                         └──────┬───────┘
                                ▼
                    IG @unihamperhq · FB · TikTok @unihamper
```

## Two ways to run it (pick based on budget/effort)
**A. Fully-managed (fastest to hands-off):** Arvow autoblog on a schedule + Blotato native
scheduler. You batch-approve a week of content, it drips out automatically. Least engineering.

**B. Orchestrated (most control):** an **n8n** (or Make) workflow ties it together — Arvow RSS →
generate captions/graphics → Blotato API `/v2/posts`. Both Arvow and Blotato ship official n8n
nodes, and Blotato is **MCP-ready for Claude Code**, so the subagents can post directly. Recommended
once the basics work.

## The weekly loop (what actually happens)
1. **Mon** — `marketing-strategist` picks the week's pillar themes from the calendar (5 min, or automated).
2. **Mon/Tue** — `content-creator` + `graphic-designer` generate the week's captions, 1 blog, and 3 video briefs into this repo.
3. **Tue** — Raj skims + approves (the only human touch). Anything flagged `⚠️ CONFIRM` gets resolved or held.
4. **Tue** — approved posts pushed to **Blotato**, scheduled across the week. Blog published via **Arvow**.
5. **Ongoing** — `sales-lead` works the **origami.chat** laundromat list for that week's target campus.

## Realistic sequencing to Aug 1
- **Now → Jul 14:** manual publishing to warm up the accounts (use `02-social/launch-calendar.md`). Zero tools needed — just post the ready drafts. Get IG/FB/TikTok verified + linked.
- **Jul 14–21:** stand up **Blotato**, connect the 3 accounts, schedule week 2 automatically.
- **Jul 21–31:** stand up **Arvow** (needs a supported CMS — see gotcha below), publish first blogs, wire RSS→Blotato.
- **Aug 1:** launch. Everything scheduled in advance; hero Reel goes live.

## ⚠️ CONFIRM / blockers for automation
- **Hostinger CMS gotcha:** Arvow publishes into WordPress/Ghost/Webflow/Wix/Shopify/Blogger — **not** a hand-coded static HTML site. Decision needed: add **WordPress on the Hostinger domain** (e.g. `unihamper.com/blog`) or move the site to a supported CMS. Without this, Arvow can't auto-publish and there's no RSS for the social pipeline. (Manual blog posting still works in the meantime.)
- **API keys:** Arvow account + Blotato account/API key + origami.chat account. Provide these and the subagents/n8n can run end-to-end.
- **Account connections:** IG (@unihamperhq must be a Business/Creator account) + FB Page + TikTok connected inside Blotato. IG/TikTok API posting has requirements (business account, no unsupported media) — see blotato-publishing.md.
- **Budget:** Arvow from ~$39/mo; Blotato paid plan for multi-account API. Confirm spend.
