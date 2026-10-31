"""Test helper: draws a statement PDF in the Example Bank home loan layout from a JSON description (positions match the demo layout)."""
import json, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
d = json.load(open(sys.argv[1])); out = sys.argv[2]
W, H = A4
c = canvas.Canvas(out, pagesize=A4)
P = lambda x, y: (x / 100 * W, H - y / 100 * H)
def t(x, y, s, size=9, bold=False):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size); X, Y = P(x, y); c.drawString(X, Y - size, s)
def tr(x, y, s, size=9):
    c.setFont('Helvetica', size); X, Y = P(x, y); c.drawRightString(X, Y - size, s)
m = lambda n: '{:,.2f}'.format(n)
t(4, 4, d['lender'].upper(), 16, True); t(4, 9, d.get('title', 'HOME LOAN'), 12, True)
t(58, 13.5, 'Loan account ' + d['acct'], 9, True)
t(58, 19.5, 'Statement period', 8); t(58, 22, d['start'] + ' to ' + d['end'], 9, True)
t(4, 30, 'Account summary', 9, True)
for (x, y, label, val) in [(4, 37, 'Opening Balance', m(d['opening'])), (24, 37, 'Interest Charge for the Period', '$' + m(d['interest'])), (62, 37, 'Total Credits', m(d['credits'])), (80, 37, 'Closing Balance', m(d['closing'])), (4, 47, 'Payments in Advance', '$' + m(d.get('advance', 0))), (62, 47, 'Interest Offset Benefit', '$0.00'), (80, 47, 'Annual Percentage Rate', '%.3f%%' % d['rate'])]:
    t(x + 0.5, y, label, 7); t(x + 0.5, y + 3, val, 10, True)
t(4, 93, 'Page 1', 7)
c.showPage()
t(4, 5, 'Transactions', 11, True)
y = 12.5
for h, x in [('Date', 4.5), ('Description', 16.5)]: t(x, y, h, 8, True)
for h, x in [('Debit', 69.5), ('Credit', 82.5), ('Balance', 95.5)]: tr(x, y, h, 8)
y += 2.6
page = 2
for r in d['rows']:
    if y > 90:
        t(4, 94, 'Continued on next page', 7); c.showPage(); page += 1; y = 6
    t(4.5, y, r['date'], 8); t(16.5, y, r['desc'][:48], 8)
    if r['debit']: tr(69.5, y, m(r['debit']), 8)
    if r['credit']: tr(82.5, y, m(r['credit']), 8)
    if r['balance'] is not None: tr(95.5, y, m(r['balance']), 8)
    y += 2.6
c.save()
print('pages', page)
