# Build Progress & Blockers

_Last updated: 2026-07-09_

## Done
- [x] Phase 0 — Brand source-of-truth, folder scaffold, README
- [x] Phase 0 — Four subagents created in `.claude/agents/`
- [x] Phase 1 — Strategy: competitor research, keyword map, content pillars + calendar
- [x] Phase 1b — Sales: laundromat + ambassador acquisition playbooks + supply-side posts (`05-sales/`)
- [x] Phase 2 — Launch content: 22-title blog backlog, 2 full blog drafts, caption library, 14-day launch calendar
- [x] Phase 3 — Visuals: brand graphic guidelines + 6 templates, 10 TikTok/Reel scripts
- [x] Phase 4 — Automation wiring: pipeline architecture + Arvow + Blotato + origami.chat setup docs

## Everything is drafted. What's left is Raj's inputs (below) + standing up the tools.

## RESOLVED 2026-07-09 (from Raj's answers + codebase)
- ✅ **Brand kit** — found in `mktweb/` (orange `#FF4D00` neo-brutalist, Inter + Space Grotesk, real logos). See [`03-visuals/brand-kit.md`](03-visuals/brand-kit.md).
- ✅ **Ambassador commission** — 30% of UniHamper's platform commission (~20%), i.e. ~6% of service subtotal/order. Verified in `src/utils/managerCommission.ts`. Phrasing rules in source-of-truth §5a.
- ✅ **SEO/blog tool** — decided **static blog in `htmlweb/` + hand-built RSS, no Arvow**. See [`04-automation/seo-blog-plan.md`](04-automation/seo-blog-plan.md).
- ✅ **Campus list source** — Raj uses **origami.chat** to generate the list + laundromat leads.

## Still needed from Raj (to finish / go live)
| # | Need | Blocks | Priority |
|---|---|---|---|
| 1 | **Run origami.chat → launch campus list + laundromat leads** | Local SEO, geo posts, laundromat outreach | 🔴 High |
| 2 | **Ambassador signup URL / landing path** | CTAs on all ambassador content | 🔴 High |
| 3 | **OK to publish a specific per-order ambassador $ example?** | Concrete earnings copy | 🟡 Med |
| 4 | **Licensed photo library** | Real imagery in posts | 🟡 Med |
| 5 | **Blotato API key + IG Business/Creator + TikTok public-post test** | Hands-off auto-posting | 🟡 Med |
| 6 | **Google Search Console verification token** | Blog indexing (replaces Arvow auto-index) | 🔴 High |
| 7 | **App-store / "Get the app" links** | Aug 1 hero video + CTAs | 🟡 Med |
| 8 | **RA/RD school-policy check** | Ambassador push to RAs/RDs | 🟡 Med |
| 9 | **Laundromat onboarding reqs** (insurance/license/min hrs) | Honest laundromat pitch copy | 🟡 Med |
| 10 | **Reconcile site theme-color** (blue `#3B4FE0` → orange `#FF4D00`) | Brand consistency (not a launch blocker) | 🟢 Low |

> **Fastest unblock order:** #1 origami run (campus list) → #6 Search Console → #2 ambassador URL.
> Brand kit + commission + SEO tool are now settled, so ~90% of content can be finalized.

## Timeline
- **~Jul 15** — first posts go live (organic warm-up)
- **Aug 1** — official launch
