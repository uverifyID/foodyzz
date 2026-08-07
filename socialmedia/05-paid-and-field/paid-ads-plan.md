# Paid Advertising Plan

> **Reconciled against the live product on Aug 7, 2026.** Pricing, the Protection Plan, the single bike model and the 15 mph limit all changed that day — see `OPEN-QUESTIONS.md` Q3, Q4b, Q6 and Q16.


> **Do not switch this on for launch day.** Target start is **~Sept 8** — three weeks after soft launch. Running ads on Aug 15 with no pixel history, no creative library, no reviews and no iOS app would spend money to learn nothing.
>
> What the three-week delay buys: pixel data to optimise against, a retargeting audience, creative that has already been tested organically, and — critically — knowing which objections actually come up, from the field log.

---

## Budget

**Month 1 (Sept): $1,500–2,500.** This is a learning budget, not a growth budget. Anyone promising scale on this number is selling something.

| Platform | Share | Why |
|---|---|---|
| Meta (FB + IG) | 60% | Best targeting for this audience, and it's where they organise |
| TikTok | 30% | Cheapest reach, and the category is empty there |
| Google Search | 10% | Tiny volume, but the highest intent that exists |

**Do not run:** Google Display, YouTube pre-roll, Twitter/X, LinkedIn, Snapchat, or Reddit ads. Wrong audience or wasteful format at this budget.

---

## Meta

### Campaign structure

| Campaign | Objective | Budget/day | Audience |
|---|---|---|---|
| **1. Cold — Rules & risk** | Traffic → blog | $15 | Interest + geo, see below |
| **2. Cold — Own it in 12 months** | App installs | $20 | Same |
| **3. Retargeting — site visitors** | App installs | $10 | 30-day site visitors, excl. installers |
| **4. Retargeting — video viewers** | App installs | $5 | 75%+ video viewers, 60-day |

**Campaign 1 is the unusual one and it's the most important.** Sending cold traffic to a blog post about moped classification rather than to a product page looks inefficient. It isn't: it builds the retargeting pool cheaply, it's the content that actually earns attention from this audience, and it lets campaigns 3 and 4 do the selling to people who already trust us.

### Targeting

**Geo:** New York, NY. **Start with a radius around the actual service area** — Manhattan below 125th St plus the UWS — not the whole metro. There is no point advertising to a rider in Staten Island we can't deliver to.

**Age:** 18–45. **Language:** English, Spanish, French — run these as **separate ad sets with separate creative**, not one ad set with translated captions.

**Interest and behaviour signals to test:**
- DoorDash, Uber Eats, Grubhub, Instacart (as interests)
- Electric bicycle, cycling, bicycle commuting
- Delivery driver, courier, gig economy
- Broad + placement-optimised, letting Meta find the pattern

**Test broad against interest-targeted.** With a niche this specific and a budget this small, broad targeting with strong creative often beats layered interests, because the layers shrink the pool below what the algorithm needs.

### Creative

Run the organic winners. **Do not make ad-specific creative before you know what works.** By Sept 8 the organic data will show which of C08, C09, C16 and T02 actually held attention — those become the ads.

| Ad | Source | Hook |
|---|---|---|
| A1 | C09 | "$22.49 a week is our rate. It's not what you'll be charged." |
| A2 | C01 | "$999.00. Then the bike is yours." |
| A3 | C16 | "27,000 vehicles seized. Most riders thought they had an e-bike." |
| A4 | T02 video | The real-number walkthrough |
| A5 | C12 | "No credit check. No SSN." |

**Four creatives per ad set minimum**, refreshed every two weeks. Creative fatigue arrives fast in a geo this small — you'll be hitting the same people repeatedly.

### Meta policy watch-outs

Meta is strict about ads that imply financial hardship or make personal attributions about the viewer. Some of this positioning sits near that line.

