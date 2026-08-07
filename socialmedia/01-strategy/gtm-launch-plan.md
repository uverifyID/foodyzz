# Go-To-Market & Launch Plan

> Target launch: **Saturday, August 15, 2026.** Today is **Aug 6** — nine days.
> iOS release is pending, so this plan is written to launch **Android-first with an iOS-agnostic funnel**, and to switch on iOS the day it clears review without re-cutting creative.

---

## 1. The honest read on nine days

Foodyzz has no social accounts, no analytics, no photography, no logomark, no blog, no reviews, and no iOS app. Some of these are fixable in nine days. Some are not.

**What that means: split the launch into two dates.**

| | Date | What it is |
|---|---|---|
| **Soft launch** | **Aug 15** | Accounts live, site fixed, tracking on, first content posted, field recruiting begins, first paying riders acquired by hand |
| **Paid launch** | **~Sept 8** | Paid media switched on, after the pixels have three weeks of data and the creator content exists |

Spending on ads on Aug 15 with no pixel history, no creative library and no iOS app would burn money to prove nothing. The soft launch exists to build the assets paid media needs. **Say the launch date is Aug 15 and mean it — just don't confuse "live" with "advertising."**

---

## 2. Nine-day critical path

### Blockers — nothing else matters until these clear

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| **B1** | **Logomark** — a square icon that is not the wordmark | Design | Cannot create IG/FB/TikTok profiles without a profile picture. Blocks everything social. |
| **B2** | **Photo shoot** — real bike, real rider, real street | You | Zero usable marketing photography exists. Every post needs an image. |
| **B3** | **GA4 + Meta Pixel + TikTok Pixel on foodyzz.com** | Dev | No baseline, no attribution, no retargeting audience. Every day without it is lost data. |
| ~~**B4**~~ | ✅ **Certification substantiated Aug 7** | — | Both certificates verified live on Certipedia; DCWP accepts TÜV Rheinland of North America. Pillar 2 is cleared to run. Originals in transit. |
| **B5** | **Publish prices on the website** | Dev | The site says "no hidden fees" and shows no prices. Prices are already public in the App Store screenshots. |
| **B6** | **Fix the 8 site/app contradictions** in `brand-source-of-truth.md` §11 | Dev | "Extend or return any time" against a 4-week minimum is a refund dispute waiting to happen. |

### Day-by-day

**Aug 6–7 — Foundations**
- Register the three handles (see §3). Even if profiles stay empty, secure the names today.
- Install GA4, Meta Pixel, TikTok Pixel. Verify the domain in Meta Business Manager and TikTok Ads Manager.
- Set up Google Search Console, submit the existing sitemap.
- Brief the logomark. Simplest viable: the "f" from the wordmark in `#86B54F` on `#0A0A0A`, or black on green — it only has to work at 32px.
- Pull the real bike photography out of Firebase Storage into a shared folder.

**Aug 8–9 — Shoot and build**
- **Photo shoot.** Shot list in `../04-visuals/shot-list.md`. Half a day, one bike, one rider, Manhattan. This is the highest-leverage four hours in the whole plan.
- Publish the price table and the spec block on foodyzz.com.
- Fix the contradictions.
- Build the blog at `foodyzz.com/blog` (recommendation and steps in `../02-seo/blog-hosting-plan.md`).

**Aug 10–12 — Content bank**
- Set up profiles: bio, link, profile picture, cover, category, contact button.
- Produce the **first 21 posts** from `../03-social/caption-library.md` (7 per platform) and the **first 8 TikToks** from `../03-social/tiktok-scripts.md`. Bank them; do not post yet.
- Publish blog posts 1 and 2 (drafts are in `../02-seo/drafts/`).
- Stand up the RSS feed and test it end to end into Blotato.

**Aug 13–14 — Dress rehearsal**
- Post 2–3 pieces to each account so the profiles are not empty on day one. An account with zero posts converts nothing.
- Test the full purchase flow yourself end to end on a real card. Screenshot every step for the content bank.
- Print field materials (see §6).

**Aug 15 — Launch**
- Launch post on all three platforms, same day, different formats.
- Blog post 3 goes live.
- Field day one: Deliverista Hub, 249 Broadway.

**Aug 16–Sept 7 — Compound**
- Post daily. Field work three days a week. Blog twice a week.
- Recruit and brief creators (`../05-paid-and-field/creator-partnerships.md`).
- Build the retargeting audience.

**~Sept 8 — Paid on** (`../05-paid-and-field/paid-ads-plan.md`)

---

## 3. Accounts to create

| Platform | Handle (first choice) | Fallbacks | Type |
|---|---|---|---|
| Instagram | `@foodyzz` | `@foodyzznyc`, `@ridefoodyzz` | Professional → Business |
| TikTok | `@foodyzz` | `@foodyzznyc`, `@ridefoodyzz` | Business |
| Facebook | `facebook.com/foodyzz` | `/foodyzznyc` | Page, category **Bicycle Rental Service** |

