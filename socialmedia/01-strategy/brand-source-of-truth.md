# Foodyzz — Brand Source of Truth

> **Read this before writing a single line of copy.** Everything here is verified against the app source, the Cloud Functions, the seeded config, or the live website — with file references so it can be re-checked. If a fact is not in this document, do not publish it.
>
> Last verified: **Aug 7, 2026**, against branch `sdk-54-android-36` and the live `apiConfig/logistics` document.
>
> ⚠️ **Everything about pricing, fees and the Protection Plan changed on Aug 7.** The insurance line item is gone, the rent rate absorbed it, rent to buy lost it entirely, Model 2 was a test fixture and no longer exists, and the deposit is charged rather than held. If you are working from anything written before Aug 7, re-read sections 2–4.
> Owner: whoever is publishing. Re-verify prices before every campaign — they live in an admin-editable Firestore doc and can change without a code deploy.

---

## 1. What Foodyzz is

Foodyzz rents, rent-to-buys, and sells delivery-grade e-bikes to riders in New York City, and delivers the bike to the rider's door. Foodyzz owns the fleet and is the merchant of record — there is no marketplace, no third-party seller, no commission.

- **Website:** https://foodyzz.com (static HTML on Hostinger)
- **iOS:** https://apps.apple.com/us/app/foodyzz/id6794564474 — *release pending as of Aug 6*
- **Android:** https://play.google.com/store/apps/details?id=com.foodyzz
- **Operator app:** FoodyzzHQ (staff only, not marketed)
- **Target launch:** August 15, 2026

---

## 2. The three offerings — exact names and mechanics

The app calls them **Rent**, **Rent to Buy**, and **Buy**. ✅ **Resolved Aug 7** — the website said "Rent-to-Own" and now says Rent to Buy everywhere. Use **Rent to Buy**. Never write "rent-to-own."

| | Rent | Rent to Buy | Buy |
|---|---|---|---|
| App blurb (verbatim) | "Weekly rental. New or used bike." | "Monthly payments, the bike is yours at the end. Always a new bike." | "One-time purchase. Always a new bike." |
| Billed | Weekly rate, whole term up front at delivery | Monthly installments | Once |
| Term | Customer picks, **4-week minimum** | **Fixed at 12 months** | — |
| Bike condition | **New or used** | Always new | Always new |
| Deposit | $100, **charged** at delivery | $100, **charged** at delivery | **None** |
| Required fee | Maintenance $5.99 per period | Maintenance $5.99 per month | **None** |
| Protection Plan | **Included in the rate** | **Does not apply** | — |
| ID documents required | Yes | Yes | **No** |
| Ownership | No | **Yes, at final payment** | Yes, day one |

**Rent to Buy detail:**
- Month 1 is captured at delivery. Remaining installments auto-charge monthly from the saved card.
- **Early payoff any time, no penalty** — charges the remaining periods at once and transfers ownership.
- Progress is visible in the app: "N of M paid", months left, next payment date and amount.
- Failed payment: retry after 24 hours; after a second failure the plan goes `past_due`, auto-retries stop, and the team reaches out.
- **There is no coded cancellation or refund path for rent-to-buy** — it is handled manually, per policy. Never advertise rent-to-buy cancellation terms.

---

## 3. Prices — the numbers, and the numbers behind the numbers

**Source of truth is the Firestore doc `apiConfig/logistics`, editable by admins.** Verified against the live document on **Aug 7, 2026**. **Re-check before any campaign.**

### Base rates — one model

| Model | Rent | Rent to Buy | Buy | Minimum commitment |
|---|---|---|---|---|
| **Foodyzz Model 1** | **$22.49/week** | **$69.99/month** | **$899** | 4 weeks · 12 months |

**Model 2 does not exist.** It was a test fixture and was removed from the live config on Aug 7. Anything referencing a $999 model, a $109.99 rent-to-buy, or "two models" is wrong. This also answers the old Q6 — there was never a second bike to justify a price difference for.

### Fees

| Fee | Amount | Cadence | Optional? |
|---|---|---|---|
| Deposit | **$100.00** | Once, **charged** at delivery, refunded on return | No |
| Maintenance | **$5.99** | per rental period | No |
| GPS tracker | $4.99 | per rental period | **Yes — off by default** |

