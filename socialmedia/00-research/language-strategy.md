# Language Strategy — Which Languages to Build For

> Primary research, Aug 2026. The headline finding (French is the largest language group among NYC delivery workers) contradicts the common assumption and should drive channel planning.

I'll load the web tools first.

---

I'll research each language systematically, starting with Spanish since it's highest priority.

---

Strong first signal: Whizz has a `/es/` Spanish subdirectory. Let me investigate the competitor Spanish footprint.

---

Whizz has a full `/es/` site including rent-to-own. Let me map the extent and check Zoomo/Joco.

---

Major finding: Whizz runs es/fr/ru but **no** zh or bn. Let me check Zoomo/Joco and then validate real query language via YouTube titles.

---

Both major competitors run Spanish. Now let me validate real query language — Deliveristas Unidos and dialect variation.

---

Key demographic data found. Let me get the Cornell survey specifics and test dialect variation.

---

"Sin buró de crédito" results are Mexico-domestic only — an important correction. Let me test the US-relevant variant and start on Chinese.

---

Critical Chinese finding: Zoomo has a HungryPanda (熊猫外卖) Chinese landing page. Let me investigate the channel reality.

---

Confirmed: Zoomo's Chinese page is partnership-only, not SEO. Let me verify the WeChat channel reality and start Bengali.

---

Let me test Bengali-script queries directly, plus the Banglish transliteration hypothesis.

---

Bengali evidence is clearly negative. Let me verify the Chinese social channel and gather Spanish volume signals.

---

Let me nail down the dialect question — which term competitors actually target — and check Spanish video/social evidence.

---

Notable gap: Whizz uses "alquiler" (Spain-leaning), not "renta" (Mexican). Let me verify dialect reality and the moped/"moto" angle.

---

Key insight: non-geo Spanish queries are hijacked by Spain e-commerce. Let me check remaining competitors and the Chinese SERP.

---

Found the channel answer. Let me confirm with the Documented article and pull authoritative NYSERDA data.

---

The NYSERDA PDF downloaded locally. Let me extract its text directly.

---

pypdf installed. Let me extract the NYSERDA report text.

---

Major unexpected finding. Let me read the key survey passages in detail.

---

Let me pull the report's competitor language analysis and acquisition-channel data.

---

Independent confirmation of competitor languages. Let me check acquisition channels and validate the Spanish SERP.

---

Let me do a final Bengali validation and confirm the French opportunity.

---

Research complete. Here are my findings.

---

# Non-English SEO Research — Foodyzz NYC

## The headline finding first

**The language you did not ask about is the biggest one.** NYSERDA's 2025 intercept survey of NYC delivery workers (n=331, 43 locations, Jan–May 2025) found the primary-language split was:

| Language | Share of NYC delivery workers | Asked about? |
|---|---|---|
| **French** (West African — Guinea, Mali, Senegal, Mauritania) | **46.5%** | ❌ No |
| **Spanish** | **25.1%** | ✅ Yes |
| English | 21.8% | — |
| **Chinese** | **6.6%** | ✅ Yes |
| **Bengali** | **not even a survey cohort** | ✅ Yes |

Source: [NYSERDA 25-38, NYC Delivery Worker Data Collection and Research Report](https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Publications/Research/Transportation/25-38-NYC-Delivery-Worker-Data-Collection-and-Research-Report.pdf) (I extracted the PDF text directly; the language breakdown is on p.16, methodology p.12–13).

This independently explains the competitor behavior I found. Per the same report's appendix: **Zoomo's site = EN/FR/ES. Whizz's site = EN/FR/ES/RU. JOCO = EN only.** Both leaders built French. Neither built Chinese or Bengali. That is two well-funded competitors independently reaching the same conclusion you're about to test.

---

## Methodology note — read before trusting any number

I have **no access to Google Keyword Planner, Ahrefs, or Semrush** in this environment, and no public source publishes volumes for these long-tail non-English terms. **Every volume figure below is a bottom-up estimate, not tool data.** I am labeling all of them rather than dressing up guesses as precision.

My estimation model, so you can audit it:

