import base64, pathlib
OUT = pathlib.Path("out"); OUT.mkdir(exist_ok=True)
def b64(p, m): return f"data:{m};base64," + base64.b64encode(pathlib.Path(p).read_bytes()).decode()

FACES=[("SG","sg-500",500),("SG","sg-700",700),("IN","inter-400",400),("IN","inter-600",600),
       ("IN","inter-700",700),("MO","mono-400",400),("MO","mono-700",700)]
FONTCSS="\n".join(f"@font-face{{font-family:{f};font-style:normal;font-weight:{w};font-display:block;"
  f"src:url({b64('fonts/'+n+'.woff2','font/woff2')}) format('woff2')}}" for f,n,w in FACES)

L1G=b64("build/logo1-green.png","image/png"); L2I=b64("build/logo2-ink.png","image/png")
L2G=b64("build/logo2-green.png","image/png"); L3=b64("build/logo3-render.jpg","image/jpeg")
QR=pathlib.Path("build/qr.svg").read_text()

BASE="""
*{margin:0;padding:0;box-sizing:border-box}
:root{--green:#86B54F;--green-mid:#658F32;--green-dark:#507425;--green-ink:#2B4011;
--green-tint:#EFF5E6;--ink:#0A0A0A;--paper:#FAFAF7;--stone:#F0EFEA;--stone-mid:#A8A29E;--stone-text:#57534E}
html,body{background:#fff}
body{-webkit-font-smoothing:antialiased;font-family:IN,sans-serif;color:var(--ink)}
img{display:block}
.piece{position:relative;overflow:hidden;background:var(--paper)}
.piece.card{width:3.75in;height:2.25in}
.piece.rack{width:4.25in;height:6.25in}
.bleed{position:absolute;inset:0}
/* foot band: colour bleeds off the trim, type centres inside the surviving strip */
.bandbg{position:absolute;left:0;right:0;bottom:0;height:.375in}
.bandtx{position:absolute;left:0;right:0;bottom:0;height:.25in;display:flex;align-items:center;justify-content:center}
.bandtx b{font-family:MO;font-weight:700;font-size:5.3pt;letter-spacing:.16em;text-transform:uppercase;white-space:nowrap}
.stage{position:absolute;left:.125in;right:.125in;top:0;bottom:.25in;
 display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:.06in}
.kick{font-family:MO;font-weight:700;font-size:5.1pt;letter-spacing:.19em;text-transform:uppercase;line-height:1;margin-top:.1in}
"""
def page(title, css, body, size):
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>'
            f'<style>{FONTCSS}{BASE}@page{{size:{size};margin:0}}{css}</style></head><body>{body}</body></html>')

BAND = "E&#8209;bikes for New York City delivery riders"

# ───────────────────────── card fronts ─────────────────────────
def front(n, field, bandbg, bandink, logo, lw, kickcol, blend=""):
    css = (f".bleed{{background:{field}}}.bandbg{{background:{bandbg}}}.bandtx b{{color:{bandink}}}"
           f".mark{{width:{lw}in;height:auto{blend}}}.kick{{color:{kickcol}}}")
    body = (f'<div class="piece card"><div class="bleed"></div><div class="bandbg"></div>'
            f'<div class="stage"><img class="mark" src="{logo}" alt="foodyzz">'
            f'<div class="kick">Rent &middot; Rent to Buy &middot; Own</div></div>'
            f'<div class="bandtx"><b>{BAND}</b></div></div>')
    return page(f"Foodyzz card front {n}", css, body, "3.75in 2.25in")

(OUT/"card-front-1-ink.html").write_text(front(1,"var(--ink)","var(--green)","var(--ink)",L1G,2.15,"var(--green)"))
(OUT/"card-front-2-green.html").write_text(front(2,"var(--green)","var(--ink)","var(--green)",L2I,2.30,"var(--ink)"))
(OUT/"card-front-3-paper.html").write_text(front(3,"var(--green-tint)","var(--green)","var(--ink)",L3,2.45,"var(--green-dark)",";mix-blend-mode:multiply"))
(OUT/"card-front-1-white.html").write_text(front("1w","#FFFFFF","var(--green)","var(--ink)",L1G,2.15,"var(--green-dark)"))
(OUT/"card-front-2-white.html").write_text(front("2w","#FFFFFF","var(--green)","var(--ink)",L2G,2.30,"var(--green-dark)"))