**Three things changed on Aug 7 and every one of them is a copy change:**

1. **The $9.99 "Insurance" line is gone.** It is not renamed, not reduced — removed. What it paid for is now a damage and theft waiver built into the rent rate. See §3b.
2. **GPS is opt-in.** It used to be pre-selected and the rider had to find it to decline. It is now off until tapped. "We don't tick boxes for you" is a true and unusually specific trust line.
3. **The deposit is charged, not held.** The old copy said held. It is taken as a separate transaction at delivery and refunded on return, minus documented damage. Never write "we only hold it."

**The mechanic that still matters:** fees are charged **once per rental period, not per week** (`foodyzz/src/services/logistics.ts` — *"Fees are billed once per rental period"*). But it is now a much smaller effect than the old plan assumed, because only $5.99 sits in that bundle instead of $5.99. See the effective-weekly column below before printing anything about it.

### 3b. The Protection Plan — read this before writing a word about it

A damage and theft waiver on **the bike**, included in every rental at no separate charge.

- Waives **50% of eligible repair and damage costs**
- Caps liability for a stolen or lost bike at **$500**, conditional on a working battery returned, a police report within 24 hours, and the bike having been locked
- **Never applies to Rent to Buy** — an owner-in-waiting carries their own risk there
- **Never covers the rider** — no injuries, no medical bills, no lost earnings, no third-party liability

**Hard rules for copy:**
- **Never call it insurance, or coverage.** It waives, it does not cover. It is not an insurance policy and Foodyzz is not an insurer.
- **Never claim it protects the rider.** It protects the bike.
- **Never imply it applies to Rent to Buy.**
- Always pair it with the helmet requirement.

Full terms: https://foodyzz.com/protection

### What a customer actually pays

Excludes sales tax and the card-processing fee, both added at checkout. The deposit is a **separate second transaction at delivery**.

**Rent — Model 1** (maintenance included; GPS adds $4.99 once per period if selected)

| Term | Base | Maintenance | **Charged at delivery** | Effective $/week |
|---|---|---|---|---|
| 4 weeks (minimum) | $89.96 | $5.99 | **$95.95** | $23.99 |
| 8 weeks | $179.92 | $5.99 | **$185.91** | $23.24 |
| 12 weeks | $269.88 | $5.99 | **$275.87** | $22.99 |

⚠️ **The "your weekly price drops the longer you ride" angle is now weak.** It moves $1.00 across a 4-to-12-week stretch, where the old bundle moved $3.49. It is still true and still worth a line, but it cannot carry a graphic on its own.

**Rent to Buy — Model 1**

| Monthly (base + maintenance) | Months | **Total to own** | vs. the $899 cash price |
|---|---|---|---|
| $69.99 + $5.99 = **$75.98** | 12 | **$911.76** | **+$12.76** |

🔴 **You cannot call this 0% interest today.** New York bars advertising a rent-to-own deal as interest-free or no-cost when total payments exceed the cash price. At $911.76 against $899, they do. The app already shows the honest difference instead of a 0% badge.

**One dollar and six cents fixes it.** Drop the rent-to-buy rate to **$68.93** and the total lands at $898.92 — under the cash price, and the claim becomes true and printable. That is $12.72 per bike over a whole plan for a headline competitors cannot honestly make. This is the single highest-leverage pricing decision on the table for marketing.

**Rent to Buy repairs:** normal wear and tear is included, with a **$9.99 service fee per repair request**. Damage beyond ordinary wear is billed in full — there is no 50% split on Rent to Buy.

**Buy** — $899. No deposit, no fees, no document check, no return leg.

### Other money facts

- **Delivery is free.** `deliveryFee` is hardcoded to 0.
- **No platform fee, no commission, no rush surcharge.**
- **Sales tax** comes from the assigned store record. **Card-processing fee** is passed through, shown with tax as one **"Taxes and fees"** line.
- **Missed collection: a $49.99 admin fee** *(live config, not the $25 in older drafts)* **plus the rental renews for another full term.** Disclosed twice before it can happen.
- **Tips** are optional, post-delivery, untaxed, commission-free.
- **The all-in total is now shown on the fees step** before the rider continues — the screen used to list the parts without ever summing them.

