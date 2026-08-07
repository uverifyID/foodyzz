# Foodyzz — Brand Source of Truth

> **Read this before writing a single line of copy.** Everything here is verified against the app source, the Cloud Functions, the seeded config, or the live website — with file references so it can be re-checked. If a fact is not in this document, do not publish it.
>
> Last verified: **Aug 6, 2026**, against branch `sdk-54-android-36`.
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

The app calls them **Rent**, **Rent to Buy**, and **Buy**. The website currently says "Rent-to-Own." **Pick one and change the other.** Recommendation: standardise on **Rent to Buy** everywhere, because that is what the customer sees at checkout and mismatched names at the point of payment kill conversion. (See `../OPEN-QUESTIONS.md` Q5.)

| | Rent | Rent to Buy | Buy |
|---|---|---|---|
| App blurb (verbatim) | "Weekly rental. New or used bike." | "Monthly payments, the bike is yours at the end. Always a new bike." | "One-time purchase. Always a new bike." |
| Billed | Weekly rate, whole term up front at delivery | Monthly installments | Once |
| Term | Customer picks, **4-week minimum** | **Fixed** at 8 months (Model 1) or 10 months (Model 2) | — |
| Bike condition | **New or used** | Always new | Always new |
| Deposit | $100 | $100 | **None** |
| Fee bundle | Yes | Yes, every month | **None** |
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

**Source of truth is the Firestore doc `apiConfig/logistics`, editable by admins.** The values below are the seeded defaults, mirrored as a client fallback in `foodyzz/src/services/logistics.ts:17-45` and `functions/scripts/seed-logistics.js:30-81`. **Re-check them against live config before any campaign.**

### Base rates

| Model | Rent | Rent to Buy | Buy | Minimum commitment |
|---|---|---|---|---|
| **Foodyzz Model 1** | $19.99/week | $89.99/month | **$799** | 4 weeks · 8 months |
| **Foodyzz Model 2** | $29.99/week | $109.99/month | **$999** | 4 weeks · 10 months |

### The fee bundle

Four fees exist and **all four are marked required** — nothing is opt-out in practice.

| Fee | Amount | Cadence |
|---|---|---|
| Deposit | **$100.00** | Once, refundable |
| Weekly maintenance | $5.99 | per rental period |
| GPS tracker | $4.99 | per rental period |
| Insurance | $9.99 | per rental period |
| **Bundle total (excl. deposit)** | **$20.97** | **per rental period** |

**The mechanic that matters most:** the fee bundle is charged **once per rental period, not per week.** A 4-week rent pays the base rate ×4 and the bundle ×1. Confirmed at `foodyzz/src/services/logistics.ts:328-340` — the code comment is explicit: *"Fees are billed once per rental period — NOT per week/month of the term."*

A rent-to-buy installment re-bills the whole bundle every month.

### What a customer actually pays

All figures **exclude sales tax and the card-processing fee**, both added at checkout. The deposit is charged as a **separate second transaction at delivery** and is never on the rental invoice.

**Rent — Model 1**

| Term | Base | Bundle | **Charged at delivery** | Effective $/week |
|---|---|---|---|---|
| 4 weeks (minimum) | $79.96 | $20.97 | **$100.93** | $25.23 |
| 8 weeks | $159.92 | $20.97 | **$180.89** | $22.61 |
| 12 weeks | $239.88 | $20.97 | **$260.85** | $21.74 |

**Rent — Model 2**

| Term | Base | Bundle | **Charged at delivery** | Effective $/week |
|---|---|---|---|---|
| 4 weeks (minimum) | $119.96 | $20.97 | **$140.93** | $35.23 |
| 8 weeks | $239.92 | $20.97 | **$260.89** | $32.61 |
| 12 weeks | $359.88 | $20.97 | **$380.85** | $31.74 |

**Rent to Buy**

| Model | Monthly (base + bundle) | Months | **Total to own** | vs. buying outright |
|---|---|---|---|---|
| Model 1 | $89.99 + $20.97 = **$110.96** | 8 | **$887.68** | +$88.68 over the $799 cash price |
| Model 2 | $109.99 + $20.97 = **$130.96** | 10 | **$1,309.60** | +$310.60 over the $999 cash price |

