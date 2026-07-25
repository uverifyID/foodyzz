# Foodyzz Marketing Site — Deploy Guide (Hostinger → foodyzz.com)

Static site, no build step. Everything in this folder is deploy-ready.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page (hero, features, how-it-works, plans, NYC, FAQ, app CTA) |
| `contact.html` | Contact form → `contactForm` Cloud Function → email to admin |
| `privacy.html` | Privacy Policy (privacy@foodyzz.com) |
| `terms.html` | Terms & Conditions (legal@foodyzz.com) |
| `css/style.css` | Brand system (foodyzz green #86B54F, neubrutalist, Inter/Space Grotesk) |
| `js/main.js` | Nav toggle + footer year |
| `js/contact.js` | Contact form submit → Cloud Function endpoint |
| `.htaccess` | https + www→apex canonical, clean URLs (/privacy), caching, security headers |
| `assets/` | Wordmark, app icon, favicon |
| `robots.txt`, `sitemap.xml` | SEO basics |

## Deploy steps (Hostinger)

1. **Deploy the `contactForm` function first** (it's in `functions/src/index.ts`):
   ```bash
   cd functions && firebase deploy --only functions:contactForm
   ```
   Then confirm the URL matches what `js/contact.js` expects
   (`https://contactform-ja7ef4okna-uc.a.run.app`). `firebase functions:list`
   shows the real URL — if it differs, update `CONTACT_ENDPOINT` in `js/contact.js`.

2. **Upload the CONTENTS of this folder** to the foodyzz.com document root
   (`public_html/`). In Hostinger File Manager enable **"Show hidden files"**
   so `.htaccess` uploads too.

3. **SSL**: make sure the free SSL cert is active for foodyzz.com *and* www.foodyzz.com
   before visiting — `.htaccess` forces https.

4. **Test**:
   - https://foodyzz.com loads; www.foodyzz.com and http:// redirect to it
   - `/privacy`, `/terms`, `/contact` clean URLs resolve
   - Submit the contact form → admin email arrives (rajshrestha@gmail.com via
     `apiConfigSecret/smtp`), and a `contactMessages` doc appears in Firestore

## Contact form architecture

```
contact.html → js/contact.js → POST https://contactform-…run.app
                                  │  CORS: foodyzz.com only
                                  │  honeypot + validation + 5/hour/IP rate limit
                                  ├─ Firestore: contactMessages (audit, admin-only)
                                  └─ SMTP (apiConfigSecret/smtp) → admin email
```

No secrets exist anywhere in this folder — safe for any hosting.
