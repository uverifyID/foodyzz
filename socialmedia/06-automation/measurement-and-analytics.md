# Measurement & Analytics — Day-One Setup

> **Nothing is installed.** An exhaustive search of `website/`, `public/` and the app for `gtag(`, `googletagmanager`, `UA-`, `GTM-`, `fbq(`, `connect.facebook.net`, `ttq.`, hotjar, clarity, plausible, segment, mixpanel and posthog returns **zero matches.**
>
> No GA4. No Meta Pixel. No TikTok Pixel. No Search Console verification. No conversion tracking on the two app-store badge clicks or the contact form. `website/js/main.js` is 22 lines — a nav toggle and a footer year.
>
> **This is the most urgent fixable gap in the entire plan.** Every day without it is a day of launch traffic that can never be retargeted and never be attributed.

---

## Install today (Aug 6)

### 1. Google Analytics 4

Create the property, then add to the `<head>` of **every** page in `website/` — `index`, `contact`, `privacy`, `terms`, `404`, and the blog template once it exists.

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

Consider Google Tag Manager instead if you'd rather not edit five HTML files every time a tag changes. For a site this small, direct tags are fine and faster.

### 2. Meta Pixel

Create in Business Manager, **verify the foodyzz.com domain** (required for iOS 14.5+ event attribution), install the base code on every page.

### 3. TikTok Pixel

Create in TikTok Ads Manager, verify the domain, install.

### 4. Google Search Console + Bing Webmaster Tools

Verify via DNS or the HTML meta tag. Submit `sitemap.xml`. **There is currently no verification tag on the site at all**, which means no visibility into how Google sees it.

---

## Events to define

Same event names across GA4, Meta and TikTok so the funnel reconciles.

| Event | Fires when | Where |
|---|---|---|
| `page_view` | Automatic | Site |
| `view_plans` | `/plans` loads | Site |
| `view_pricing_table` | Price table scrolled into view | Site |
| `click_app_store` | Apple badge clicked | Site — **currently untracked** |
| `click_play_store` | Google badge clicked | Site — **currently untracked** |
| `contact_submit` | Contact form succeeds | Site — **currently untracked** |
| `blog_read` | 50% scroll on a blog post | Blog |
| `app_install` | Install attributed | Store consoles |
| `sign_up` | Phone verification completes | App |
| **`docs_uploaded`** | **ID documents submitted** | **App — the funnel's throat** |
| `order_created` | Card authorised | App |
| **`purchase`** | **Charged at delivery** | **App — the only revenue event** |

### The two that matter most

**`docs_uploaded`** — a rider must photograph a driver licence and a proof of address before a bike ships. For a workforce that is ~80% immigrant, this is the highest-anxiety moment in the flow. **If drop-off between `sign_up` and `docs_uploaded` is above ~40%, that is the single most valuable thing to fix in the product**, and it will be worth more than any amount of ad optimisation.

**`purchase`** — nothing else is revenue. Installs, signups and followers are diagnostics.

---

## UTM discipline

Without this, every channel shows up as "direct" and the whole exercise is decorative.

```
?utm_source=instagram&utm_medium=social&utm_campaign=launch-aug26&utm_content=c08-receipt
```

| Parameter | Values |
|---|---|
| `utm_source` | `instagram` · `tiktok` · `facebook` · `google` · `field` · `creator` |
| `utm_medium` | `social` · `cpc` · `qr` · `referral` · `email` |
| `utm_campaign` | `launch-aug26` · `rent-to-buy` · `rules-content` |
| `utm_content` | The asset ID — `c08`, `t02`, `hub-flyer` |

**Field QR codes get their own tagged URLs per location** — `foodyzz.com/r/hub`, `/r/uws`, `/r/harlem`. That is how you learn which street corners work, and it's the difference between field sales and wandering around.

**Tag the app-store links too**, so installs attribute back to a channel.

---

## The dashboard

One weekly view. If it takes more than five minutes to read, nobody will read it.

**Acquisition**

| Metric | Source |
|---|---|
| Sessions by channel | GA4 |
| App installs by source | Store consoles + UTM |
| Cost per install | Ad platforms |

**Funnel**

| Step | Watch for |
|---|---|
| Session → app-store click | Landing page quality |
| Click → install | Store listing quality |
| Install → signup | Onboarding friction |
| **Signup → docs uploaded** | **The throat. Watch this weekly.** |
| Docs → order | Pricing objection |
| Order → delivered | Operations |

**Revenue**

Paid orders, split by plan · revenue by plan · **rent-to-buy completion rate** · deposit refund rate · average rental term length.

**Rent-to-buy completion rate is the number that decides whether the business model works.** A customer is worth $911.76 over twelve months only if they finish. Track it from the first cohort — the dunning path (retry at 24h, `past_due` after two failures) means the data will exist in `settlements/`.

**Social**

Followers, reach, saves and shares (worth more than likes here), comment volume, DM volume, link clicks.

---

## Weekly review, 30 minutes

1. Did paid orders go up? Everything else is context.
2. Where is the funnel leaking worst this week?
3. Which content produced link clicks? Which produced comments? They're rarely the same, and both matter.
4. Which field location produced QR scans that became orders?
5. What did riders ask that we don't have an answer for? **That question becomes next week's content.**

---

## Privacy

- Add a cookie/analytics notice consistent with the existing privacy policy (last updated July 24, 2026). Check whether the current policy already covers analytics — **if it doesn't, update it before installing the pixels, not after.**
- Meta and TikTok pixels are third-party tracking and should be disclosed.
- The customer base is heavily immigrant. **Never build custom audiences on immigration status, nationality, or any proxy for either.** Beyond being against platform policy, it would be a profound breach of trust with the exact people this business serves.
- Do not upload customer phone numbers or documents to any ad platform for audience matching.

---

## What we will not be able to measure at first

Say this out loud so nobody builds a plan on numbers that don't exist:

- **Attribution from field work to install** beyond the QR scan. Riders scan on the street and install later on wifi, which breaks the chain.
- **Word of mouth**, which in a referral market like this is likely to be a large share of everything.
- **iOS install attribution**, which is limited by ATT regardless of setup.
- **Anything before the pixels go live.** Which is why they go live today.
