# Open Questions — Answers Needed Before Launch

> Ordered by urgency. **Q1–Q4 block published claims.** Q5–Q9 block launch mechanics. Q10+ shape the plan but don't stop it.
>
> Where an answer isn't available, the relevant asset is marked ⛔ in the caption library and calendar and simply doesn't ship. Nothing gets published on a guess.

---

## 🔴 Blocking — a claim can't be made until these are answered

### ~~Q1 — Is there a UL certificate on file?~~ ✅ MOSTLY ANSWERED — three actions remain

**Answered Aug 6, 2026**, from the supplier's certification and testing sheet:

| | |
|---|---|
| **UL 2849** — complete vehicle electrical system | Certificate **CU 726061660001** |
| **UL 2271** — battery | Certificate **CU 72303450 0003** |
| Issuing laboratory | **TÜV Rheinland** |
| Verifiable at | **certipedia.com** (TÜV Rheinland's public certificate database) |
| Certification mark | Displayed on the frame |
| IP rating | IP65 (dust and splash resistant) |
| Frame loading | **300 lbs rider + cargo combined** (136 kg) |
| Shipping documents held | MSDS, UN38.3, Identification and Classification Report for Transport of Goods |

**This unblocks C05, C06, T03 and blog post #4** — after action 1 below.

**Three things still to do:**

**1. Verify both numbers on Certipedia yourself. Do this before the first ad runs.**
It's free, takes five minutes, and the supplier explicitly invites it. Check that each certificate is **live, in scope, and names the actual model** you're buying. Screenshot the results and keep them — that screenshot is your substantiation file if anyone ever challenges the claim.

**2. Note what you don't have yet.** The supplier's own sheet says: *"we are able to provide the original certification certificates and reports during the final contract confirmation stage; however… we cannot share our company's certificates or reports during the initial quotation phase."*

So these are **supplier-held certificates you have numbers for, not documents in your possession.** That's normal at this stage and the numbers are verifiable, which is what matters. But get the originals at contract confirmation and file them. If the supplier relationship ever changes, the certification story changes with it.

**3. Confirm NYC accepts TÜV Rheinland certification for Local Law 39.** ⚠️
The law requires certification to UL 2849 / UL 2271 by an accredited testing laboratory. TÜV Rheinland is a major, widely recognised lab — but "certified to the UL 2849 standard by TÜV Rheinland" and "UL Listed by UL Solutions" are different statements, and some enforcement reads that distinction narrowly.

**This is worth one email to FDNY or DCWP, or twenty minutes with a compliance lawyer.** It's almost certainly fine. But you are about to build a marketing position on it in a city that is actively enforcing, and "almost certainly" is not the standard you want when the whole pitch is that you tell the truth about numbers.

**Copy guidance meanwhile:** say **"UL 2849 certified, tested by TÜV Rheinland"** rather than implying UL Solutions did the listing. It's accurate, it names a lab riders' landlords will recognise, and it can't be picked apart.

---

### Q2 — What is the minimum age to rent, and is there a helmet policy?

The app enforces **neither**. No age check exists anywhere in the code; no helmet policy or provision exists.

Every photograph and video in the plan shows a helmet, because that's the right call regardless. But if there's no policy, marketing shouldn't imply one — and if there *should* be an age minimum, that's a product gap worth knowing about before a 16-year-old rents a bike.

---

### Q3 — What does the $9.99/week "Insurance" fee actually cover?

**This is the most serious gap in the entire audit.**

Foodyzz charges every rental and every rent-to-buy installment a required $9.99 line item labelled "Insurance." **There are no coverage terms defined anywhere in the codebase** — no policy, no limits, no exclusions, no claims flow. There is also no theft claim flow, despite 54% of NYC riders having had a bike stolen.

Three questions:
1. Is there an actual insurance policy behind it?
2. If so, what does it cover, and what are the limits?
3. If not, should the line item be renamed?

**Until answered:** no marketing may mention insurance or coverage at all. Blog post #12 is blocked. Any comment or DM asking about it routes to chat, never to a public answer.

**A customer will ask this in week one.** It's the obvious question about a $9.99 weekly charge, and "we'll get back to you" is a bad answer to give in public.

---

### ~~Q4 — What class are the bikes?~~ ✅ ANSWERED — **Class 2**

**Answered Aug 6, 2026: the fleet is Class 2.**

**This is good news twice over:**
1. **Intro 244 no longer applies.** That bill would ban the sale and rental of Class 3 e-bikes. A Class 2 fleet is outside its scope entirely — a real business-model risk removed.
2. **Class 2 means throttle-capable**, which is a genuine selling point for a delivery rider pulling away from a light with a loaded bag. Nothing in the current marketing mentions it. It should.

**But it creates a new conflict — see Q4b.**

---

### 🔴 Q4b — Class 2 caps motor assist at 20 mph. The app says 21 mph. Which is right?

Class 2 under NY VTL §121-b is throttle-capable with **motor assist cutting off at 20 mph**. The app's spec block states **"Top speed: 21 mph"** (`OrderWizard.tsx:907`).

Those two statements cannot both be describing the same thing.

**Most likely explanation:** 21 mph is the speed the bike can *reach* — a rider can always pedal past the motor cutoff — while the motor stops assisting at 20. That's normal and legal. But "top speed 21 mph" published next to "Class 2" invites exactly the wrong question from exactly the wrong reader.

**What's needed:** the manufacturer's spec sheet showing the **motor cutoff speed**, for both models.

**Why this matters more than it looks.** The certification and classification story is Pillar 2 of the whole positioning. If a rider, a competitor, or an inspector spots "21 mph" against a Class 2 claim, the credibility cost lands on the one thing this brand is selling — being the company that tells you the truth about numbers.

**Recommendation, pending the answer:** stop publishing "21 mph" as a headline spec. Say **"Class 2 e-bike — motor assist to 20 mph, throttle included."** It's more accurate, more useful, and it surfaces the throttle as the feature it is. The app's spec string should change too.

**Until answered:** the 21 mph figure has been pulled from all marketing copy in this folder.

---

## 🟠 Blocking launch mechanics

### Q5 — "Rent to Buy" or "Rent-to-Own"?

The app says **Rent to Buy**. The website says **Rent-to-Own**. Two names for one product, and the mismatch appears at the point of payment.

**Recommendation: standardise on "Rent to Buy"** — the app is what the customer sees at checkout, and changing HTML is cheaper than changing an app. Every asset in this folder uses Rent to Buy.

---

### Q6 — Do both models really share one spec sheet?

The spec block — 21 mph, 50 miles, IP65, 300 lb, UL 2849, UL 2271 — is a **single hardcoded UI string applied to both models**, not per-model data.

But Model 2 costs $200 more to buy and $20/month more to rent-to-buy. **If the specs are identical, what is the customer paying more for?** Either there's a real difference that should be in the marketing, or the pricing needs an explanation.

This is a marketing question and a product question at once. A rider will ask it in the comments.

---

### Q7 — Will there be a phone number and a published address?

Neither exists. `GlobalConfig.supportPhoneNumber` is a type field referenced nowhere in the app, and the site says only "Foodyzz HQ, New York, NY."

**Consequences:** no Google Business Profile, no map pack, no `LocalBusiness` schema — for a business whose entire market is one city and whose competitors all have local presence. It also means a rider who wants to talk to a person before spending $887.68 can't.

**Getting a phone number is the single highest-ROI local-SEO action available.** It's a business decision, not a technical one.

---

### Q8 — Who handles support in Spanish and French?

The app is **English only** — no i18n library, no locale files, everything hardcoded `en-US`. Chat says "we usually reply in minutes."

The customer base, per NYSERDA's 2025 survey: **46.5% French-primary, 25.1% Spanish, 21.8% English, 6.6% Chinese.**

Marketing in Spanish and French to a support desk that only speaks English creates a bad experience at exactly the moment a customer has committed money. **At minimum, a bilingual contractor covering chat during launch month.**

---

### Q9 — Who is making the logomark, and by when?

`foodyzz-icon.png` is byte-identical to the wordmark. There is no square mark and no SVG anywhere in the repo.

**A profile picture for Instagram, Facebook and TikTok cannot be made from a wide wordmark.** At 32–64px it's illegible. This blocks account creation, which blocks everything social.

**Minimum viable, one hour of work:** the lowercase "f" in brand green on black (or black on green), square canvas, proper optical padding. Plus an SVG export.

---

## 🟡 Shapes the plan

### Q10 — What is the maintenance SLA?

$5.99/week is charged for "Weekly maintenance." What does a customer actually get? If a bike breaks down mid-shift, what happens, and how fast?

There is no maintenance-request flow in the customer app — only the fee and a `maintenance` bike status. **Downtime is lost income for this customer**, so this is a genuine selling point if the answer is good, and a liability if it isn't. Blog post #20 is blocked on it.

---

### Q11 — Is comparative advertising signed off?

The strongest content in this plan is the honest comparison: **$887.68 over 8 months against Whizz's advertised ~$2,028 over 12.**

Comparative advertising is legal and defensible when every claim is accurate, sourced and current — and this one is built to be scrupulously fair, including a row where we lose on battery swaps. But competitor prices change, and Whizz publishes comparison content about everyone, so expect scrutiny.

**Recommendation:** get a lawyer's eye on the comparison table once, agree a re-verification cadence, then ship it.

---

### Q12 — Should there be a real referral/affiliate programme?

The user type has `referredByManagerId` and `referralCodeUsed`, but **nothing in the customer app reads or writes them**, and a code comment says referral is "visibility / thank-you only — no commission."

This audience runs on word of mouth. A working referral programme is probably the highest-ROI product change available to marketing — and it's also what unlocks the affiliate offer for creators. It's a product decision, not a marketing one.

---

### Q13 — What's the fleet size, and what happens when it sells out?

Seeded config has **32 bikes** — 15 Model 1, 17 Model 2. If that's close to reality, marketing could exhaust supply in a fortnight.

The app has a waitlist state, which is good. **What's the actual inventory, and what's the restock lead time?** The answer changes how hard to push, and whether "sold out" becomes social proof or an apology.

---

### Q14 — Is the fee bundle intentionally billed once per period?

Three fees labelled with a weekly cadence — maintenance $5.99, GPS $4.99, insurance $9.99 — are charged **once per rental period, not per week**. A 12-week rental pays the same $20.97 as a 4-week one.

The code comment says this is deliberate, and it's a genuinely good retention mechanic that this plan markets as a headline benefit. **Confirming it's intended and not a bug** matters, because "your effective weekly price drops the longer you ride" is about to be printed on a lot of graphics.

---

### Q15 — Are Manhattan-only and 5–9 PM delivery the real constraints?

Marketing says Manhattan (UWS, Harlem, Chelsea, SoHo) with other boroughs "soon," and delivery 5–9 PM with nothing same-day.

Both are constraints worth being honest about — but if either is about to change, the messaging should anticipate it rather than get rewritten in week three.

---

## Also worth fixing, not blocking

- `foodyzzhq/assets/images/newinstall/p1-p6.png` — **UniHamper laundromat illustrations are still shipping inside the Foodyzz HQ app.** A partner onboarding to Foodyzz currently sees another company's branded artwork.
- `htmlweb/` and `Mktweb/` are a different product's website living in this repo. Real risk that the wrong `out/` folder gets uploaded to Hostinger `public_html`.
- `assets/images/unclesam.png` — stock clipart, unrelated, duplicated in two places.
- The app-store screenshots use the test persona **"JOSEPH BUFFET" / +1 202 555 0123** and show empty states.
- The home page meta description is **232 characters** and will truncate in search results.
- `socialmedia/foodyzz.pdf` — the brief itself contains a stray hyperlink to `https://unihamper.com`.
