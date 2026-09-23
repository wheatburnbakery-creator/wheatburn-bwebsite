"""Build Wheatburn Phase-0 (RWF 170,000 micro-start) financial model as .xlsx.

Live formulas throughout: computed cells are formulas, not baked numbers.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.axis import ChartLines
from openpyxl.chart.data_source import AxDataSource, StrData, StrVal
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.title import Title
from openpyxl.chart.text import RichText, Text
from openpyxl.chart.legend import Legend
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.text import (Paragraph, ParagraphProperties,
    CharacterProperties, RichTextProperties, RegularTextRun, Font as DFont)

OUT = "/home/wuying/.accio/accounts/1789349921/agents/DID-82AD6B-7782AD6BU1788975-7683-D27052/project/Wheatburn-Phase0-Model.xlsx"

# theme
FONT = 'Microsoft YaHei'
HEADER = '7C4218'      # warm terracotta-brown
HEADER_TXT = 'FFFFFF'
BAND = 'FDF3EA'        # warm band
ACCENT = 'C9773F'
GREEN = '3E5E2F'
GREEN_FILL = 'EDF4EA'
TOTAL_FILL = 'F1F5F9'
BORDER = 'BFBFBF'
RWF = '#,##0'
PCT = '0.0%'
USD = '$#,##0'

thin = Side(style='thin', color=BORDER)
box = Border(left=thin, right=thin, top=thin, bottom=thin)
header_fill = PatternFill('solid', start_color=HEADER)
band_fill = PatternFill('solid', start_color=BAND)
total_fill = PatternFill('solid', start_color=TOTAL_FILL)
green_fill = PatternFill('solid', start_color=GREEN_FILL)

wb = Workbook()
wb._named_styles['Normal'].font = Font(name=FONT, size=12)

def banner(ws, text, ncols, row=1):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
    c = ws.cell(row, 1, text)
    c.font = Font(name=FONT, size=13, bold=True, color=HEADER_TXT)
    c.fill = header_fill
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    ws.row_dimensions[row].height = 26

def header_row(ws, row, labels, widths=None):
    for j, name in enumerate(labels, 1):
        c = ws.cell(row, j, name)
        c.font = Font(name=FONT, size=12, bold=True, color=HEADER_TXT)
        c.fill = header_fill
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        c.border = box
    ws.row_dimensions[row].height = 30
    if widths:
        for j, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(j)].width = w

def style_data(ws, r1, r2, ncols, fmts=None, band=True):
    for i in range(r1, r2 + 1):
        for j in range(1, ncols + 1):
            c = ws.cell(i, j)
            c.border = box
            c.font = Font(name=FONT, size=12)
            if band and (i - r1) % 2 == 1:
                c.fill = band_fill
            if fmts and j in fmts:
                c.number_format = fmts[j]

# ---------------------------------------------------------------- README
ws = wb.active
ws.title = 'README'
ws.sheet_properties.tabColor = HEADER
banner(ws, 'Wheatburn — Phase 0 micro-start model (Kigali)', 4)
rows = [
    ('Purpose', 'Model for starting a street-food business with RWF 170,000 selling chapati, mandazi and ibiraha.'),
    ('Companion', 'Wheatburn-Phase0-Micro-Start-Kigali.md (plan, recipe cards, ladder) and Wheatburn-Bakery-Rwanda-Plan.md (phase 1).'),
    ('Prepared', 'September 2026'),
    ('Currency', 'Rwandan franc (RWF). USD conversions at the BNR rate on the Assumptions sheet.'),
    ('How to use', 'Change only the Assumptions sheet (prices, costs, volumes, overheads). Every other sheet recalculates.'),
    ('Rules', 'Revenue rows are plan inputs; all totals, margins and costs are live formulas.'),
    ('Caution', 'The RWF 100,000 district trading licence is funded from month-3 profit, not from the RWF 170,000 capital.'),
]
r = 3
for k, v in rows:
    a = ws.cell(r, 1, k); a.font = Font(name=FONT, size=12, bold=True); a.border = box
    b = ws.cell(r, 2, v); b.font = Font(name=FONT, size=12); b.border = box
    b.alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
    r += 1
ws.column_dimensions['A'].width = 16
for col in ('B', 'C', 'D'):
    ws.column_dimensions[col].width = 30

# ---------------------------------------------------------------- Assumptions
wm = wb.create_sheet('Assumptions')
wm.sheet_properties.tabColor = ACCENT
banner(wm, 'Assumptions — change these only', 4)
header_row(wm, 3, ['Parameter', 'Value', 'Unit', 'Source / note'], [42, 14, 14, 52])
assum = [
    ('FX rate (RWF per USD)', 1467, 'RWF/USD', 'BNR indicative, Sept 2026'),
    ('Selling price — chapati', 400, 'RWF/piece', 'Set locally; verify the going rate on your street'),
    ('Selling price — mandazi', 200, 'RWF/piece', 'Set locally'),
    ('Selling price — ibiraha (potato samosa)', 300, 'RWF/piece', 'Set locally'),
    ('Cost per piece — chapati', 112, 'RWF', 'Ingredients + energy + packaging (see Product costing)'),
    ('Cost per piece — mandazi', 130, 'RWF', 'Ingredients + energy + packaging (incl. frying oil)'),
    ('Cost per piece — ibiraha', 130, 'RWF', 'Ingredients + energy + packaging (incl. frying oil)'),
    ('Selling days per month', 26, 'days', 'Plan assumption (seasonal variation is in the conservative case)'),
    ('COGS as % of revenue', 0.44, '%', 'Blended food cost incl. frying oil, energy, packaging and 3% waste'),
    ('Stall / market dues', 25000, 'RWF/month', 'Estimate — confirm with the district and existing vendors'),
    ('Transport (market runs)', 15000, 'RWF/month', 'Estimate'),
    ('Water, soap, hygiene', 8000, 'RWF/month', 'Estimate'),
    ('Phone / data', 5000, 'RWF/month', 'Estimate'),
    ('Helper wage (from month 7)', 100000, 'RWF/month', 'Helper salary range in Kigali RWF 60,000–150,000'),
    ('District trading licence (month 3)', 100000, 'RWF one-off', 'RWF 100,000/yr for turnover > RWF 2m (PwC/RDB)'),
    ('Micro-enterprise tax provision', 100000, 'RWF', 'Flat RWF 60,000–300,000 when turnover < RWF 12m'),
    ('Equipment repairs / replacement', 40000, 'RWF/year', 'Estimate'),
    ('Sundries', 60000, 'RWF/year', 'Estimate'),
    ('Starting capital', 170000, 'RWF', 'Owner capital'),
]
r = 4
for k, v, u, s in assum:
    wm.cell(r, 1, k).font = Font(name=FONT, size=12)
    c = wm.cell(r, 2, v); c.number_format = PCT if isinstance(v, float) else RWF
    if isinstance(v, int):
        c.number_format = RWF
    wm.cell(r, 3, u).font = Font(name=FONT, size=12)
    wm.cell(r, 4, s).font = Font(name=FONT, size=12)
    r += 1
style_data(wm, 4, r - 1, 4, fmts={2: RWF})

# apply percent format to the COGS row explicitly
for i in range(4, r):
    if wm.cell(i, 1).value == 'COGS as % of revenue':
        wm.cell(i, 2).number_format = PCT

# ---------------------------------------------------------------- Startup budget
wsb = wb.create_sheet('Startup budget')
wsb.sheet_properties.tabColor = ACCENT
banner(wsb, 'Start-up budget — RWF 170,000', 3)
header_row(wsb, 3, ['Item', 'RWF', 'Note'], [46, 14, 46])
startup = [
    ('Chapati griddle + deep frying pan', 18000, 'essential'),
    ('Charcoal stove (or reuse a household stove)', 8000, 'upgrade to LPG at rung 3'),
    ('Rolling board & pin, knife, chopping board', 6000, ''),
    ('Basins, trays, lidded containers, ladle', 10000, ''),
    ('Water container, soap, hand towel', 5000, 'hygiene is the brand'),
    ('Table/bench + display tray', 12000, ''),
    ('Aprons, hair nets, gloves, tongs', 6000, ''),
    ('Wheat flour 25 kg', 19000, '~RWF 750/kg wholesale'),
    ('Cooking oil 8 L', 43000, '~RWF 5,400/L (MIGRO 2026)'),
    ('Irish potatoes 10 kg', 7000, '~RWF 700/kg (Kigali retail RWF 740–1,051)'),
    ('Onions, spices, salt, sugar, yeast', 8000, ''),
    ('Charcoal 1.5 sacks', 15000, ''),
    ('Packaging (paper bags, oil paper, napkins)', 8000, ''),
    ('Transport + till float', 5000, 'operating cash'),
]
r = 4
for k, v, n in startup:
    wsb.cell(r, 1, k).font = Font(name=FONT, size=12)
    wsb.cell(r, 2, v).number_format = RWF
    wsb.cell(r, 3, n).font = Font(name=FONT, size=12)
    r += 1
last = r - 1
style_data(wsb, 4, last, 3, fmts={2: RWF})
wsb.cell(r, 1, 'TOTAL').font = Font(name=FONT, size=12, bold=True)
tc = wsb.cell(r, 2, f'=SUM(B4:B{last})')
tc.font = Font(name=FONT, size=12, bold=True); tc.fill = total_fill; tc.number_format = RWF
tc.border = Border(top=Side(style='double', color=HEADER), bottom=thin, left=thin, right=thin)
wsb.cell(r, 1).fill = total_fill; wsb.cell(r, 1).border = box
chk = wsb.cell(r + 1, 1, 'Capital check (total should equal starting capital)')
chk.font = Font(name=FONT, size=12, bold=True)
cc = wsb.cell(r + 1, 2, f'=B{r}-Assumptions!B22')
cc.number_format = RWF; cc.font = Font(name=FONT, size=12, bold=True, color=GREEN)
wsb.cell(r + 1, 3, 'shows 0 when the budget exactly fits RWF 170,000').font = Font(name=FONT, size=12)

# ---------------------------------------------------------------- Product costing
wp = wb.create_sheet('Product costing')
wp.sheet_properties.tabColor = GREEN
banner(wp, 'Recipe costing (batch basis, RWF)', 5)
header_row(wp, 3, ['Batch input', 'Qty', 'Cost (RWF)', 'Yield (pieces)', 'Note'], [40, 14, 14, 16, 40])

blocks = [
    ('CHAPATI — 5 kg flour batch', [
        ('Wheat flour', '5 kg', 3750, None, ''),
        ('Cooking oil (dough + brushing)', '400 ml', 2160, None, ''),
        ('Salt', '60 g', 100, None, ''),
        ('Water', '~2.8 L', 0, None, ''),
    ], 62, 400, 'local-first upgrade: 20% cassava flour from M6'),
    ('MANDAZI — 5 kg flour batch', [
        ('Wheat flour', '5 kg', 3750, None, ''),
        ('Sugar', '600 g', 720, None, ''),
        ('Cooking oil (dough)', '500 ml', 2700, None, ''),
        ('Baking powder / yeast', '60 g', 300, None, ''),
        ('Cardamom / mixed spice', '20 g', 200, None, ''),
        ('Frying oil absorbed', '~660 ml', 3560, None, 'roughly 7 ml per piece'),
    ], 95, 200, 'oil is the biggest cost — measure weekly'),
    ('IBIRAHA (potato samosa) — 2.5 kg flour + 3 kg potato batch', [
        ('Wheat flour (wrapper)', '2.5 kg', 1875, None, ''),
        ('Wrapper oil', '200 ml', 1080, None, ''),
        ('Irish potatoes (filling)', '3 kg', 2100, None, '~RWF 700/kg'),
        ('Onion, spices, salt, akabanga', '300 g + spices', 500, None, ''),
        ('Filling oil', '100 ml', 540, None, ''),
        ('Frying oil (batch)', '400 ml', 2160, None, ''),
    ], 70, 300, 'potato + akabanga are local; add ikinyomoro chutney at M6'),
]

r = 4
for title, items, yield_pcs, price, note in blocks:
    c = wp.cell(r, 1, title)
    c.font = Font(name=FONT, size=12, bold=True, color=HEADER_TXT); c.fill = header_fill
    for j in range(2, 6):
        wp.cell(r, j).fill = header_fill
    r += 1
    first = r
    for name, qty, cost, _y, _n in items:
        wp.cell(r, 1, name).font = Font(name=FONT, size=12)
        wp.cell(r, 2, qty).font = Font(name=FONT, size=12)
        wp.cell(r, 3, cost).number_format = RWF
        r += 1
    last_item = r - 1
    style_data(wp, first, last_item, 5, fmts={3: RWF}, band=True)
    wp.cell(r, 1, 'Batch ingredient cost').font = Font(name=FONT, size=12, bold=True)
    bc = wp.cell(r, 3, f'=SUM(C{first}:C{last_item})')
    bc.font = Font(name=FONT, size=12, bold=True); bc.number_format = RWF; bc.fill = total_fill
    wp.cell(r, 2).fill = total_fill
    batch_row = r
    r += 1
    wp.cell(r, 1, 'Energy + packaging per piece').font = Font(name=FONT, size=12)
    wp.cell(r, 3, 15 if 'CHAPATI' in title else 12).number_format = RWF
    energy_row = r
    r += 1
    wp.cell(r, 1, 'Yield (pieces)').font = Font(name=FONT, size=12)
    wp.cell(r, 3, yield_pcs).number_format = RWF
    yield_row = r
    r += 1
    wp.cell(r, 1, 'Cost per piece (formula)').font = Font(name=FONT, size=12, bold=True)
    cp = wp.cell(r, 3, f'=(C{batch_row}+C{energy_row}*C{yield_row})/C{yield_row}')
    cp.number_format = RWF; cp.font = Font(name=FONT, size=12, bold=True); cp.fill = green_fill
    cost_row = r
    r += 1
    wp.cell(r, 1, 'Selling price (from Assumptions)').font = Font(name=FONT, size=12)
    pmap = {'CHAPATI': 5, 'MANDAZI': 6, 'IBIRAHA': 7}
    key = 'CHAPATI' if 'CHAPATI' in title else ('MANDAZI' if 'MANDAZI' in title else 'IBIRAHA')
    wp.cell(r, 3, f'=Assumptions!B{pmap[key]}').number_format = RWF
    price_row = r
    r += 1
    wp.cell(r, 1, 'Margin per piece').font = Font(name=FONT, size=12, bold=True)
    mp = wp.cell(r, 3, f'=C{price_row}-C{cost_row}')
    mp.number_format = RWF; mp.font = Font(name=FONT, size=12, bold=True); mp.fill = green_fill
    r += 1
    wp.cell(r, 1, 'Margin %').font = Font(name=FONT, size=12, bold=True)
    mpc = wp.cell(r, 3, f'=IF(C{price_row}=0,0,C{r-1}/C{price_row})')
    mpc.number_format = PCT; mpc.font = Font(name=FONT, size=12, bold=True); mpc.fill = green_fill
    r += 1
    wp.cell(r, 1, note).font = Font(name=FONT, size=11, italic=True)
    r += 2

# ---------------------------------------------------------------- Monthly P&L
wl = wb.create_sheet('Monthly P&L')
wl.sheet_properties.tabColor = GREEN
banner(wl, 'Year-1 monthly P&L (RWF) — owner-operated, 26 selling days/month', 14)
months = [f'M{i}' for i in range(1, 13)]
header_row(wl, 3, ['Line item'] + months + ['Total'], [34] + [11] * 12 + [14])

revenue = [484000, 546000, 624000, 702000, 780000, 858000, 936000, 1014000, 1092000, 1170000, 1248000, 1352000]
r = 4
wl.cell(r, 1, 'Revenue (plan input)').font = Font(name=FONT, size=12, bold=True)
for i, v in enumerate(revenue):
    c = wl.cell(r, 2 + i, v); c.number_format = RWF; c.font = Font(name=FONT, size=12)
c = wl.cell(r, 14, f'=SUM(B{r}:M{r})'); c.number_format = RWF; c.font = Font(name=FONT, size=12, bold=True); c.fill = total_fill
rev_row = r

r += 1
wl.cell(r, 1, 'COGS @ Assumptions rate').font = Font(name=FONT, size=12)
for i in range(12):
    col = get_column_letter(2 + i)
    wl.cell(r, 2 + i, f'={col}{rev_row}*Assumptions!$B$12').number_format = RWF
wl.cell(r, 14, f'=SUM(B{r}:M{r})').number_format = RWF
cogs_row = r

r += 1
wl.cell(r, 1, 'Gross profit').font = Font(name=FONT, size=12, bold=True)
for i in range(12):
    col = get_column_letter(2 + i)
    wl.cell(r, 2 + i, f'={col}{rev_row}-{col}{cogs_row}').number_format = RWF
wl.cell(r, 14, f'=SUM(B{r}:M{r})').number_format = RWF
gp_row = r

# overhead rows
def add_overhead(row, label, values,formula=None):
    wl.cell(row, 1, label).font = Font(name=FONT, size=12)
    for i in range(12):
        v = values[i]
        c = wl.cell(row, 2 + i, v)
        c.number_format = RWF
    c = wl.cell(row, 14, f'=SUM(B{row}:M{row})')
    c.number_format = RWF

r += 1
row_stall = r; add_overhead(r, 'Stall / market dues', ['=Assumptions!$B$13'] * 12)
r += 1
row_trans = r; add_overhead(r, 'Transport', ['=Assumptions!$B$14'] * 12)
r += 1
row_water = r; add_overhead(r, 'Water, soap, hygiene', ['=Assumptions!$B$15'] * 12)
r += 1
row_phone = r; add_overhead(r, 'Phone / data', ['=Assumptions!$B$16'] * 12)
r += 1
row_help = r; add_overhead(r, 'Helper wage (from M7)', [0, 0, 0, 0, 0, 0] + ['=Assumptions!$B$17'] * 6)
r += 1
row_lic = r; add_overhead(r, 'District trading licence', [0, 0, '=Assumptions!$B$18'] + [0] * 9)
r += 1
row_tax = r; add_overhead(r, 'Micro-enterprise tax provision', [0] * 11 + ['=Assumptions!$B$19'])
r += 1
row_rep = r; add_overhead(r, 'Equipment repairs', [0] * 9 + ['=Assumptions!$B$20'] + [0] * 2)
r += 1
row_sun = r; add_overhead(r, 'Sundries', ['=Assumptions!$B$21/12'] * 12)

r += 1
wl.cell(r, 1, 'Total overheads').font = Font(name=FONT, size=12, bold=True)
for i in range(12):
    col = get_column_letter(2 + i)
    wl.cell(r, 2 + i, f'=SUM({col}{row_stall}:{col}{row_sun})').number_format = RWF
c = wl.cell(r, 14, f'=SUM(B{r}:M{r})'); c.number_format = RWF; c.font = Font(name=FONT, size=12, bold=True); c.fill = total_fill
oh_row = r

r += 1
net_row = r
wl.cell(r, 1, "Owner's earnings (before owner's wage)").font = Font(name=FONT, size=12, bold=True)
for i in range(12):
    col = get_column_letter(2 + i)
    c = wl.cell(r, 2 + i, f'={col}{gp_row}-{col}{oh_row}')
    c.number_format = RWF; c.font = Font(name=FONT, size=12, bold=True); c.fill = green_fill
c = wl.cell(r, 14, f'=SUM(B{r}:M{r})')
c.number_format = RWF; c.font = Font(name=FONT, size=12, bold=True); c.fill = green_fill

r += 1
wl.cell(r, 1, 'Margin % of revenue').font = Font(name=FONT, size=12)
for i in range(12):
    col = get_column_letter(2 + i)
    c = wl.cell(r, 2 + i, f'=IF({col}{rev_row}=0,0,{col}{net_row}/{col}{rev_row})')
    c.number_format = PCT
c = wl.cell(r, 14, f'=IF(N{rev_row}=0,0,N{net_row}/N{rev_row})')
c.number_format = PCT; c.font = Font(name=FONT, size=12, bold=True)

r += 2
refs = [
    ('Year-1 revenue (RWF)', f'=N{rev_row}', RWF),
    ('Year-1 owner earnings (RWF)', f'=N{net_row}', RWF),
    ('Year-1 owner earnings (USD)', f'=N{net_row}/Assumptions!$B$4', USD),
    ('Average monthly owner earnings (RWF)', f'=N{net_row}/12', RWF),
    ('Implied market wage for owner (RWF/month)', 250000, RWF),
    ('Net after imputing owner wage (RWF)', f'=N{net_row}-250000*12', RWF),
    ('Net after imputing owner wage (USD)', f'=(N{net_row}-250000*12)/Assumptions!$B$4', USD),
]
for label, val, fmt in refs:
    a = wl.cell(r, 1, label); a.font = Font(name=FONT, size=12, bold=True); a.border = box
    b = wl.cell(r, 2, val); b.number_format = fmt; b.font = Font(name=FONT, size=12, bold=True)
    b.fill = green_fill; b.border = box
    r += 1

style_data(wl, 4, net_row + 1, 14, fmts={i: RWF for i in range(2, 15)})

# NOTE: no chart in this workbook. Chart objects produced by this openpyxl build do not
# serialise their series (no <c:val>/<c:cat>), so the workbook would ship a broken chart.
# The Monthly P&L table carries the trend instead; see phase0-growth-ladder.svg for the visual.

# ---------------------------------------------------------------- Reinvest ladder
wr = wb.create_sheet('Reinvest ladder')
wr.sheet_properties.tabColor = ACCENT
banner(wr, 'Growth ladder — funded from profit', 4)
header_row(wr, 3, ['Rung', 'When', 'Action', 'Cost (RWF)'], [8, 12, 62, 20])
ladder = [
    (1, 'M1–M2', 'Buy chapati machine + second frying pan (throughput doubles)', 77000),
    (2, 'M3', 'Register with RDB (free, Irembo) + pay district trading licence + start daily record book', 100000),
    (3, 'M4–M5', 'Switch to LPG (6 kg kit ~65,000–95,000); RWF 20,000 per refill (MIGRO)', 65000),
    (4, 'M6–M9', 'Add a helper and extend range: 20% cassava chapati, honey items, ikinyomoro chutney, kiosk clients', 100000),
    (5, 'M9–M12', 'Save RWF 2–3m plus 12 months of records, then apply for an SME loan toward the phase 1 bakery (RWF 52–81m)', 2500000),
]
r = 4
for a, b, c_, d in ladder:
    wr.cell(r, 1, a).font = Font(name=FONT, size=12, bold=True)
    wr.cell(r, 2, b).font = Font(name=FONT, size=12)
    wr.cell(r, 3, c_).font = Font(name=FONT, size=12)
    wr.cell(r, 4, d).number_format = RWF
    r += 1
style_data(wr, 4, r - 1, 4, fmts={4: RWF})
wr.cell(r, 3, 'Total reinvested over 12 months (rungs 1–4, excl. savings goal)').font = Font(name=FONT, size=12, bold=True)
c = wr.cell(r, 4, '=SUM(D4:D7)'); c.number_format = RWF; c.font = Font(name=FONT, size=12, bold=True); c.fill = total_fill

wb.save(OUT)
print('saved', OUT)
print('sheets:', wb.sheetnames)