- **"No credit check" is fine.** "Bad credit? No problem" implies an attribute about the viewer and can get rejected.
- Avoid "you're struggling," "can't afford," "denied elsewhere."
- Rent-to-buy may trip financial-services review. Keep copy to the mechanics — monthly amount, term, total, ownership — and avoid framing it as credit or financing.
- Employment-adjacent targeting has restrictions. **Do not use employment or credit Special Ad Categories** unless legally required to — but be aware Meta may classify rent-to-buy as credit-adjacent. If ads get rejected on this basis, run the rental offer instead and route rent-to-buy through retargeting and organic.

---

## TikTok

### Structure

| Campaign | Objective | Budget/day |
|---|---|---|
| Cold — Spark Ads on organic winners | Traffic / installs | $15 |
| Retargeting — video viewers | Installs | $5 |

**Use Spark Ads.** Boosting an organic post that already performed keeps the comments, the shares and the social proof — and in a category where the leading brand has 259 followers, a post with real engagement is worth far more than a clean ad unit.

**Targeting:** New York City, 18–44, interests around food delivery, cycling, gig work. TikTok's targeting is blunter than Meta's; lean on creative and let the algorithm work.

**Creative:** T01, T02, T04, T07 — whichever performed organically. Native, phone-shot, no polish. **Ads that look like ads die on TikTok**, and this audience is especially allergic.

---

## Google Search

Tiny volume, highest intent. **~$5/day, exact match only.**

| Ad group | Keywords | Landing page |
|---|---|---|
| Rental | `[ebike rental nyc]`, `[e bike rental for delivery nyc]`, `[delivery bike rental new york]` | `/plans` |
| Rent to own | `[rent to own ebike nyc]`, `[ebike rent to own new york]` | `/rent-to-buy` |
| No credit | `[ebike no credit check nyc]`, `[ebike financing bad credit nyc]` | `/no-credit-check` |
| Spanish | `[renta de bicicleta electrica nueva york]` | `/es/...` |

**Negative keywords, day one:** `free`, `tour`, `tourist`, `citibike`, `repair`, `parts`, `jobs`, `hiring`, `used`, `craigslist`.

The tourism SERP overlap is real and expensive — "ebike rental nyc" attracts Central Park sightseeing traffic that will never convert. Watch the search-terms report weekly for the first month and prune hard.

---

## Landing pages

**Never send paid traffic to the home page.** Three pages are needed before spend starts:

1. **`/plans`** — the full price table, spec block, three plans, one CTA
2. **`/rent-to-buy`** — the $999.00 story, the month-by-month, the payoff button
3. **`/no-credit-check`** — what we need, what we don't, and that buying skips documents entirely

Each must load fast on a mid-range Android on cellular, work one-handed, and put the price above the fold.

---

## Measurement

**The only metric that matters is cost per paid order.** Installs and signups are diagnostics.

| Metric | Where |
|---|---|
| Cost per install | Platform |
| Install → signup | GA4 + app analytics |
| Signup → document upload | **App analytics — this is the funnel's throat** |
| Document → order | App analytics |
| **Cost per paid order** | Calculated |

**Break-even reference:** a rent-to-buy customer is $999.00 over twelve months. Even at a $150 acquisition cost that's a healthy ratio — **provided they complete the plan.** Track completion, not just acquisition, before scaling spend.

**Kill rules:**
- Ad set spends 3× target CPA with zero orders → pause
- Frequency above 4 in a 7-day window → refresh creative or widen geo
- CTR below 0.5% on TikTok → the hook is wrong, not the targeting

---

## Before any money is spent

- [ ] GA4, Meta Pixel and TikTok Pixel installed and firing (**this should already be done — it's an Aug 6 task**)
- [ ] Domain verified in Meta Business Manager and TikTok Ads Manager
- [ ] Conversion events defined: `ViewContent`, `Lead` (signup), `Purchase` (paid order)
- [ ] App store links tagged with UTMs, and install attribution wired up
- [ ] Three landing pages live and tested on cellular
- [ ] At least 3 weeks of organic data identifying the winning creative
- [ ] iOS app live — **or ad copy that doesn't promise it**
- [ ] Someone assigned to answer ad comments daily. Unanswered comments on a paid post are worse than not running it.