- NYC delivery workforce: **~65,000–80,000** ([THE CITY](https://www.thecity.nyc/2021/09/13/nyc-food-delivery-workers-pay-risk/); the 80k figure is the Deliverista Hub's own)
- Spanish-primary share: 25.1% → **~16,000–20,000 Spanish-speaking riders**
- Churn is the demand driver: NYSERDA found **30.8% have <6 months experience and 53.5% ≤1 year** — so roughly half the workforce turns over annually and needs a bike
- → ~8,000–10,000 Spanish-speaking riders enter the bike market per year
- → if 20–30% run *any* Spanish Google search: ~1,600–3,000 searches/year total
- → **~130–250 Spanish searches/month spread across the entire term set**, with the head term taking maybe 40–90

Anything I mark **[modeled]** comes from that chain. **[unverified estimate]** means I am guessing with weaker grounding. **[SERP-observed]** means I confirmed the competitive landscape by actually running the query.

---

## 1. SPANISH — build it, but not the way you drafted it

### Verified competitor evidence

Whizz runs a **~82-page Spanish site** — not a token page. Confirmed via [their sitemap](https://www.getwhizz.com/sitemap.xml), which carries `en`/`fr`/`es`/`ru` hreflang. Live Spanish pages include [`/es/rent-to-own`](https://www.getwhizz.com/es/rent-to-own) (H1: *"Alquilar hoy por $179/mes, sé dueño en 12 meses"*), `/es/battery-swapping`, `/es/storm-2`, `/es/philadelphia`, and a translated blog: [*"¿Cuánto cuesta alquilar una bicicleta eléctrica para entregarla en Nueva York?"*](https://www.getwhizz.com/es/blog/how-to-choose/cost-to-rent-e-bike-delivery-nyc). The translation is human-quality, not MT.

Zoomo has Spanish at `/esp/us/home` with a header language switcher.

**A competitor spending on 82 human-translated Spanish pages is the strongest possible signal that Spanish converts.**

### Three corrections to your draft keyword list

**(a) "bicicleta electrica a credito sin buro" is the wrong market — drop it.** "Buró de Crédito" is the *Mexican* credit bureau. I searched it and every result was Mexico-domestic consumer finance ([Kueski Pay](https://www.kueskipay.com/para-ti/tiendas/evobike), TikTok "créditos para reportados"). A rider already living in NYC is not searching a Mexican credit-bureau term for a US rental. **The real US-market objection keyword is "sin SSN" / "sin seguro social" / "sin crédito"** — and note Whizz's own Spanish rent-to-own page conspicuously does *not* optimize for it (it only says "No se requiere SSN" buried in an FAQ). That's an open gap.

**(b) Whizz uses "alquiler/alquilar" — Spain/neutral register. NYC's riders are Mexican/Guatemalan/Ecuadorian, who say "renta/rentar."** This is a real dialect gap you can attack. Whizz's H1s and titles all lead with *alquilar*/*alquiler*.

**(c) Geo modifier is mandatory, not optional.** I tested `"moto electrica" delivery repartidor` and the entire SERP was **Spain e-commerce** (soyinquieto.com, velcamotor.com, electyum.com, motoemocion.com). Spanish queries without "nueva york"/"NYC" get hijacked by Spain/LatAm domestic retail and bring you zero qualified traffic. **Every Spanish page you build must target a geo-modified term.**

### Spanish keyword table

| # | Term | Est. vol/mo (US) | Source / method | Difficulty | Intent |
|---|---|---|---|---|---|
| 1 | `renta de bicicleta electrica nueva york` | **40–90** | [modeled] head term, ~35% of Spanish demand | **Low–Med** — [SERP-observed] only Whizz `/es/` + Zoomo compete; rest is Tripadvisor/Viator tourism noise | Transactional / Local |
| 2 | `alquiler bicicleta electrica nueva york` | **30–70** | [modeled] dialect variant | **Med** — Whizz explicitly optimizes *alquiler*; also collides with tourism rental SERP | Transactional / Local |
| 3 | `bicicleta electrica para delivery nueva york` | **30–60** | [modeled] | **Low–Med** — Whizz + Zoomo only; thin SERP | Commercial / Local |
| 4 | `bicicleta electrica para delivery` | **90–200** | [unverified estimate] — broadest, but see caveat | **High + low value** — SERP is LatAm/Spain retail; poor NYC qualification | Informational |
| 5 | `cuanto cuesta una bicicleta electrica para delivery` | **20–50** | [modeled] — Whizz built a whole page for this exact question, implying they saw volume | **Low** — one competitor page | Informational → Commercial |
| 6 | `renta de bicicleta electrica sin SSN` / `sin seguro social` | **10–30** | [unverified estimate] — low volume, very high intent | **Very Low** — [SERP-observed] **nobody targets this** | Transactional |
| 7 | `bicicleta electrica sin credito nueva york` | **10–30** | [unverified estimate] | **Very Low** — open field | Transactional |
| 8 | `donde rentar bicicleta electrica en nueva york` | **10–30** | [modeled] long tail | **Low** | Local / Transactional |
| 9 | `bici electrica delivery nueva york` (colloquial *bici*) | **10–25** | [unverified estimate] — informal register, likely spoken > typed | **Very Low** | Commercial |
| 10 | `bicicleta para repartidor` | **10–30** | [unverified estimate] | **Med** — Spain retail SERP | Informational |
| 11 | `moto electrica para delivery nueva york` | **20–50** | [unverified estimate] — many NYC riders ride mopeds and say *moto* | **Low–Med** — [SERP-observed] no US player targets this in Spanish | Commercial / Local |
| 12 | `bicicleta electrica a credito nueva york` | **10–25** | [unverified estimate] | **Low** | Transactional |
| 13 | `rent to own bicicleta electrica nueva york` (code-switched) | **10–25** | [unverified estimate] — riders code-switch; Whizz's own ES title keeps English "Rent-to-Own" | **Low** | Transactional |
| 14 | `bicicleta electrica doordash / uber eats español` | **10–30** | [unverified estimate] | **Low–Med** | Commercial |
| 15 | `bateria bicicleta electrica delivery nueva york` | **10–25** | [unverified estimate] — retention/service content | **Low** | Informational |

**Realistic Spanish traffic ceiling: 300–700 organic visits/month at full maturity (15–25 pages, 12+ months).** Not a volume play — a **conversion** play. These are ~$170/mo recurring-revenue customers with high LTV, so even 20 conversions/month is material.

### Do Spanish-speaking riders actually use Google?

**Partially — and this is the honest caveat.** NYSERDA notes the researchers had to distribute their survey **through Los Deliveristas Unidos' WhatsApp group** to reach workers (p.~1100 of extracted text). WhatsApp and [Facebook](https://www.facebook.com/LosDeliveristasUnidos/) are the dominant peer channels; Facebook Marketplace is where used e-bikes actually change hands. Also material: a meaningful minority of "Hispanic" NYC riders speak **indigenous languages** (K'iche', Mam, Nahuatl, Kichwa) and have limited Spanish literacy — surveys relying on Spanish-language Facebook ads systematically miss them.

**Verdict: BUILD — highest priority of your three.** But treat SEO as ~40% of the Spanish plan and pair it with WhatsApp-shareable landing pages (fast-loading, mobile-first, click-to-WhatsApp CTA) since the actual referral mechanism is a link pasted into a rider group chat.

---

## 2. BENGALI / BANGLA — do not build. The evidence is clearly negative.

I looked hard for a reason to say yes and could not find one.

| Test run | Result |
|---|---|
| Bengali-script query `নিউ ইয়র্ক ইলেকট্রিক সাইকেল ভাড়া ডেলিভারি` | Google returned **English NYC results** (Whizz, NYC DOT, tourism) + Bangladesh-domestic Facebook pages. **Zero NYC Bengali commercial content exists to rank.** |
| Banglish `electric cycle vara/bhara New York delivery` | 100% **Bangladesh-domestic retail** — bikroy.com, BikeBD, Daraz, Akij Motors, Green Tiger, EzygoBD. Nothing NYC. |
| Competitor Bengali pages | **None.** Whizz sitemap has no `bn`. Zoomo has no `bn`. JOCO is English-only. |
| NYSERDA survey cohorts | English, Spanish, French, Chinese. **Bengali was not included at all.** |

| Term | Est. vol/mo | Source / method | Difficulty | Intent |
|---|---|---|---|---|
| `নিউ ইয়র্ক ইলেকট্রিক সাইকেল ভাড়া` | **~0–10** | [SERP-observed] no ranking corpus exists | N/A — nothing to beat, but nothing to win | Transactional |
| `electric cycle vara new york` (Banglish) | **~0–10** | [unverified estimate] | N/A | Transactional |
| `e-bike bhara NYC` | **~0–10** | [unverified estimate] | N/A | Transactional |

**The nuance that matters:** Bangladeshi delivery workers in NYC are demographically real and significant — the Cornell/LDU "Essential but Unprotected" survey lists Bangladesh among the top origin countries, and NYC DOT publishes [Bengali-language bike safety materials](https://www.nyc.gov/html/dot/html/about/deliverybybike.shtml). **But Bengali-language government outreach exists because of NYC's Local Law 30 language-access mandate, not because of market demand.** It is not evidence of search volume.

The operative fact: **Bangladeshi immigrants in NYC search in English.** Bengali is a spoken/community language here; typed commercial queries default to English. The near-zero volume also means near-zero difficulty — but ranking #1 for zero searches is worth zero.

**Verdict: DO NOT BUILD Bengali landing pages.** Realistic traffic ceiling: **<20 visits/month**, likely near zero. If you want this workforce, the channel is **physical + community**: JBBA (Jackson Heights Bangladeshi Business Association), mosques in Kensington/Jackson Heights, Bengali-language flyers at rest hubs, and WhatsApp groups. Consider one Bengali *trust page* (not an SEO page) that you link from flyers so an on-boarding rider can read terms in Bengali — that's a conversion asset, not a traffic asset.

---

## 3. CHINESE — do not build SEO pages. The channel finding is decisive.

This is the most interesting result, because the Chinese-speaking workforce **is** real and **is** commercially served — just not through Google.

### The decisive evidence

**1. Zoomo's only Chinese page is a partnership page, not an SEO page.** [`ridezoomo.com/us/zh-cn-hungry-panda`](https://www.ridezoomo.com/us/zh-cn-hungry-panda) — H1: 熊猫外卖骑手专属：纽约电动自行车租赁优惠. It has **no language switcher and no general Chinese site**. Zoomo reached Chinese riders by **partnering with HungryPanda (熊猫外卖)** — the Chinese-language delivery app that actually employs them. Note this reframes your competitive picture: **NYC's Chinese riders largely don't work DoorDash/UberEats — they work HungryPanda.** Zoomo bought that audience via BD, not SEO. NYSERDA's appendix confirms Zoomo's *website* languages are only EN/FR/ES.

**2. Documented NY — a Chinese-language NYC immigrant news outlet — reports riders find rental shops by word of mouth.** Their article [*移民外卖员指南：在纽约租电动自行车前需要了解的租赁合同事项*](https://documentedny.com/2025/09/19/chinese-language-ebike-rental-contract-tips/) states the most reliable shops are found **through word-of-mouth recommendations, via WhatsApp groups or conversations with other riders** — not search.

**3. WeChat is the information layer, and it is a walled garden Google cannot index.** Most Chinese-language speakers in the US get their news from WeChat ([Columbia Journalism Review](https://www.cjr.org/tow_center_reports/wechatting-american-politics-misinformation-polarization-and-immigrant-chinese-media.php)); Documented launched a [dedicated WeChat official account](https://documentedny.com/2023/12/04/documented-wechat-official-account/) precisely because that's the only way to reach this audience.

**4. Chinese-language NYC classifieds already own the intent.** 纽约华人资讯网 (nychinaren.com) and 纽约华人街 (usahuarenjie.com) are where NYC Chinese listings live — not Google.

**5. NYSERDA measured the disengagement directly.** Chinese-speaking workers were "**the least receptive despite being approached by native Chinese-speaking surveyors**"; the cohort missed its sample target and carries a **~21% margin of error** vs. 5–10% for other groups.

### Chinese keyword table

| Term | Est. vol/mo (US) | Source / method | Difficulty | Intent |
|---|---|---|---|---|
| `纽约 电动车 出租` | **10–40** | [unverified estimate]; 6.6% cohort × heavy off-Google behavior | **Low on Google / High in reality** — Google is not the venue | Transactional |
| `纽约 电动自行车 租` | **10–30** | [unverified estimate] | Low | Transactional |
| `外卖 电动车 纽约` | **10–30** | [SERP-observed] — SERP returns Zhihu/ZOL pages about **mainland China** delivery, not NYC | Med — mainland content crowds it out | Informational |
| `电瓶车 纽约 出租` | **~0–15** | [unverified estimate] — 电瓶车 skews mainland-colloquial | Low | Transactional |
| `法拉盛 电动车` (Flushing) | **10–30** | [SERP-observed] — TikTok + nychinaren listings rank | Low–Med | Local |
| `熊猫外卖 电动车 租` | **~0–15** | [unverified estimate] | Low — Zoomo owns via partnership | Transactional |

**Terminology, if you ever do build:** 电动自行车 (formal/legal, used by NYC DOT and city programs) · 电动车 (most common colloquial) · 电瓶车 (mainland colloquial) · 骑手 or 外卖员 (rider) · 租赁 (rental) · 电池 (battery).

**Verdict: DO NOT BUILD Chinese SEO landing pages.** Realistic organic ceiling: **<100 visits/month**, and the qualified subset is far smaller. The workforce is only 6.6% of the total and is structurally off-Google.

**Do this instead** — the ROI here is real, it's just not SEO:
- **Partner with HungryPanda (熊猫外卖) directly.** Zoomo proved the playbook works; it's a BD conversation, not a content investment.
- Get listed on **nychinaren.com / usahuarenjie.com**.
- Pitch **Documented's WeChat account** and Chinese-language NYC media.
- Physical presence in **Flushing and Sunset Park** (NYSERDA found Sunset Park is a top rider home-ZIP cluster).

---

## 4. FRENCH — the unasked opportunity you should act on

I'm flagging this because it's 46.5% of your target market and both competitors already moved.

| Term | Est. vol/mo | Source / method | Difficulty | Intent |
|---|---|---|---|---|
| `location vélo électrique New York livraison` | **30–80** | [modeled] — 46.5% cohort share applied to the same churn model | **Med** — Whizz `/fr/` + Zoomo `/fre/` both present | Transactional / Local |
| `vélo électrique livreur New York` | **20–60** | [modeled] | Med | Commercial / Local |
| `louer vélo électrique NYC sans SSN` | **10–30** | [unverified estimate] | **Low** — untargeted objection term | Transactional |
| `vélo électrique Uber Eats New York` | **10–30** | [unverified estimate] | Low–Med | Commercial |

Caveat worth respecting: many West African riders speak French as a *second* language alongside Wolof, Fula, Mandinka, or Arabic, and literacy varies — so French search volume likely under-indexes the 46.5% population share. Even so, it plausibly rivals or exceeds Spanish, and **both competitors validated it before you.**

---

## Recommended priority

| Rank | Language | Build? | Pages | Est. ceiling (org. visits/mo) | Primary channel |
|---|---|---|---|---|---|
| 1 | **Spanish** | ✅ Yes | 15–25 geo-modified | 300–700 | SEO + WhatsApp/Facebook |
| 2 | **French** | ✅ Yes (validate first) | 8–15 | 200–500 | SEO + community orgs |
| 3 | **Chinese** | ❌ No SEO | 1 partnership LP | <100 | HungryPanda BD, WeChat, Flushing |
| 4 | **Bengali** | ❌ No | 1 trust page (optional) | <20 | JBBA, mosques, flyers, WhatsApp |

**Three quick wins across all languages:** (1) own the **"sin SSN / sans SSN / no credit check"** objection cluster — genuinely uncontested, highest-intent traffic available; (2) attack the **"renta"** dialect gap Whizz left open by standardizing on *alquiler*; (3) never publish a non-English page without a **geo modifier**, or Spain and mainland-China SERPs will eat it.

**One caution on the NYSERDA data:** the intercept survey concentrated in midtown/lower Manhattan, which likely **undercounts Bengali riders in the Bronx/Queens and Chinese riders in Flushing**. The report acknowledges possible coverage bias. I'd treat 46.5% French as directionally strong but not precise — worth a cheap validation (a few hundred dollars of French vs. Spanish paid search) before committing a full French content build.

**Sources:**
- [NYSERDA 25-38 — NYC Delivery Worker Data Collection and Research Report](https://www.nyserda.ny.gov/-/media/Project/Nyserda/Files/Publications/Research/Transportation/25-38-NYC-Delivery-Worker-Data-Collection-and-Research-Report.pdf)
- [Whizz sitemap.xml](https://www.getwhizz.com/sitemap.xml) · [Whizz /es/rent-to-own](https://www.getwhizz.com/es/rent-to-own) · [Whizz /es/ blog — costo alquiler NYC](https://www.getwhizz.com/es/blog/how-to-choose/cost-to-rent-e-bike-delivery-nyc)
- [Zoomo HungryPanda Chinese LP](https://www.ridezoomo.com/us/zh-cn-hungry-panda) · [Zoomo US home](https://www.ridezoomo.com/us/home)
- [Documented — 在纽约租电动自行车前需要了解的租赁合同事项](https://documentedny.com/2025/09/19/chinese-language-ebike-rental-contract-tips/) · [Documented — 纽约市推出外卖员免费置换电动自行车计划](https://documentedny.com/2025/02/06/chinese-language-ebike-trade-safety/) · [Documented WeChat account launch](https://documentedny.com/2023/12/04/documented-wechat-official-account/)
- [CJR — WeChatting American Politics](https://www.cjr.org/tow_center_reports/wechatting-american-politics-misinformation-polarization-and-immigrant-chinese-media.php)
- [THE CITY — NYC Food Delivery Workers Face Paltry Pay and High Risks](https://www.thecity.nyc/2021/09/13/nyc-food-delivery-workers-pay-risk/) · [Los Deliveristas Unidos](https://www.facebook.com/LosDeliveristasUnidos/)
- [NYC DOT — Delivery by Bike or E-Bike](https://www.nyc.gov/html/dot/html/about/deliverybybike.shtml) · [NYC E-Bike Trade-In Program](https://ebike-trade.nyc.gov/)
- [Kueski Pay / Evobike (Mexico — buró de crédito context)](https://www.kueskipay.com/para-ti/tiendas/evobike)