# ───────────────────────── shared back ─────────────────────────
back_css="""
.bleed{background:var(--paper)}.bandbg{background:var(--green)}.bandtx b{color:var(--ink)}
.inner{position:absolute;left:.25in;right:.25in;top:.125in;bottom:.25in;
 display:flex;align-items:center;justify-content:space-between;gap:.18in;padding-bottom:.03in}
.info .wm{width:1.32in;height:auto}
.rule{width:.34in;height:1.6pt;background:var(--green);margin:.105in 0 .1in}
.row{font-size:8.6pt;line-height:1.42;letter-spacing:-.004em}
.row.a{font-weight:600}
.row.b{color:var(--green-dark);font-weight:700}
.loc{font-family:MO;font-weight:400;font-size:5.3pt;letter-spacing:.14em;text-transform:uppercase;
 color:var(--stone-text);margin-top:.06in}
.qrwrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.09in}
.qr,.qr svg{width:.82in;height:.82in}
.chip{background:var(--green);color:var(--ink);font-family:MO;font-weight:700;font-size:4.8pt;
 letter-spacing:.14em;text-transform:uppercase;padding:.03in .05in .032in;border-radius:.03in;
 line-height:1;width:.82in;text-align:center}
"""
back_body=f"""<div class="piece card"><div class="bleed"></div><div class="bandbg"></div>
<div class="inner">
  <div class="info">
    <img class="wm" src="{L2G}" alt="foodyzz">
    <div class="rule"></div>
    <div class="row a">hello@foodyzz.com</div>
    <div class="row b">foodyzz.com</div>
    <div class="loc">New York, NY</div>
  </div>
  <div class="qrwrap"><div class="qr">{QR}</div><div class="chip">Get the app</div></div>
</div>
<div class="bandtx"><b>Certified to UL&nbsp;2849 by T&Uuml;V Rheinland</b></div></div>"""
(OUT/"card-back.html").write_text(page("Foodyzz card back", back_css, back_body, "3.75in 2.25in"))

# ───────────────────────── 4x6 rack card ─────────────────────────
rack_css="""
.bleed{background:var(--paper)}
.rhead{position:absolute;left:0;right:0;top:0;height:1.24in;background:#FFFFFF}
.rheadin{position:absolute;inset:.125in 0 .105in;display:flex;flex-direction:column;
 align-items:center;justify-content:center}
.rheadin img{width:1.75in;height:auto}
.rheadin .kick{color:var(--green-dark);margin-top:.07in;font-size:5pt}
.rrule{position:absolute;left:0;right:0;bottom:0;height:.045in;background:var(--green)}
.rbody{position:absolute;left:.30in;right:.30in;top:1.24in;bottom:.25in;
 display:flex;flex-direction:column;padding-top:.14in}
h1{font-family:SG;font-weight:700;font-size:14.6pt;line-height:1.06;letter-spacing:-.023em}
.sub{font-size:7.7pt;line-height:1.44;color:var(--stone-text);margin-top:.06in}
.tiers{margin-top:.10in;display:flex;flex-direction:column;gap:.055in}
.tier{border:1pt solid var(--ink);border-radius:.07in;padding:.048in .08in .056in;background:#fff}
.tier.hero{background:var(--green)}
.thead{display:flex;align-items:baseline;justify-content:space-between}
.tname{font-family:MO;font-weight:700;font-size:5.8pt;letter-spacing:.19em;text-transform:uppercase}
.tflag{font-family:MO;font-weight:700;font-size:4.7pt;letter-spacing:.13em;text-transform:uppercase;color:var(--stone-text)}
.hero .tflag{color:var(--green-ink)}
.tprice{display:flex;align-items:baseline;gap:.038in;margin-top:.022in}
.amt{font-family:SG;font-weight:700;font-size:16pt;line-height:1;letter-spacing:-.028em}
.per{font-family:IN;font-weight:600;font-size:7.5pt;color:var(--stone-text)}
.hero .per{color:var(--green-ink)}
.tnote{font-size:6.1pt;line-height:1.35;color:var(--stone-text);margin-top:.028in}
.hero .tnote{color:var(--green-ink)}
.tnote b{font-weight:700;color:var(--ink)}
.trust{font-family:MO;font-weight:700;font-size:4.9pt;letter-spacing:.11em;text-transform:uppercase;
 color:var(--green-dark);line-height:1.55;margin-top:.09in}
.foot{margin-top:auto;display:flex;align-items:center;gap:.13in;padding-top:.085in}
.qrwrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:.04in}
.qr,.qr svg{width:.66in;height:.66in}
.chip{background:var(--green);color:var(--ink);font-family:MO;font-weight:700;font-size:4pt;
 letter-spacing:.1em;text-transform:uppercase;padding:.023in .028in .025in;border-radius:.022in;
 line-height:1;width:.56in;text-align:center}
.fcontact{flex:1;min-width:0}
.fcta{font-family:SG;font-weight:700;font-size:8.2pt;line-height:1.16;letter-spacing:-.015em}
.frow{font-size:6.8pt;line-height:1.42;margin-top:.04in}
.frow .b{color:var(--green-dark);font-weight:700}
.fine{font-size:4.25pt;line-height:1.42;color:var(--stone-text);margin-top:.05in;text-align:left}
"""
# ── Pricing guard ────────────────────────────────────────────────────────────
# The 4x6 prints "Same as the cash price - 0% interest". That is only lawful
# while the twelve monthly payments land exactly on the cash price. The app
# recomputes and hides the claim by itself; a printed card cannot, so the claim
# is pinned to arithmetic here and the build fails rather than shipping a false
# price claim. Change a price -> change these three numbers, and if the assert
# fires, remove the 0% line from TIERS and FINE before forcing it through.
RENT_TO_BUY_BASE = 73.26
MAINTENANCE      = 9.99
BUY_PRICE        = 999.00
MONTHS           = 12

