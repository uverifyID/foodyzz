# NYC E-Bike Rules — Compliance Fact Sheet for Marketing

> Compiled Aug 2026. **This is the file to check before publishing any claim about the law.** Every item carries a source and an effective date. Where something is pending rather than law, it says so — publishing a pending bill as if it were law would be the fastest way to lose credibility with this audience, who live with these rules daily.
>
> Nothing here is legal advice, and marketing copy must never present it as such.

---

## 1. E-bike classes and the speed cap

**NY State classification (VTL §121-b):**
- **Class 1** — pedal-assist only, assist cuts off at 20 mph
- **Class 2** — throttle-capable, motor cuts off at 20 mph
- **Class 3** — 25 mph, legal in NYC (NYC is specifically authorized for Class 3)

**The citywide 15 mph speed cap — this overrides all of the above.**
- Final rule published in the City Record **Sept 24, 2025**; **effective Oct 24, 2025**.
- Applies to **all classes** — 1, 2 and 3 — on streets, bike lanes, greenways, bridges and park drives, **regardless of the device's mechanical top speed**.
- Source: [NYC Rules — Speed Limits for E-Bikes, E-Scooters and Pedal-Assist Commercial Bicycles](https://rules.cityofnewyork.us/rule/speed-limits-for-e-bikes-e-scooters-and-pedal-assist-commercial-bicycles/); [Mayor's Office announcement](https://www.nyc.gov/mayors-office/news/2025/09/mayor-adams-announces-citywide-speed-limit-for-e-bikes-to-go-int)
- A cycling club **sued the City in Feb 2026** over the Central Park application. Litigation ongoing. ([Streetsblog](https://nyc.streetsblog.org/2026/02/18/cycle-club-sues-city-calling-central-park-bike-speed-limit-a-real-threat-to-active-transportation))

**What this means for Foodyzz copy.** The Foodyzz fleet is **Class 2** — throttle-capable, motor assist to 20 mph *(confirmed Aug 6, 2026)*. That is comfortably inside the e-bike definition. But **15 mph is the legal riding speed in NYC**, and any content that celebrates speed is both off-message and unsafe. The honest framing: the bike assists to 20, the city allows 15, ride to the limit.

⚠️ The app currently states a **"21 mph top speed"**, which sits above the Class 2 motor cutoff. Do not publish that figure alongside the Class 2 claim. See `../OPEN-QUESTIONS.md` Q4b.

---

## 2. The moped trap — the highest-stakes thing a rider can get wrong

Most fat-tire, throttle-only e-bikes capable of ~28 mph that are sold to delivery riders **legally count as mopeds, not e-bikes**, under NY State law. Riding one without moped registration, a licence and insurance is illegal.

**Consequences, documented:**
- NYC seized **27,000+ motorized vehicles in 2024** — roughly a 50% year-over-year increase.
- **42,000+ seized since 2022; over half destroyed.**
- Hochul signed **S.7703-B / A.8450-B** (July 2024), effective **Jan 7, 2025**: dealers must register mopeds with the DMV at point of sale.
- Ghost Car Task Force seizures have continued *despite* the March 2026 summons reform.

Sources: [NYC Comptroller — Street Safety in the Era of Micromobility](https://comptroller.nyc.gov/reports/street-safety-in-the-era-of-micromobility/); [Documented](https://documentedny.com/2025/03/17/delivery-holden-license-registry-new-york-e-bike-moped/)

**Why this matters commercially.** A rider who buys a cheap 28 mph throttle bike online can lose it permanently, with no recourse and no refund. Foodyzz rents and sells a **Class 2** bike — throttle-capable, motor assist to 20 mph — which sits well inside the e-bike definition. This is a genuine safety-of-investment argument and it is the strongest reason to choose a known supplier over a marketplace listing.

**And note the throttle.** Class 2 means a rider gets throttle assist pulling away from a light with a loaded bag — the thing a delivery rider actually wants — **without** crossing into moped territory. That combination is worth saying out loud, and no competitor says it.

---

## 3. Local Law 39 of 2023 — the certification mandate (most important section)

**Effective Sept 16, 2023.** Local Law 39 bars the **sale, lease, and rental** in New York City of e-bikes, e-scooters and lithium-ion batteries unless they are certified to the relevant UL standard:

| Standard | Covers |
|---|---|
| **UL 2849** | E-bike electrical drive systems |
| **UL 2271** | Lithium-ion batteries for light electric vehicles |
| **UL 2272** | E-scooter electrical systems |

Sources: [NYC Rules — Uncertified Storage Batteries for Powered Mobility Devices](https://rules.cityofnewyork.us/rule/uncertified-storage-batteries-for-powered-mobility-devices/); [NYC Council press release](https://council.nyc.gov/press/2023/03/02/2361/)

**The obligation falls on the renter, not just the seller.** "Lease" and "rental" are named in the law. A company that rents e-bikes in NYC is directly in scope. This is not a nice-to-have marketing badge for Foodyzz — it is the licence to operate.

**Foodyzz's certification, confirmed Aug 6, 2026** (supplier certification and testing sheet):

| | |
|---|---|
| **UL 2849** — complete vehicle electrical system | Certificate **CU 726061660001** |
| **UL 2271** — battery | Certificate **CU 72303450 0003** |
| Testing laboratory | **TÜV Rheinland** |
| Public verification | **certipedia.com** |
| Mark location | Displayed on the frame |
| IP rating | IP65 |
| Frame loading | 300 lbs, **rider + cargo combined** (136 kg) |
| Transport documents | MSDS, UN38.3, Identification and Classification Report |

Mirrored in the app at `foodyzz/src/screens/OrderWizard.tsx:882-911`, shown to every customer before checkout. Compliance contact: **compliance@foodyzz.com**.

**⚠️ Two things before this appears in an ad.** See `../OPEN-QUESTIONS.md` Q1.

1. ~~**Verify both certificate numbers on Certipedia.**~~ ✅ **Done Aug 7** — both live and valid: bike **ANSI/CAN/UL 2849:2022** (model E FORWARD X, holder XIANGJIN Tianjin Cycle, issued 10 Mar 2026), battery **ANSI/CAN/UL/ULC 2271:2023** (pack LN-IR-5-U, holder LN Energy Technology, issued 5 Jan 2024). Screenshot both pages for the substantiation file.
2. ~~**Confirm NYC accepts TÜV Rheinland certification for Local Law 39.**~~ ✅ **Answered Aug 7.** DCWP's rules accept laboratories accredited to ISO 17025 / ISO 17065 — deliberately broader than NRTL-only. **TÜV Rheinland of North America, Inc.** is ISO-accredited, is an OSHA-recognised NRTL with recognition expanded to cover e-bikes, and appears **by name** on DCWP's published accredited-laboratory list — DCWP, *Accredited Testing Laboratory List for Micromobility Devices and Batteries*, rev. **4/28/2025**, page 2 — [nyc.gov/assets/dca/downloads/pdf/businesses/Accredited-Testing-Laboratory-List.pdf](https://www.nyc.gov/assets/dca/downloads/pdf/businesses/Accredited-Testing-Laboratory-List.pdf). Listed as **“TUV Rheinland of North America, Inc.”** with the TÜV Rheinland logo, alongside UL LLC. The cTUVus mark on our frames is that entity's NRTL mark, so the certificate and the listed lab are the same legal entity. The PDF is in the substantiation file; re-check it before each campaign, as DCWP revises it.

Note also that the originals are **supplier-held** — their sheet says certificates and reports come "during the final contract confirmation stage." Get them and file them at contract.

---

## 4. Lithium-ion battery fires — the reason certification sells

FDNY figures, citywide (not delivery-specific):

| Year | Fires | Injuries | Deaths |
|---|---|---|---|
| 2020 | 44 | 23 | 0 |
| 2021 | 104 | 79 | 4 |
| 2022 | 220 | 147 | 6 |
| 2023 (thru Jul 3) | 114 investigations | 74 | 13 |
| 2025 | — | — | **1** |
| **2026 YTD** | **235** (vs 138 same period 2025, ~**+70%**) | — | 1 (first of 2026, a 48-year-old Queens man) |

The counterintuitive and important story: **fires are up sharply while deaths have collapsed** — from 18 in 2023 to 6 in 2024 to 1 in 2025. UL Standards & Engagement credits the certification mandate being written into law. Non-structural (outdoor) fires rose 137 vs 48, suggesting more fires are happening outside living spaces.

Sources: [amNY — 70% increase in 2026](https://www.amny.com/new-york/nyc-lithium-ion-battery-fires-2026-fdny/); [UL Standards — deaths fell to one in 2025](https://ulse.org/insight/deaths-from-nyc-e-bike-fires-fell-to-one-in-2025-two-years-after-ul-standards-written-into-law/); [FireRescue1 — first 2026 death](https://www.firerescue1.com/lithium-ion-battery-fires/fdny-reports-nycs-first-li-ion-battery-fire-death-of-2026)

**This is the single best evidence-backed argument Foodyzz has**, and it lands without fear-mongering: certification is working, and a certified bike is how you get on the right side of that number.

---

## 5. Rider requirements — helmet, age, licence

| Requirement | Status |
|---|---|
| Licence to ride an e-bike | **Not required** for Class 1/2/3 e-bikes. **Required** if the device is legally a moped. |
| Registration | Not required for e-bikes. Required for mopeds (DMV, at point of sale since Jan 7, 2025). |
| Insurance | Not required for e-bikes today. Required for mopeds. See §7 for pending legislation. |
| Helmet | Required for Class 3 riders and for riders under 18. Commercial cyclists in NYC are subject to helmet requirements. **`Verify before publishing`** — get the current DOT rule text rather than citing this table. |
| Minimum age | 16 to operate a Class 3. **`Verify before publishing`.** |

**Updated Aug 7.** A **helmet policy now exists** — required on every ride by contract, ticked at checkout, and Foodyzz does **not** supply the helmet. There are still **no rider-protection terms of any kind**: the Protection Plan waives costs on the bike and never covers the rider. **There is still no automated minimum-age check**; Terms require 18+ and the ID document check is the control in practice. Marketing must not imply rider protection exists. See `../OPEN-QUESTIONS.md` Q2.

---

## 6. Delivery-worker minimum pay — the number riders care most about

DCWP minimum pay rate, per hour, **excluding tips**:

| Effective | Rate |
|---|---|
| Dec 2023 (enforcement began) | $17.96 |
| Apr 1, 2024 | $19.56 |
| Apr 1, 2025 | $21.44 |
| **Apr 1, 2026** | **$22.13** (3.2% CPI adjustment) |

Pre-law baseline: workers averaged **$5.39/hr before tips**. Combined pay + tips rose from **$10.48/hr to $27.32/hr** since enforcement began. DCWP must announce each adjustment by Feb 1, so the increase recurs every April 1 — a predictable annual content moment.

**Tips enforcement:** new DCWP rules enforced from **Jan 26, 2026** require apps to show a clear tipping option at checkout including a selectable 10% tip. DCWP alleges Uber and DoorDash cost workers **~$550M in tips** by hiding tip menus after the 2023 pay standard. The Mayor's office claims **$100M+** delivered to workers since Jan 2026; a July 2026 DCWP report cites **$104M** in tips returned.

Sources: [Jackson Lewis](https://www.jacksonlewis.com/insights/final-phase-nyc-minimum-pay-rate-increase-app-based-delivery-workers-effect); [NYC.gov DCWP](https://www.nyc.gov/site/dca/workers/workersrights/Delivery-Workers.page); [DCWP $550M report](https://www.nyc.gov/site/dca/news/005-26/dcwp-report-shows-uber-doordash-drove-550-million-delivery-worker-pay-losses); [Mayor's Office, July 2026](https://www.nyc.gov/mayors-office/news/2026/07/mayor-mamdani-delivers-more-than--100-million-for-delivery-worke)

**Actual earnings, for honest ROI math:** a Sept 2025 DCWP quarterly report found deliveristas average **17.4 hrs/week earning $366.51/week**. Do not build a payback calculator on 40-hour weeks.

---

## 7. Enforcement climate 2025–2026

**Criminal summonses — reversed, then partially un-reversed in practice.**
- NYPD began issuing **criminal** summonses for e-bike/moped traffic violations from late April 2025.
- Mayor Mamdani announced an end to criminal enforcement for minor traffic violations **March 18, 2026**, effective **March 27, 2026** — low-level violations became civil.
- **But NYPD wrote 257 criminal "reckless riding" summonses between Mar 31 and Jul 13, 2026 anyway.** A lawsuit seeks to restore criminal enforcement.

Sources: [Streetsblog, Mar 2026](https://nyc.streetsblog.org/2026/03/18/mamdani-ends-nypd-ebike-cyclist-criminal-summons); [Streetsblog, Jul 2026](https://nyc.streetsblog.org/2026/07/23/nypd-is-still-writing-criminal-summonses-to-cyclists-after-mamdani-policy-change); [Mayor's Office](https://www.nyc.gov/mayors-office/news/2026/03/mayor-mamdani-announces-end-to-criminal-enforcement-for-minor-tr)

**Every guide published before March 2026 is now wrong.** That is a content opportunity — and a reason to date-stamp anything Foodyzz publishes on this topic and commit to updating it.

**Department of Sustainable Delivery (DSD)** — announced Jan 2024, formally launched **July 2025** under DOT. Mandate: enforcement against illegal moped/e-bike riding, holding delivery apps accountable for equipment legality and rider safety. FY2026 budget funds up to **45 new DOT peace officers**, but the **first class is not deployed until 2028** — so enforcement capacity in 2026 remains minimal despite the department existing.

**Pending City Council bills** (from an Aug 6, 2026 Streetsblog roundup of ~16 bills Speaker Julie Menin is weighing). **None of these are law. Do not describe any of them as current requirements.**

| Bill | Sponsor | What it would do |
|---|---|---|
| Intro 950 | Schulman | Require delivery services to hold a DCWP business licence |
| **Intro 244** | Hudson | **Ban sale/rental of Class 3 e-bikes (25 mph throttle-capable)** |
| Intro 389 | Restler | Require apps to ensure mopeds are DMV-registered |
| Intro 110 | Brooks-Powers | Require worker rosters, safety equipment, ID |
| Intro 78 | Brewer | Require apps to disclose driver ID/location/timing data |
| Reso 43 | Brewer | Urge the State to create a commercial e-bike delivery registration programme |

Also pending at State level: **A.4083 / S.2528** would require **$25,000 liability insurance** for e-bikes in NYC. **Not law.** ([NY Senate S2528](https://www.nysenate.gov/legislation/bills/2025/S2528))

**Intro 244 does not apply to Foodyzz.** It targets Class 3 sale and rental, and the fleet is **Class 2** *(confirmed Aug 6, 2026)*. Worth continuing to watch — if it passes, competitors renting Class 3 bikes have a problem and Foodyzz does not, which is a positioning opportunity rather than a risk.

---

## 8. Charging infrastructure

- **Deliverista Hub**, City Hall Park, **249 Broadway** — opened **April 2026**, first in the nation. **40 battery-charging cabinets**, rest space, bike repair, worker support (wage theft, app deactivation guidance). Open 24/7.
- A second hub on Broadway (Tribeca) was under construction as of April 2026.
- Proposed future sites: Verdi Square, Fordham Heights.
- **PopWheels** — ~30 Manhattan cabinets, $75/month unlimited swaps, 16-battery fire-suppressing cabinets.
- NYC DOT / Newlab public charging pilot sites (Swobbee, PopWheels, Swiftmile): **Cooper Square, Brooklyn Army Terminal, Essex Market, Plaza de las Américas, Willoughby/Jay St**.

Sources: [The City](https://www.thecity.nyc/2026/04/07/deliverista-bike-hub-city-hall-schumer-mamdani/); [CBS NY](https://www.cbsnews.com/newyork/news/deliverista-hub-city-all-new-york-city/); [Streetsblog, DOT charging](https://nyc.streetsblog.org/2024/03/01/dot-debuts-public-e-bike-charging-for-deliveristas)

**Scale reality:** 40 cabinets at one hub against 70,000–80,000 workers. Charging remains the unsolved problem, and Foodyzz does not solve it. **Do not imply otherwise.** The honest version is that the Foodyzz battery is removable and rated for 50 miles per charge in eco mode, and that riders should plan their charging — plus a link to where the public cabinets are.

---

## 9. Claims Foodyzz MAY make

Each of these is supported by code, config, or a cited public source.

✅ **"UL 2849 certified, tested by TÜV Rheinland"** — certificate CU 726061660001. *Verify on certipedia.com and screenshot it before the first ad runs.*
✅ **"UL 2271 certified battery, tested by TÜV Rheinland"** — certificate CU 72303450 0003
✅ "The certification mark is displayed on the frame"
✅ **"Class 2 e-bike — throttle-capable, motor assist to 20 mph"**
✅ "IP65 rated" · "removable battery" · "integrated battery management system"
✅ **"Carries 300 lbs, rider and cargo combined"** — always with the qualifier
✅ "Up to 50 miles per charge with pedal assist in eco mode" — always with the qualifier, never as a flat "50 mile range"
✅ "Delivered to your door" · "We bring the bike to you" · delivery window 5–9 PM
✅ "Card is authorised when you book. You are not charged until the bike is delivered."
✅ "Cancel free any time before delivery"
✅ "$100 deposit, refundable when you return the bike, minus any damage"
✅ "No credit check" — there is no credit check anywhere in the flow
✅ "Pay off your rent-to-buy early, no penalty" — `payoffRentToBuy` exists and charges only the remaining periods
✅ "The bike is yours at the end" — ownership transfer is implemented
✅ "In-app chat with FoodyzzHQ"
✅ NYC statistics from §4 and §6, with the source and date shown

## 10. Claims Foodyzz MUST NOT make

❌ **"$22.49/week"** as a standalone price. The minimum commitment is 4 weeks and the fee bundle applies — the real first charge is **$95.95** before tax and card fee. Leading with $22.49 unqualified is the exact bait practice this plan is positioned against.
❌ **"No hidden fees"** while the website shows no prices at all. Either publish the full price table or drop the claim. (It is currently on the live site — `website/index.html:380`.)
❌ **"Extend or return any time"** — the live site says this; the app enforces a 4-week minimum. Contradiction, fix the site.
❌ **Anything about insurance coverage.** Foodyzz charges $9.99/week for a line item labelled "Insurance" with **no coverage terms defined anywhere in the codebase**. Until a policy document exists, never state or imply what it covers. See Q3.
❌ **Theft protection or theft coverage.** No theft claim flow exists in the product.
❌ **Battery swap, swap network, or spare batteries.** Not a Foodyzz feature. Competitors have it; we do not.
❌ **Roadside assistance or on-street repair.** Not in the product.
❌ **Helmet provided, safety gear, or rider training.** None exist.
❌ **Any minimum age or licence requirement claim** — the app enforces none.
❌ **"Five boroughs" / "all of NYC."** The live site says Manhattan (UWS, Harlem, Chelsea, SoHo) with Brooklyn/Queens/Bronx "soon". The app's ZIP fallback table covers only 8 Manhattan ZIPs. Say what is actually served.
❌ **DoorDash, Uber Eats, Grubhub or Relay logos, or any implied partnership.** There is no partnership. Naming the platforms descriptively ("for riders delivering with DoorDash or Uber Eats") is fine; using their marks is not.
❌ **Pending legislation described as law** — Intro 244, A.4083/S.2528 and the rest are proposals.
❌ **"UL Listed"** — that phrasing implies UL Solutions performed the listing. The lab is **TÜV Rheinland**. Say "UL 2849 certified, tested by TÜV Rheinland."
❌ **"21 mph top speed"** — conflicts with the Class 2 designation. Pulled pending Q4b.
❌ **"300 lb frame load"** without "rider + cargo combined" — a 200 lb rider will read it as 300 lbs of cargo capacity.
❌ **"$22.13/hr guaranteed"** framed as what a rider will earn. It is a platform-side minimum on active trip time; the DCWP-reported real average is $366.51/week over 17.4 hours.
❌ **Ratings, review counts, "#1", "most popular", or customer numbers.** Foodyzz has launched nothing. The app-store screenshots literally show "SERVICE HISTORY (0)". No social proof claim is available yet.
❌ **Any use of the test persona "JOSEPH BUFFET" or the number +1 202 555 0123** from the HQ screenshots.
❌ **Legal advice.** Foodyzz can explain the rules and cite the source. It cannot tell a rider what to do about a summons.