---

## 4. The bike — specs

✅ There is one model, so the single spec block is now correct rather than a warning. *(Old Q6 closed.)*

**Class: Class 2, limited to 15 mph** *(confirmed Aug 7, 2026)*

Class 2 under NY VTL means **throttle-capable**. The fleet is configured to **15 mph**, which is New York City's citywide e-bike limit in force since **October 24, 2025**. The app's spec block and the certification card on each bike listing both say so.

Three consequences worth knowing:

- **The throttle is a selling point nobody is using.** A rider pulling away from a light with a loaded bag on a Manhattan hill cares about this. It is mentioned in no marketing anywhere.
- **City Council Intro 244 would ban the sale and rental of Class 3 e-bikes. A Class 2 fleet is outside its scope.**
- **15 mph is a compliance story, not an apology.** Every rider in this city is about to be limited to it. Foodyzz ships limited already, and says so on the listing. Competitors renting 20–25 mph bikes into NYC have a problem they have not solved.

⚠️ Do not publish "top speed" figures. The app used to say 21 mph, then 19; both conflicted with the configured limit and both are gone. Say **"Class 2 with a throttle, motor assist to 15 mph — New York City's limit."**

**Certifications** *(supplier certification sheet, Aug 2026)*

| | |
|---|---|
| Electrical system | **UL 2849 certified** — certificate **CU 726061660001** |
| Battery | **UL 2271 certified** — certificate **CU 72303450 0003** |
| Testing laboratory | **TÜV Rheinland** |
| Verify at | **certipedia.com** |
| Mark location | Displayed on the frame |
| IP rating | **IP65** — dust and splash resistant |
| Frame loading | **300 lbs, rider + cargo combined** (136 kg) |
| Shipping docs held | MSDS, UN38.3, Identification and Classification Report for Transport of Goods |
| Compliance contact | compliance@foodyzz.com |

**Say "UL 2849 certified, tested by TÜV Rheinland."** Not "UL Listed" — that phrasing implies UL Solutions did the listing, which is a different thing and is the kind of distinction that gets picked apart.

**The 300 lb figure is rider + cargo combined.** Never publish it as "300 lb frame load" without the qualifier — a 200 lb rider reading that will assume 300 lbs of cargo capacity.

**Battery & performance**
- Battery is **removable**
- **Motor assist to 15 mph** — Class 2, configured to the NYC limit
- Range: **up to 80 km / 50 miles** with pedal assistance in eco mode
- Integrated **battery management system (BMS)**

**Not stated anywhere, so do not claim:** motor wattage, battery Wh/Ah, weight, charge time, brake type, tyre size, warranty length.

---

## 5. How the flow actually works — for copy that matches reality

1. **Sign in** with a phone number and a 6-digit code. No email, no password, no social login. Terms & Conditions must be accepted before the code is sent.
2. **Onboarding**: full name → email → street address (Google Places, geocoded and rejected if unresolvable) → 5-digit ZIP.
3. **Explore tab** is a promo/deals feed, not a bike catalogue. It shows nearby offers with copyable codes.
4. **Ride Now wizard**, 6 steps: Start date → Delivery time → Type → Your bike → Fees → Confirm. (Buy skips Fees.)
   - Start date: any of the next **14 days, starting tomorrow**. **Nothing is delivered same-day.**
   - Delivery slots: hourly, **5:00 PM – 9:00 PM** only.
   - Live availability is shown per model, including an expected-availability date when sold out, and a waitlist state.
5. **Card is authorised** at booking. Nothing is charged.
6. **ID check** (Rent and Rent to Buy only): driver licence front and back, plus proof of address — **"a utility bill, bank statement or lease."** Staff verify before the bike ships. Buy skips this entirely.
7. **Delivery** to the address on the account. At handover the customer sees **two separate transactions**: the rental and the deposit.
8. **My Rentals** tracks delivery, the return leg (Pickup → At Location → Inspection → Done), the due-back date, and rent-to-buy progress.
9. **Return**: deposit refunded minus any damage adjustments. Damage is capped at the deposit.
10. **Chat** with FoodyzzHQ, in-app, per-order or general.

