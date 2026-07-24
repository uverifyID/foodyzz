# UniHamper — Social Media & Content Engine

This folder is the **complete marketing system** for UniHamper's launch (go-live **Aug 1, 2026**;
first posts start ~**Jul 15, 2026**). It is designed to run with **little to no daily input** from Raj:
the strategy and templates live here, and four AI subagents generate fresh content on demand.

> **Start here:** read [`00-strategy/brand-source-of-truth.md`](00-strategy/brand-source-of-truth.md)
> — every post must obey it. Nothing gets invented; unverifiable facts get flagged, not published.

## Folder map
```
socialmedia/
├── README.md                       ← you are here (index + how to run it)
├── laundry SM.pdf                  ← the original brief
├── 00-strategy/
│   ├── brand-source-of-truth.md    ← MASTER facts. All content obeys this.
│   ├── competitor-research.md      ← who we're up against + gaps to exploit
│   ├── keyword-map.md              ← SEO keywords by audience + intent
│   └── content-pillars-calendar.md ← what to post, when, on which platform
├── 01-blog/
│   ├── blog-backlog.md             ← prioritized SEO blog titles
│   └── drafts/                     ← ready-to-publish long-form blog drafts
├── 02-social/
│   ├── launch-calendar.md          ← first 14 days, post-by-post
│   ├── caption-library.md          ← reusable caption templates per platform
│   └── posts/                      ← individual ready-to-schedule posts
├── 03-visuals/
│   ├── brand-graphic-guidelines.md ← look/feel, safe zones, templates
│   └── video-scripts.md            ← TikTok / Reels scripts + shot lists
└── 04-automation/
    ├── pipeline-architecture.md    ← how it all runs hands-off
    ├── origami-chat.md             ← target-market automation setup
    ├── arvow-blog-rss.md           ← blog generation + RSS
    └── blotato-publishing.md       ← auto-scheduling to IG/FB/TikTok
```

## The four subagents (re-runnable anytime)
Defined in `.claude/agents/`. Invoke by asking Claude, e.g. *"use the content-creator to write
this week's captions"* or *"have the marketing-strategist refresh the keyword map."*

| Agent | Owns | Typical ask |
|---|---|---|
| **marketing-strategist** | SEO, keywords, calendar, competitor watch | "Plan next month's content pillars" |
| **content-creator** | Blogs, captions, hooks, ad copy | "Write 5 IG captions for ambassadors" |
| **graphic-designer** | Graphic concepts, visual specs, video scripts | "Give me 3 Reel scripts on campus laundry" |
| **sales-lead** | Ambassador + laundromat acquisition, outreach | "Draft a DM funnel to recruit RAs" |

## How the weekly cadence works (once live)
1. **marketing-strategist** picks the week's themes from the calendar.
2. **content-creator** writes the blog + captions; **graphic-designer** specs the visuals/videos.
3. **sales-lead** adds the ambassador/laundromat recruitment posts.
4. Everything is checked against the source-of-truth, then pushed to **Blotato** to auto-schedule.
5. Raj only reviews/approves — no writing required.

## Status
See [`PROGRESS.md`](PROGRESS.md) for what's built and what's blocked on Raj's inputs.
