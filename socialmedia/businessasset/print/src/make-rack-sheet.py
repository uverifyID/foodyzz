"""Impose the 4x6 rack card four-up on a US Letter sheet for home/office printing.

Four full-size 4x6 cards need 8x12 in, which does not fit on 8.5x11, so each card
is scaled to 87.5% (3.5 x 5.25 in trim) and the four are butted 2x2 with shared
cut lines -- two straight cuts across and two down. Bleed is dropped; crop marks
sit in the margins. Reads rack-4x6.html, so rebuild that first if prices change.

  python3 make-rack-sheet.py   ->  rack-4x6-sheet-letter.html
"""
import pathlib, re

SRC = pathlib.Path(__file__).with_name("rack-4x6.html").read_text()
OUT = pathlib.Path(__file__).with_name("rack-4x6-sheet-letter.html")

SCALE = 0.875                      # 4x6 trim -> 3.5 x 5.25 in
CW, CH = 4 * SCALE, 6 * SCALE
PW, PH = 8.5, 11
X0, Y0 = (PW - 2 * CW) / 2, (PH - 2 * CH) / 2   # 0.75 in sides, 0.25 in top/bottom

style = re.search(r"<style>(.*?)</style>", SRC, re.S).group(1)
style = style.replace("@page{size:4.25in 6.25in;margin:0}", "")
piece = re.search(r'(<div class="piece rack">.*</div></div>)</body>', SRC, re.S).group(1)

css = f"""
@page{{size:8.5in 11in;margin:0}}
html,body{{width:{PW}in;height:{PH}in}}
.sheet{{position:relative;width:{PW}in;height:{PH}in;overflow:hidden;background:#fff}}
/* each cell is the 4x6 trim; the 4.25x6.25 bleed page is shifted out and clipped */
.cell{{position:absolute;width:{CW}in;height:{CH}in;overflow:hidden}}
.cell .scaler{{width:4in;height:6in;transform:scale({SCALE});transform-origin:0 0;position:relative;overflow:hidden}}
.cell .piece{{position:absolute;left:-.125in;top:-.125in}}
/* the QR shrinks with the card: 0.66in x 0.875 would put modules at 0.51 mm, right
   on the phone-camera floor. Enlarge it in the source so it prints at ~0.66in again. */
.cell .qr,.cell .qr svg{{width:.76in;height:.76in}}
.mk{{position:absolute;background:#000}}
"""

cells = []
for r in range(2):
    for c in range(2):
        cells.append(f'<div class="cell" style="left:{X0 + c*CW}in;top:{Y0 + r*CH}in">'
                     f'<div class="scaler">{piece}</div></div>')

# crop marks, kept out of the artwork: 0.25pt hairlines, gap of 0.06in from trim
marks, T, G, L = [], "0.25pt", 0.06, 0.3
for x in (X0, X0 + CW, X0 + 2*CW):          # vertical cuts: ticks top and bottom
    marks.append(f'<div class="mk" style="left:calc({x}in - {T}/2);top:{Y0 - G - min(L, Y0 - G - .02)}in;width:{T};height:{min(L, Y0 - G - .02)}in"></div>')
    marks.append(f'<div class="mk" style="left:calc({x}in - {T}/2);top:{PH - Y0 + G}in;width:{T};height:{min(L, Y0 - G - .02)}in"></div>')
for y in (Y0, Y0 + CH, Y0 + 2*CH):          # horizontal cuts: ticks left and right
    marks.append(f'<div class="mk" style="top:calc({y}in - {T}/2);left:{X0 - G - L}in;height:{T};width:{L}in"></div>')
    marks.append(f'<div class="mk" style="top:calc({y}in - {T}/2);left:{PW - X0 + G}in;height:{T};width:{L}in"></div>')

html = (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<title>Foodyzz 4x6 card - 4-up letter</title><style>{style}{css}</style></head>'
        f'<body><div class="sheet">{"".join(cells)}{"".join(marks)}</div></body></html>')
OUT.write_text(html)
print(f"wrote {OUT.name}: 4 x ({CW} x {CH} in) at {SCALE:.1%}, margins {X0} / {Y0} in")