Also secure, even if unused: YouTube (`@foodyzz` — for Shorts repurposing), and a WhatsApp Business number. **WhatsApp matters more than it looks:** the NYSERDA researchers had to distribute their survey through Los Deliveristas Unidos' WhatsApp group to reach this workforce at all, and Chinese-language reporting says riders find rental shops through WhatsApp groups and word of mouth. A click-to-WhatsApp button may outperform every other CTA.

**Bio template (Instagram / TikTok):**
```
E-bikes for NYC delivery riders 🇺🇸
Rent from $99.95/4 weeks · Own in 12 months
UL 2849 certified · Delivered to your door
Manhattan → Brooklyn soon
↓ Get the app
```
Character counts vary; trim from the bottom.

**Facebook Page must have:** category, service area (Manhattan), contact button, and — the moment they exist — hours and a phone number.

---

## 4. Funnel and targets

```
Awareness      Organic social + field + blog SEO
    ↓
Consideration  foodyzz.com/plans (price table, spec block, comparison)
    ↓
Install        App Store / Play Store
    ↓
Signup         Phone + code
    ↓
Documents      Licence + proof of address   ← the real drop-off point
    ↓
Order          Card authorised
    ↓
Delivery       Charged. Revenue.
```

**The document step is the funnel's throat.** A rider must photograph a driver licence and a utility bill before a bike ships. For an immigrant workforce this is the single highest-anxiety moment in the flow. Content must pre-answer it: what exactly is needed, what it is used for, that it is not a credit check, that buying outright skips it entirely.

### Targets to Sept 30

Set deliberately low — this is a cold start with no ad spend for the first three weeks.

| Metric | Aug 31 | Sept 30 |
|---|---|---|
| IG followers | 150 | 600 |
| TikTok followers | 200 | 1,200 |
| FB page likes | 100 | 350 |
| Website sessions | 400 | 2,000 |
| App installs | 60 | 300 |
| Signups | 30 | 150 |
| **Paid orders** | **8** | **40** |

**The only number that matters is paid orders.** At Model 1 rent-to-buy, 40 orders is $4,438/month recurring. Everything else is a leading indicator.

---

## 5. Where the first customers actually come from

Ranked by realistic yield in the first 30 days. Full detail in `../05-paid-and-field/field-sales-playbook.md`.

1. **Physical field work — Deliverista Hub, 249 Broadway.** Opened April 2026, 40 charging cabinets, open 24/7, riders sitting still with time to talk. Highest-conversion channel available and it costs nothing but hours. **Go there first, go there often.**
2. **Facebook Groups.** This workforce organises on Facebook and WhatsApp, not Google. Join as a person, be useful, do not spam.
3. **Restaurant clusters at shift change** — riders queue and wait. Hand-to-hand.
4. **Creator partnerships.** Rider-creators already make Foodyzz-adjacent content organically with zero brands amplifying them.
5. **Organic TikTok.** No incumbent — the whole category is under 500 followers there.
6. **Blog SEO.** Slowest to compound but the only channel with zero marginal cost. Start now, harvest in Q4.
7. **Paid social.** From ~Sept 8.
8. **HungryPanda partnership.** Zoomo proved the playbook for reaching Chinese-speaking riders. A BD conversation, not a content investment.

---

## 6. Field kit

- **Flyer, double-sided.** Front: the price table and "Own it in 12 months — $999.00." Back: a QR to `foodyzz.com/r/hub` (a tracked landing page). **Print in English, Spanish and French** — French is 46.5% of this workforce.
- **A demo bike.** Nothing converts like letting someone sit on it.
- **A phone with the app open** to walk through the itemised checkout screen.
- **A QR code per location** so you can attribute which spots work.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| iOS not approved by Aug 15 | High | Medium | Android-first creative; site CTA detects platform; iOS added without re-cutting |
| No logomark by Aug 12 | Medium | **Blocking** | Ship a text-only lockup as a placeholder rather than delay accounts |
| A certificate lapses or a substituted battery pack is not the certified LN-IR-5-U | Low | **High** | Re-check both Certipedia pages before each campaign, and confirm the pack model at every intake. A substituted battery is not a certified battery. |
| Whizz publishes a "Foodyzz vs" post | High | Low | Good for us. Have our own comparison page live first so we rank alongside it. |
| Fleet sells out | Medium | Medium | 32 seeded bikes. The app has a waitlist state — use it as social proof, not an apology. |
| "What does the Protection Plan cover?" in comments | Medium | Medium | Answer it — foodyzz.com/protection is public. Say waiver, never insurance; bike, never rider; not on Rent to Buy. |
| English-only support meets a French-speaking market | **High** | **High** | See Q8. At minimum, a bilingual contractor for chat during launch month. |

---

## 8. The 30-day cadence, once live

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| **TikTok** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **Instagram** | Reel | Carousel | Story | Reel | Carousel | Story | — |
| **Facebook** | ✅ | — | ✅ | — | ✅ | — | — |
| **Blog** | — | ✅ | — | — | ✅ | — | — |
| **Field** | — | ✅ | — | ✅ | — | ✅ | — |

Six TikToks a week sounds like a lot. It is the correct number for a category where the leader has 259 followers — the ceiling is set by volume and consistency, not polish.