**Buy** — $799 (Model 1) / $999 (Model 2). No deposit, no fee bundle, no document check, no return leg.

### Other money facts

- **Delivery is free.** `deliveryFee` is hardcoded to 0 — "delivery is bundled into the rental rate."
- **No platform fee, no commission, no rush surcharge.** All hardcoded to 0.
- **Sales tax** comes from the assigned store record, not hardcoded. Applied to the service subtotal only.
- **Card-processing fee** is passed through to the customer and shown combined with tax as a single **"Taxes and fees"** line.
- **Missed collection: $25 admin fee + the rental renews for another full term**, charged to the saved card. Disclosed twice before it can happen (in the "on our way" push and in the due-soon email).
- **Tips** are optional, post-delivery, untaxed, commission-free.

---

## 4. The bike — specs

⚠️ The in-app spec block is a **single hardcoded string applied to both models** (`OrderWizard.tsx:882-911`), not per-model data. Confirm both models match before publishing a spec sheet. See `../OPEN-QUESTIONS.md` Q6.

**Class: Class 2** *(confirmed Aug 6, 2026)*

Class 2 under NY VTL §121-b means **throttle-capable, with motor assist cutting off at 20 mph**. Two consequences worth knowing:

- **The throttle is a selling point nobody is using.** A rider pulling away from a light with a loaded bag on a Manhattan hill cares about this. It is currently mentioned in no marketing anywhere.
- **City Council Intro 244 would ban the sale and rental of Class 3 e-bikes. A Class 2 fleet is outside its scope.** A real business risk that turned out not to apply.

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
- **Motor assist to 20 mph** (Class 2)
- Range: **up to 80 km / 50 miles** with pedal assistance in eco mode
- Integrated **battery management system (BMS)**

⚠️ **The app currently states "Top speed: 21 mph," which conflicts with the Class 2 designation.** Probably the difference between what the bike can reach and where the motor cuts off — but it should not be published next to a Class 2 claim. **The 21 mph figure has been pulled from all marketing copy in this folder.** See Q4b.

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

## 11. Facts that contradict each other — fix before launch

| # | Website says | App does | Fix |
|---|---|---|---|
| 1 | "Rent by the week **or month**" | Rent is weekly only; monthly is rent-to-buy | Reword the site |
| 2 | "Extend or return **any time**" | 4-week minimum commitment | Reword the site |
| 3 | "**Rent-to-Own**" | "**Rent to Buy**" | Standardise on Rent to Buy |
| 4 | "**No hidden fees**" | $20.97 bundle + deposit, no prices published on site | Publish the price table |
| 5 | Rent card implies same bike as other plans | Rent may be a **used** bike | Say so — it is a legitimate reason rent is cheap |
| 6 | No specs anywhere | Class 2, UL 2849, UL 2271, IP65, 300 lbs rider+cargo, up to 50 mi | Put the specs on the site — they are the best asset we have |
| 9 | — | App says "Top speed: 21 mph", which conflicts with Class 2 | Change the app string to "Motor assist to 20 mph (Class 2)" |
| 7 | No prices anywhere | Real prices exist and are already public in the App Store screenshots | Publish them |
| 8 | `compliance@foodyzz.com` absent | Shown in-app | Add to the site |

---

## 12. The one-paragraph brief

> Foodyzz rents and sells UL-certified delivery e-bikes to New York City riders and brings the bike to their door. A rider can rent from $19.99 a week on a four-week minimum, pay $110.96 a month and own the bike outright in eight months, or buy it for $799. There is no credit check and no store visit. The card is authorised when the rider books and charged only when the bike is in their hands, and the $100 deposit comes back when the bike does. Certification matters here: New York made UL 2849 and UL 2271 mandatory for any bike rented or sold in the city, battery fires are up 70% this year, and the Foodyzz mark is on the frame where an inspector — or a landlord — can see it.
