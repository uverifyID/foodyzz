# UniHamper — Brand Source of Truth

> **This is the single source of truth for every blog, caption, script, and graphic.**
> If a fact is not in this file (or on the live site), it may **not** be published. When in
> doubt, flag it — do not invent. Last verified against https://unihamper.com on 2026-07-09.

---

## 1. What UniHamper is (one line)
UniHamper is **"Uber, but for laundry"** — a platform that connects college students and busy
people with **local laundromats and laundry pros** who wash, fold, dry-clean, pick up, and
deliver. UniHamper is **the marketplace, not the laundromat.**

Public brand name: **UniHamper** · Website: **https://unihamper.com** · Launch: **Aug 1, 2026**

## 2. Verified value propositions (safe to publish)
- **"Never do laundry again."** Wash, fold, and delivery — often done before you'd have
  finished a single load yourself.
- **$0 until your wash starts.** It's a hold authorization, not a charge.
- **$9.99 flat pickup & delivery**, paid directly to the driver.
- **Live tracking** with real-time notifications; **chat or call** your provider directly.
- **Campus-ready:** add your dorm details so pickup happens right on campus.
- **Real, insured pros** — established laundromats who fold for a living.
- **Price protection:** any price increase needs *your* OK; a lower price needs nothing.
- Optional **priority fees** for same-day / next-day service.

## 3. The three audiences (all content targets these)
1. **Students / customers** — dorm residents, freshmen, busy people near campus who need laundry done.
2. **School ambassadors** — popular students, RAs, RDs, spokespeople who recruit students *and*
   laundromats and earn **commission**. This is the growth engine.
3. **Laundromats / providers** — shops near campuses that wash, fold, and can drive pickup/delivery.

## 4. The differentiators to hammer (vs competitors)
- **$0.00 platform commission to laundromats** — providers keep their full rate. Competitors take a cut.
- **Providers set their own prices** — UniHamper does NOT set prices (unlike Uber's fixed pricing).
- **Campus-native** — built around dorms, RAs, and the student schedule, not generic households.
- **Ambassador commissions** — a way for students to earn, not just spend.
- **Fast payouts** — Stripe twice-monthly, or **daily for a $0.99 admin fee**.

## 5. Confirmed pricing facts (do not embellish)
| Fact | Value |
|---|---|
| Pickup & delivery | **$9.99 flat**, paid to driver |
| Up-front charge | **$0** until wash starts (hold auth only) |
| Platform cut from provider's rate | **$0.00** (provider keeps 100% of the price they set) |
| Wash/fold per-lb or per-order price | **Set by each provider** (varies — never quote a specific $/lb) |
| Priority / same-day | Optional **priority fee** (varies) |
| Provider payout | Stripe, twice monthly, or daily for $0.99 admin fee |

### 5a. Commission mechanics (VERIFIED in code — word carefully)
Source: `src/utils/managerCommission.ts` + `functions/src/index.ts`. Admin-configurable, so state
these as "typical/default," not fixed forever.
- **Platform commission ≈ 20% default** (`commissionRate = 0.20`). It's added **on top of** the
  provider's price — the customer pays `providerPrice × (1 + 0.20)`; the provider still receives
  100% of their own rate. That's how "$0 commission to laundromats" and "there is a platform
  commission" are both true.
- **Ambassador (school-manager) commission = 30% default** (`DEFAULT_MANAGER_RATE = 0.30`) — but it is
  **30% of UniHamper's platform commission**, NOT 30% of the order. On completed/delivered orders
  attributed to their campus.
- **Net effective ambassador earnings ≈ 30% × 20% ≈ ~6% of the service subtotal per order**, plus a
  possible **recruit-bonus window** (an ambassador who was themselves recruited earns base+bonus for a
  configurable period).
- ✅ **Safe phrasing:** "Earn **30% of UniHamper's commission** on every order from your campus."
- ❌ **Never say:** "Earn 30% of every order" / "30% commission" (implies 30% of order value — false).
- ⚠️ CONFIRM with Raj before publishing any hard dollar example (platform rate is admin-set; confirm
  the live value and whether a specific per-order example is OK to show).

## 6. Calls-to-action (use the real ones)
- Customers: **"Request a pickup"** · **"Get the app"**
- Laundromats: **"List your laundromat"** · **"Partner with us"**
- Ambassadors: **"Become a campus ambassador"** (confirm exact CTA/landing URL with Raj)

## 7. Social handles (verified)
- **Facebook:** https://www.facebook.com/profile.php?id=61591701426017
- **Instagram:** @unihamperhq
- **TikTok:** @unihamper

## 7a. Brand kit (VERIFIED from the codebase — use these, not placeholders)
Source: `mktweb/tailwind.config.ts` + `mktweb/src/app/layout.tsx`. Full detail in
[`../03-visuals/brand-kit.md`](../03-visuals/brand-kit.md).
- **Style:** neo-brutalist — hard `#0A0A0A` borders, chunky offset shadows (`6px 6px 0 #0A0A0A`), flat bold color blocks.
- **Colors:** brand orange **`#FF4D00`** · logo-orange **`#F07830`** · ink **`#0A0A0A`** · paper **`#FFFFFF`** · yellow `#F7F75C` · blue `#AEBEF2` · pink `#F2A7A0` · light-orange `#FFB866` · silver `#B4BCC8`.
- **Fonts:** **Inter** (body/UI) + **Space Grotesk** (display/headlines).
- **Logo files:** `mktweb/public/unihamper-logo.png` (wordmark), `mktweb/public/unihamper-icon.png` (icon), `htmlweb/icon-512.png`, `htmlweb/apple-touch-icon.png`.

## 8. Hard rules (the QC guardrails from the brief)
- **Do not invent facts.** No made-up campuses, prices, testimonials, stats, or partnerships.
- Never quote a specific wash price ($/lb) — providers set their own. Say "prices set by your local pro."
- No specific launch-city claims until Raj confirms the launch campus list.
- Any stat (e.g. "saves 40 hrs/semester") must be attributed to a cited external source, not to UniHamper.
- If an image or fact can't be verified, **pause and flag** — do not publish a placeholder.
- Keep the tone: friendly, student-native, a little cheeky, never corporate or spammy.

## 9. Open items — status (2026-07-09 update)
Resolved:
- [x] **Brand kit** — found in codebase (see §7a). ✅
- [x] **Ambassador commission** — 30% of platform commission (see §5a). ✅ (confirm hard-dollar examples before publishing)
- [x] **Campus list source** — Raj will use **origami.chat** to generate the campus list + laundromat leads. ✅ (list itself still pending its first run)
- [x] **Blog/RSS/SEO tool** — decided: **static blog inside `htmlweb/` + hand-built RSS**, no Arvow needed (see [`../04-automation/seo-blog-plan.md`](../04-automation/seo-blog-plan.md)). ✅

Still needed:
- [ ] **Launch campus list** — run origami.chat to produce it (unblocks local SEO + geo posts).
- [ ] **Ambassador signup URL / landing page** — exact path on unihamper.com.
- [ ] **Real photo library** we're licensed to use (for real imagery in posts).
- [ ] **origami.chat plan/seat** confirmed + first prospecting run.
- [ ] **Blotato API key** + IG converted to Business/Creator, TikTok public-post test.
- [ ] Confirm whether a **specific per-order ambassador $ example** is OK to publish.