**Reminders the customer gets:** a due-soon email 2 days before the rental ends, warning that if nobody is there to hand the bike over, the rental continues for another term and the card is charged plus an admin fee.

---

## 6. Coverage

**What the live website claims** (`website/index.html:432-441`):
- **Live now:** Manhattan — Upper West Side, Harlem, Chelsea, SoHo
- **Coming soon:** Brooklyn, Queens, The Bronx

**What the code supports:** a ZIP → coordinate fallback table covering 8 Manhattan ZIPs — **10011, 10012, 10023, 10024, 10025, 10026, 10027, 10029** (Chelsea, Greenwich Village, UWS, Harlem). Default fallback ZIP is 10025.

**There is no borough list, service-area list, or "NYC" string anywhere in the app code.** Say Manhattan. Do not say five boroughs.

---

## 7. Contact and support

| | |
|---|---|
| Compliance | compliance@foodyzz.com |
| Privacy | privacy@foodyzz.com |
| Legal | legal@foodyzz.com |
| Support | **In-app chat only.** No support email, no phone number exists. |
| Address | "Foodyzz HQ, New York, NY" — no street address published |
| Hours | None published. The only stated window is the 5–9 PM delivery slot. |
| Chat promise | "We usually reply in minutes" |
| Languages | **English only.** No i18n, no locale files, everything hardcoded `en-US`. |

**Two gaps that block channels.** No phone number and no street address means **no Google Business Profile** and no `LocalBusiness` schema — for a business whose entire market is one city. And English-only support against a customer base that is 46.5% French-primary and 25.1% Spanish-primary is a conversion ceiling, not a detail. See `../OPEN-QUESTIONS.md` Q7 and Q8.

---

## 8. Brand kit

**Colours** — from `website/css/style.css:10-24`, mirrored in the tailwind configs.

| Token | Hex | Use |
|---|---|---|
| `--green` | **#86B54F** | **Fill only.** Always pair with black text (8.7:1). White on this is 2.4:1 — fails. |
| `--green-mid` | #658F32 | |
| `--green-dark` | **#507425** | **Green text on white** (5.4:1) |
| `--green-ink` | #2B4011 | Deep accents |
| `--green-tint` | #EFF5E6 | Backgrounds |
| `--black` | #0A0A0A | Text, borders, shadows |
| `--paper` | #FAFAF7 | Warm off-white page background |
| `--stone` | #F0EFEA | Panels |
| `--stone-mid` | #A8A29E | Borders |
| `--stone-text` | #57534E | Secondary text |

**Style signature:** neubrutalist — hard offset shadows with **no blur** (`6px 6px 0 0 black`), 14px corner radius, heavy black keylines.

**Type**
- Display / headings: **Space Grotesk** (500, 700)
- Body: **Inter** (400, 600, 700)
- Labels / kickers / numbers: **JetBrains Mono** (400, 700)

**Logo** — `website/assets/foodyzz-wordmark.png`, 512×512, lowercase green wordmark on transparent.

⚠️ **There is no logomark.** `foodyzz-icon.png` is byte-identical to the wordmark, so the favicon, Apple touch icon, schema.org logo and OG image are all a wide wordmark squeezed into a square. This is why `twitter:card` was downgraded to `summary`. **A profile picture for Instagram, Facebook and TikTok cannot be made from this asset.** See `../OPEN-QUESTIONS.md` Q9 — this is a launch blocker.

⚠️ **Off-brand colours in shipped assets:** the app-store screenshot backdrop is `#7B8F76` (a sage green in no config), and the app's home banner is indigo/violet `~#4F3FD9` with blue price text. Neither is in the brand system. Social creative should use the green system, not the screenshots' palette.

---

## 9. Imagery — what exists and what does not

**Real product photography exists but is not on disk as a usable file.** There is a genuine photograph of the Foodyzz e-bike — black step-over frame, red rims, disc brakes, integrated down-tube battery with a **green "foodyzz" decal on the frame and battery** — but it exists only baked into `appstore/foodyzz/ios/screenshot-3.png` and served at runtime from Firebase Storage. Model image URLs in the seeded config are empty strings.