ALL_IN = round(RENT_TO_BUY_BASE + MAINTENANCE, 2)
TOTAL  = round(ALL_IN * MONTHS, 2)
if TOTAL != BUY_PRICE:
    raise SystemExit(
        f"REFUSING TO BUILD: rent-to-buy totals ${TOTAL:,.2f} over {MONTHS} months "
        f"against a ${BUY_PRICE:,.2f} cash price (difference ${TOTAL - BUY_PRICE:+,.2f}).\n"
        f"'0% interest' / 'same as the cash price' is now FALSE and must be removed "
        f"from TIERS and FINE before this card can be printed."
    )

TIERS = [
 ("Rent","from","$22.49","/week",
  "4&#8209;week minimum &middot; new or used bike &middot; +&nbsp;$9.99 maintenance per period",False),
 ("Rent to Buy","Own it in 12 months","$83.25","/month",
  "Everything in &mdash; $73.26 plan + $9.99 maintenance &times; 12 = <b>$999 total</b><br>"
  "<b>Same as the cash price &mdash; 0% interest</b>, no credit check",True),
 ("Buy","from","$999","one time",
  "Yours on day one &middot; no deposit, no fees, no ID check",False),
]
tiers_html = "".join(
 f'<div class="tier{" hero" if hero else ""}"><div class="thead"><span class="tname">{n}</span>'
 f'<span class="tflag">{flag}</span></div><div class="tprice"><span class="amt">{amt}</span>'
 f'<span class="per">{per}</span></div><div class="tnote">{note}</div></div>'
 for n,flag,amt,per,note,hero in TIERS)

FINE = ("Foodyzz Model&nbsp;X, subject to availability. <b>Rent:</b> 4&#8209;week minimum; $9.99 maintenance "
 "per rental period; $100 deposit charged at delivery and refunded on return, less documented damage. "
 "<b>Rent to Buy:</b> fixed 12&#8209;month term; 12 payments of $83.25 ($73.26 plus $9.99 maintenance) "
 "totalling $999.00 &mdash; exactly the $999.00 cash price, so there is no finance charge; no credit check; "
 "early payoff any time; ownership transfers at the final payment. <b>Buy:</b> no deposit, no fees. "
 "GPS tracker $5.99 per period, optional. Sales tax and card processing added at checkout. Helmet required "
 "on every ride and not supplied. Manhattan only; delivery 5&#8209;9&nbsp;PM, next day or later. Prices "
 "current at September&nbsp;2026. Full terms at foodyzz.com/terms.")

rack_body=f"""<div class="piece rack"><div class="bleed"></div>
<div class="rhead"><div class="rheadin"><img src="{L1G}" alt="foodyzz">
<div class="kick">Rent &middot; Rent to Buy &middot; Own</div></div><div class="rrule"></div></div>
<div class="rbody">
  <h1>Your delivery e&#8209;bike,<br>at your door.</h1>
  <p class="sub">Rent it by the week, own it in twelve months, or buy it today. No credit check,
  no store visit, free delivery in Manhattan.</p>
  <div class="tiers">{tiers_html}</div>
  <div class="trust">Certified to UL&nbsp;2849 by T&Uuml;V Rheinland &middot; Class&nbsp;2, motor assist to 15&nbsp;mph<br>
  Free delivery &middot; $100 deposit, refunded on return &middot; No commission</div>
  <div class="foot">
    <div class="qrwrap"><div class="qr">{QR}</div></div>
    <div class="fcontact">
      <div class="fcta">Scan to book a bike<br>in about five minutes.</div>
      <div class="frow">hello@foodyzz.com<br>
      <span class="b">foodyzz.com</span></div>
    </div>
  </div>
  <div class="fine">{FINE}</div>
</div></div>"""
(OUT/"rack-4x6.html").write_text(page("Foodyzz 4x6 card", rack_css, rack_body, "4.25in 6.25in"))
print("rack written")

print("cards + rack written")