**There are zero marketing-usable photographs in the repo.** No riders, no NYC streets, no delivery scenes, no bike-in-context shots, no team photos.

**Assets that must never appear in Foodyzz marketing:**
- `assets/images/unclesam.png` — stock Uncle Sam clipart, unrelated
- `foodyzzhq/assets/images/newinstall/p1-p6.png` — **UniHamper laundromat illustrations** still shipping inside the HQ app
- Anything in `htmlweb/` or `Mktweb/` — these are a different product (UniHamper, a laundry app) living in the same repo

The PDF brief's own rule is *"Pull real images from the website or provided files. Do not invent facts. If verification is not possible, pause creation and flag the issue."* **Flagging: it cannot currently be satisfied.** A photo shoot is a launch dependency. See `../04-visuals/shot-list.md`.

---

## 10. Analytics

**Nothing is installed.** No GA4, no Meta Pixel, no TikTok Pixel, no GTM, no Search Console verification, no conversion tracking on the app-store badge clicks or the contact form. `website/js/main.js` is 22 lines: a nav toggle and a footer year.

A launch nine days out with no baseline, no attribution and no retargeting audience being built is the highest-urgency fixable gap in this whole plan. See `../06-automation/measurement-and-analytics.md` — it is written as a day-one checklist.

---

## 11. Site vs app — what was fixed, and what is left

Most of the list that lived here was fixed on **Aug 7**.

| # | Was | Now |
|---|---|---|
| 1 | Site: "Rent-to-Own" · App: "Rent to Buy" | ✅ **Rent to Buy** everywhere |
| 2 | Site: deposit "held, not charged" · App: charged | ✅ Site says **charged at delivery, refunded on return** |
| 3 | "Insurance $9.99" with no defined coverage | ✅ Removed; a documented waiver at **/protection** |
| 4 | App listed fees without ever summing them | ✅ **All-in total** on the fees step |
| 5 | GPS pre-selected | ✅ **Off by default** |
| 6 | App: "Top speed 21 mph" against a Class 2 claim | ✅ **"Motor assist to 15 mph"** |
| 7 | No certification anywhere customer-facing | ✅ Lab, both standards, **both certificate numbers** and a verify link on the bike listing |
| 8 | No helmet policy | ✅ Required by contract every ride, **ticked at checkout**; Foodyzz does **not** supply one |

**Still open:**

| # | Site says | App does | Fix |
|---|---|---|---|
| A | "Rent by the week **or month**" | Rent is weekly only | Reword the site |
| B | "Extend or return **any time**" | 4-week minimum | Reword the site |
| C | "**No hidden fees**" | True now, but no prices published on the site at all | Publish the price table — it is finally clean enough to show |
| D | Rent card implies the same bike as other plans | Rent may be a **used** bike | Say so; it is a legitimate reason rent is cheaper |
| E | No specs anywhere | Class 2, 15 mph, UL 2849, UL 2271, IP65, 300 lb, up to 50 mi | Put the specs on the site — best asset we have |
| F | `compliance@foodyzz.com` absent | Shown in-app | Add to the site |
| G | Home page still says bikes are "delivered checked and **charged**" | Terms now say charging is the rider's job and Foodyzz runs no charging stations | Not a contradiction, but decide what the pre-delivery charging operation is and whether FDNY rules touch it |

---

## 12. The one-paragraph brief

> Foodyzz rents and sells UL-certified delivery e-bikes to New York City riders and brings the bike to their door. A rider can rent for $22.49 a week on a four-week minimum, pay $75.98 a month and own the bike outright in twelve, or buy it for $899. There is no credit check and no store visit. The card is authorised when the rider books and charged only when the bike is in their hands, and the $100 deposit comes back when the bike does. Certification matters here: New York made UL 2849 and UL 2271 mandatory for any bike rented or sold in the city, and Foodyzz publishes both certificate numbers and the lab that issued them — TÜV Rheinland — on the bike's listing, where a rider can check them before paying. Every bike ships limited to 15 mph, the city's new limit, and every rental includes a damage and theft waiver on the bike.
