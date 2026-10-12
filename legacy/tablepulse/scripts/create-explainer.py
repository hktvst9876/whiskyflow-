from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, Flowable
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf' / 'TablePulse-product-and-backend-guide.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, file in [('Arial','arial.ttf'), ('Arial-Bold','arialbd.ttf'), ('Arial-Italic','ariali.ttf')]:
    pdfmetrics.registerFont(TTFont(name, f'C:/Windows/Fonts/{file}'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-Bold')
GREEN = colors.HexColor('#193F32')
LIME = colors.HexColor('#D8EAB2')
INK = colors.HexColor('#22362D')
MUTED = colors.HexColor('#65736A')
PALE = colors.HexColor('#F1F5ED')
COPPER = colors.HexColor('#A96B38')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyTP',fontName='Arial',fontSize=10.2,leading=14.2,textColor=INK,spaceAfter=6))
styles.add(ParagraphStyle(name='SmallTP',fontName='Arial',fontSize=8.4,leading=12,textColor=MUTED,spaceAfter=6))
styles.add(ParagraphStyle(name='TitleTP',fontName='Arial-Bold',fontSize=29,leading=34,textColor=GREEN,spaceAfter=16))
styles.add(ParagraphStyle(name='H1TP',fontName='Arial-Bold',fontSize=23,leading=28,textColor=GREEN,spaceAfter=15))
styles.add(ParagraphStyle(name='H2TP',fontName='Arial-Bold',fontSize=12.5,leading=17,textColor=GREEN,spaceBefore=7,spaceAfter=5))
styles.add(ParagraphStyle(name='CellTP',fontName='Arial',fontSize=9,leading=12.4,textColor=INK))
styles.add(ParagraphStyle(name='HeadCellTP',fontName='Arial-Bold',fontSize=9,leading=12,textColor=colors.white))
styles.add(ParagraphStyle(name='CalloutTP',fontName='Arial-Bold',fontSize=11,leading=16,textColor=GREEN))
story=[]
W=499
def p(t,sty='BodyTP'): return Paragraph(t,styles[sty])
def body(t): story.append(p(t))
def h(t): story.append(p(t,'H2TP'))
def note(t): story.append(p(t,'SmallTP'))
def gap(n=8): story.append(Spacer(1,n))
def bullet(t): story.append(p('• '+t))
def callout(t):
    box=Table([[p(t,'CalloutTP')]],colWidths=[W])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.5,LIME),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.extend([box,Spacer(1,12)])
def table(headers,rows,widths):
    data=[[p(x,'HeadCellTP') for x in headers]]+[[p(x,'CellTP') for x in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),0.5,GREEN)]))
    story.extend([t,Spacer(1,10)])
def page(n,title,strap):
    if story: story.append(PageBreak())
    story.append(p(f'{n:02d} / {strap.upper()}','SmallTP'))
    story.append(p(title,'H1TP'))
class StackDiagram(Flowable):
    def __init__(self,rows): self.rows=rows; self.width=W; self.height=len(rows)*52-10
    def draw(self):
        c=self.canv
        for i,(label,sub) in enumerate(self.rows):
            y=self.height-i*52-42
            c.setFillColor(GREEN if i==1 else PALE); c.roundRect(0,y,W,42,7,fill=1,stroke=0)
            c.setFillColor(colors.white if i==1 else GREEN); c.setFont('Arial-Bold',10.5); c.drawCentredString(W/2,y+25,label)
            c.setFont('Arial',8.5); c.drawCentredString(W/2,y+11,sub)
            if i<len(self.rows)-1:
                c.setStrokeColor(COPPER); c.setLineWidth(1.2); c.line(W/2,y-1,W/2,y-8)
                c.line(W/2,y-8,W/2-3,y-5); c.line(W/2,y-8,W/2+3,y-5)

page(1,'TablePulse','Product, backend and table devices')
story.append(p('Small table rewards.<br/>A measurable commercial purpose.','TitleTP'))
body('A practical guide for venue owners, managers and the team implementing the system. It explains what the MVP does, how its backend works, and how to connect a screen or LED device at each table.')
callout('The goal is additional profitable purchases after an organic order. A reward is occasional, capped and specific to the current table visit.')
img=ROOT/'test-results'/'tablepulse-overview.jpg'
if img.exists():
    story.append(Image(str(img),width=W,height=W*1039/1425))
gap(10)
note('Current implementation: Next.js + TypeScript, Supabase production repository, local demo storage, rules-based decisions and mock POS events. No payments. No live POS, Supabase project or physical hardware is connected.')
note('Prepared 7 October 2026 | Singapore demo: The Sunday Social | Implementation guide, not a hardware vendor specification')

page(2,'What the venue gains','Benefits and economics')
body('TablePulse gives staff a controlled way to suggest an extra snack, pairing or side at a relevant moment. It can reduce manual promotion decisions and makes the economics visible to managers. These are intended benefits; a pilot must establish whether actual profit increases.')
table(['Benefit','How it works'],[
('More profitable add-ons','Offer targets a purchase absent from the current basket, such as a snack after beer or a zero-alcohol pairing after mains.'),
('Less blanket discounting','The original qualifying order stays at its original price. Campaigns have margin floors, stock checks and daily allocation caps.'),
('More consistent staff decisions','The backend applies the same eligibility checks and records why a reward was shown or withheld.'),
('Clearer campaign performance','Managers see reward revenue, estimated gross profit, discount cost, conversion and comparisons with control tables.'),
('A private guest experience','The table screen shows an offer without displaying a customer name or purchase history.')],[133,366])
h('A worked example from the seeded menu')
body('A table orders two Tiger draughts organically. It may then receive Korean corn chips for S$3.90. The usual chips price is S$8.00 and seeded item cost is S$1.20.')
table(['Measure','Calculation'],[
('Reward purchase revenue','S$3.90'),('Estimated incremental gross profit','S$3.90 - S$1.20 = <b>S$2.70</b>'),('Gross margin on reward sale','S$2.70 / S$3.90 = <b>69.2%</b>'),('Discount against list price','S$8.00 - S$3.90 = <b>S$4.10</b>')],[220,279])
body('The demo minimum profit floor is S$2.50, so S$2.70 passes that check. Stock, caps, basket relevance, safety, score and random allocation still need to pass. Waiting does not create eligibility.')
callout('A profitable reward sale is not proof of causal lift. If the guest would have bought chips at S$8 anyway, the offer reduces gross profit on that purchase by S$4.10.')
note('The MVP estimates item-level gross profit. It does not model GST, service charges, labour, waste, hardware costs or full operating profit. Compare treatment and control tables before claiming uplift.')

page(3,'The guest and staff journey','Operations and safeguards')
table(['Step','What happens'],[
('1. Open the visit','Staff opens a table session. The display shows branding, menu highlights and optional rewards enrolment.'),
('2. Receive a normal order','The POS adapter or staff simulator submits an organic order for that session. The engine evaluates once for that new event.'),
('3. Decide whether to offer','Hard rules run first, then relevance, profit, inventory, frequency, priority and randomness contribute to the score.'),
('4. Show the reward','An eligible table sees exact items, prices, countdown and a six-character redemption code. No guest name is shown.'),
('5. Redeem through staff','Staff checks the current table and bill. The server rechecks eligibility, consumes stock and records the purchase.'),
('6. Close the visit','Closing the bill revokes the display session. The reward cannot move to the next party.')],[122,377])
h('The commercial controls')
bullet('At most one offer per table session, including after cancellation or expiry. No automatic replacement reward.')
bullet('At most one subsidised reward per identified customer in 30 days, and no repeat of the same promotion within 60 days.')
bullet('Current table and bill only. No stacking with existing discounts. Original qualifying items must remain on the bill.')
bullet('Only in-stock, promotion-eligible items above the configured profit and score floors. Daily allocation is real, including cancelled or expired allocations.')
bullet('Alcohol offers require verified adult eligibility and no intoxication flag. Staff can block, cancel or request a safe override; overrides retain hard safeguards.')
bullet('Every evaluated decision is logged. Staff redemption failures are audited and repeated failed attempts temporarily block redemption.')
h('Identification and consent are different')
body('In live mode a subsidised reward requires a verified, stable POS customer reference. Staff or the POS links it to the visit. The reference is pseudonymized with a server-side secret. Anonymous QR enrolment records consent; it does not prove identity or recognise someone on a later visit.')
note('Screenshots cannot be prevented physically. A screenshot or code alone is insufficient: redemption also requires authenticated staff, the original active session and server-side checks. Party-level V1 identifies one reward recipient, not every guest.')

page(4,'What runs in the backend','Application architecture')
story.append(StackDiagram([
('POS or staff order entry','Stable event ID + table session + menu items'),
('Next.js server and TypeScript rules engine','Validate request -> authenticate -> evaluate -> commit'),
('Supabase PostgreSQL','Orders, inventory, offers, redemptions, consent and audit history'),
('Manager / staff UI and public table display','Team Realtime + fallback polling | public token-verified polling')]))
gap(15)
table(['Component','Responsibility'],[
('Next.js on Node.js','Hosts the website and API routes. The backend runs on a hosted server; it does not need the developer laptop once deployed.'),
('TypeScript rules engine','Makes offer decisions in lib/engine.ts. No AI model is needed for scoring or redemption.'),
('Supabase PostgreSQL','Production relational database. SQL functions apply changes atomically. The application uses the Supabase SDK, without Prisma.'),
('Supabase Auth and Realtime','Team login plus authorised dashboard updates. Public displays do not get direct anonymous database access.'),
('Zod validation','Checks incoming payloads, quantities, IDs and configuration values before commands execute.'),
('n8n, if configured','Routes events or sends summaries and alerts. It does not own the database or decide offers.')],[154,345])
h('Current demo versus production')
body('The running demo persists changes in <b>.demo/state.json</b>, with a local queue and atomic file replacement. That is suitable for one demo process. Live deployments must use the Supabase repository with TABLEPULSE_DEMO=false and independently generated server secrets.')
note('V1 selects one venue per deployment. Platform admins can manage that venue; a multi-venue fleet UI and self-service staff invitations remain future work.')

page(5,'The database and trust boundaries','Data and security')
table(['Data group','Tables and purpose'],[
('Venue and team','venues, venue_users, tables, table_sessions: venue identity, team roles, physical table and current visit.'),
('Customer and consent','customers, customer_consents, customer_reward_history: pseudonymous customer, preferences, consent and reward caps.'),
('Sales and menu','orders, order_items, menu_items, menu_item_costs: organic bill lines, menu prices, item costs and derived margin.'),
('Campaigns and decisions','offers, offer_rules, offer_eligibility_logs, offer_instances: configuration, reasons, actual table-bound reward and expiry.'),
('Fulfilment and stock','offer_redemptions, inventory_availability: one-use redemption, purchase economics and remaining stock.'),
('Audit trail','audit_logs: staff changes, rejected redemptions and operational decisions.')],[128,371])
h('Consistency when requests arrive together')
body('Venue locks and revision checks coordinate writes. Unique constraints defend one open visit per table, one offer instance per visit, one redemption per offer and unique external event IDs. Database transactions commit all effects together or roll them back. Customer-level locks and history checks protect frequency caps.')
h('Who can access what')
body('Server commands authenticate the user and check venue membership and role on every mutation. PostgreSQL Row Level Security further restricts team reads. Customer profiles, consent and history are manager-only. Privileged writes use a server-only credential; it must never be placed on a table device. Supabase documents this boundary in [1].')
body('The public API verifies a signed, expiring table token and returns only branding, table label, menu highlights and reward details. Tokens expire at most 12 hours after visit start and become invalid when the session closes. Treat display URLs as bearer credentials and avoid recording them in public logs.')
callout('The device is a viewer. It does not decide prices, eligibility, inventory or redemption. The server remains authoritative even if the device displays an old frame.')
h('Scale boundary')
body('The MVP reconstructs a venue snapshot and commits its changes atomically. This simplifies consistency, but serializes writes within a venue. Larger deployments should benchmark it and evolve toward targeted transactions and queue-based integration retries.')

page(6,'Connecting a device at each table','Screens versus LED lights')
body('The phrase "mini LED" can describe several different products. An LCD tablet with an LED backlight can render a web page; an RGB lamp cannot. Integration depends on the exact controller, operating system and supported API.')
table(['Device','What guests see','Integration'],[
('7-10 inch tablet or browser-capable screen','Full offer, price, terms, countdown and QR/code.','Open the existing /display/[token] page in a locked-down browser. Best fit for a first pilot.'),
('Small HDMI screen with a computer','The same full TablePulse display.','A Raspberry Pi or mini PC runs a browser in kiosk mode. Raspberry Pi documents this approach [2].'),
('LED matrix / scrolling text sign','Short text and code; legibility and QR support depend on resolution.','Needs compatible player software, controller firmware or a vendor API. A generic LED panel does not run Next.js.'),
('RGB lamp or LED strip','A subtle status cue, such as reward available.','Needs a controller and gateway. Guests still need a screen, phone page or staff explanation for exact terms.')],[116,176,207])
h('Suggested first pilot: browser screens')
body('Use browser-capable screens on venue Wi-Fi with reliable power, secure mounts and a dedicated kiosk profile. Check viewing angle, brightness, QR readability, cleaning requirements and safe cable routing in the actual venue. This is a suggested architecture, not a certification of any untested model.')
h('If you mean decorative lights')
body('Add a lamp as a secondary cue. A controller compatible with WLED can accept JSON commands for light state, brightness and colour [3]. TablePulse would need a gateway that translates reward state into those commands; this integration is not implemented in the MVP.')
callout('A simple LED light cannot explain an offer or enforce redemption. Keep the exact price, expiry and restrictions on a readable screen or staff workflow.')
note('Hardware selection remains open: obtain the device model, screen size/resolution, power requirements, connectivity and controller API before buying a fleet. Prototype one physical unit first.')

page(7,'How the right table gets the right offer','Device sessions and agents')
h('A browser screen: the simplest connection')
body('Each physical device is associated with a table. When staff opens a new visit, the backend issues a fresh signed display URL for that visit. Staff opens that URL on the device. The existing screen polls /api/display every three seconds and renders the server-approved state.')
body('An active reward clears after expiry. Closing the bill invalidates the token; the current page then shows an end-of-visit message. It does not automatically attach itself to the next party. For an unattended installation, add secure device provisioning, table assignment and automatic session handover.')
table(['Meaning of "agent"','Do we need it?'],[
('AI agent / language model','<b>No.</b> V1 uses explicit business rules. An AI model is not needed to decide margins, caps or redemption.'),
('Backend web service','<b>Yes.</b> The deployed Next.js service handles requests and rules; Supabase stores data and provides Auth/Realtime.'),
('Device kiosk / management software','<b>Useful.</b> Keeps the browser full-screen, starts it after reboot and supports device updates. It does not decide rewards.'),
('Local hardware gateway','<b>Only for certain hardware.</b> Needed when a cloud server cannot directly control a lamp, matrix sign or local POS.'),
('Background worker / n8n','<b>Optional.</b> Useful for retry queues, device monitoring, scheduled summaries or alerts.')],[167,332])
h('Proposed lamp or matrix architecture - future work')
story.append(StackDiagram([
('TablePulse server','Authoritative reward state + table identity + expiry'),
('Authenticated device service or venue gateway','Outbound HTTPS or MQTT connection; map table to controller'),
('Local LED controller / display player','Translate safe display state into light command or rendered text')]))
gap(12)
note('MQTT is a publish/subscribe transport; ESP-MQTT supports it and documents TLS examples [4]. It is an optional transport design, not part of the current TablePulse backend. Do not expose local LED controllers through public router ports.')

page(8,'Device reliability and security','Practical hardware operation')
body('The production device layer should handle device identity separately from customer identity. One table can have many visits; the device persists, while each visit token is short-lived.')
table(['Situation','Required behaviour'],[
('New party at the same table','Provisioning layer obtains a fresh token for the new visit. Never reuse the old party\'s URL.'),
('Offer is redeemed or cancelled','Device returns to neutral content; an optional lamp clears its reward signal.'),
('Network or server unavailable','Show neutral/help content and stop promoting stale offers. No offline redemption.'),
('Reboot or power loss','Kiosk starts automatically and retrieves current state rather than restoring a stale reward.'),
('Device moved to another table','Authorised staff reassigns it. Audit the change; do not trust a table number entered by a guest.'),
('Device lost or compromised','Revoke device access and current tokens; rotate only affected credentials where possible.')],[156,343])
h('What the current browser screen already does')
body('It polls every three seconds, refreshes its countdown every second, and clears offer data when the API reports a closed or invalid session. After repeated network failures lasting more than 15 seconds, it clears the stale content and shows a connection message. Staff redemption still checks server state regardless of the screen.')
h('What to add for a managed fleet')
bullet('A device registry with table assignment, revocation, heartbeat and last-seen health. These are proposed extensions, not existing database tables.')
bullet('Per-device credentials and narrow permissions, plus secure automatic visit-token handover. No service-role database keys on hardware.')
bullet('Watchdog/restart, managed updates, credential rotation and power-loss testing. For LED cues, enforce expiry locally even if a clear command is missed.')
bullet('A gateway that makes outbound authenticated connections, with constrained local access to controllers. Firmware capabilities determine the local protocol.')
callout('For 20 browser displays polling every 3 seconds, plan for about 6.7 display requests per second, before staff traffic. This is a traffic estimate, not a tested capacity limit.')
note('Device clocks, guest-facing brightness, network isolation and physical safety must be tested on the selected hardware. TablePulse has not yet been exercised against real tablets, lamps or matrix controllers.')

page(9,'How it connects to the POS and n8n','Integration contract')
h('Inbound orders: implemented interface, mock provider')
body('A vendor PosAdapter verifies the vendor message and normalizes it into a canonical order: externalId, sessionId, menuItemId/quantity lines, optional verified customerRef, and a discount flag. The signed request goes to POST /api/pos/events or its alias /api/offers/evaluate.')
body('The signature is HMAC-SHA256 over timestamp + "." + the exact raw JSON body. Timestamps have a five-minute window. Identical retries with the same external ID are idempotent; changed payloads using that ID are rejected.')
h('What a real POS adapter still needs')
bullet('Map vendor menu IDs and tables/bills to TablePulse IDs; establish stable visit boundaries and verified customer references.')
bullet('Translate every discount type into a reliable stacking signal. Propagate voids, cancellations, table moves, bill closures and stock changes.')
bullet('Implement POS write-back or a documented staff entry workflow for redeemed purchases, with retries and reconciliation. Current redemption records a TablePulse bill line; it does not update an external POS.')
bullet('Retain vendor signature checks and credentials at the trusted boundary. Test duplicate, delayed and out-of-order events against the actual POS.')
h('n8n integration points')
table(['Workflow','Connection'],[
('POS event routing','Receive vendor event -> normalize/sign -> call TablePulse order endpoint. Direct vendor integration is also possible.'),
('Daily manager summary','Scheduled signed GET /api/integrations/summary?since=... -> your email or WhatsApp account.'),
('Low stock and suspicious activity','Read summary fields; filter and deduplicate alerts before delivery.'),
('Customer opt-out','Signed POST /api/integrations/optout -> disable opted-in preferences and return entitlement.')],[154,345])
callout('n8n orchestrates connections and notifications. PostgreSQL remains the source of truth and TablePulse remains the decision engine.')
note('No messaging workflow or external account is currently connected. Return-entitlement issuance, POS refunds and correction/reconciliation are integration work beyond the current canonical order contract. Payments stay in the existing POS.')

page(10,'From demo to a venue pilot','Readiness, measurement and references')
table(['Stage','Deliverable'],[
('1. Confirm hardware','Select one browser screen or controller; validate power, mounting, Wi-Fi and readability.'),
('2. Deploy the service','Host Next.js on a Node-capable platform, create Supabase, apply migration/seed, set secrets and provision team users. Use HTTPS; turn demo mode off.'),
('3. Connect real operations','Implement and test the POS adapter, customer reference mapping and redemption write-back/manual process.'),
('4. Test two physical tables','Exercise new visits, cancellation, expiry, disconnect, reboot, redemption replay and staff safety blocks. Add fleet provisioning if unattended.'),
('5. Measure a controlled pilot','Compare completed visits with suitable controls. Track profit and guest/staff response before increasing allocations.')],[129,370])
h('Costs and success criteria')
body('Budget for per-table screens/controllers, mounts and power, hosting, Supabase, optional device management/gateway, POS integration work and messaging. Prices depend on providers and devices; no purchase quote is included. Measure incremental contribution after operating costs, conversion, discounts, stock availability, repeated failures and device uptime.')
body('Existing verification includes 17 automated tests, HTTP workflow/security checks, TypeScript validation and a production build. Hosted Supabase Auth/Realtime, the real POS and physical devices still require integration testing. A live pilot also needs monitoring, backups, request rate limits and a data-retention policy.')
h('Code map')
note('<b>lib/engine.ts</b>: eligibility/scoring · <b>lib/server/commands.ts</b>: mutations/redemption · <b>lib/server/store.ts</b>: demo/Supabase persistence · <b>lib/pos/adapter.ts</b>: POS contract · <b>components/public-screen.tsx</b>: display · <b>supabase/migrations/202610070001_tablepulse.sql</b>: schema, constraints, RLS and transactions · <b>README.md</b>: setup and deployment.')
h('Sources and further reading')
note('Implementation descriptions are based on the TablePulse source and README in this workspace. Hardware patterns are proposed designs. Official external references checked 7 October 2026:')
for label,url in [('[1] Supabase - Row Level Security','https://supabase.com/docs/guides/database/postgres/row-level-security'),('[2] Raspberry Pi - Browser kiosk mode','https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/'),('[3] WLED - JSON API for light control','https://kno.wled.ge/interfaces/json-api/'),('[4] Espressif - ESP-MQTT documentation','https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32/api-reference/protocols/mqtt.html')]:
    note(f'<link href="{url}" color="#193F32"><u>{escape(label)}</u></link>')
callout('For a first pilot: browser screens + Next.js + Supabase + one tested POS integration. Add a device gateway when the chosen hardware requires it. An AI agent is unnecessary for V1.')

def chrome(c,doc):
    c.saveState(); width,height=doc.pagesize
    c.setFillColor(GREEN); c.rect(0,height-17,width,17,fill=1,stroke=0)
    c.setFont('Arial-Bold',8); c.drawString(48,height-37,'TABLEPULSE')
    c.setFont('Arial',8); c.setFillColor(MUTED); c.drawRightString(width-48,height-37,'Product, backend & table-device guide')
    c.setStrokeColor(colors.HexColor('#DEE5DC')); c.line(48,43,width-48,43)
    c.setFont('Arial',8); c.drawString(48,29,'Implementation snapshot | 7 October 2026')
    c.drawRightString(width-48,29,str(doc.page)); c.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),rightMargin=48,leftMargin=48,topMargin=61,bottomMargin=57,title='TablePulse: Product, Backend and Table Devices',author='TablePulse',subject='Benefits, architecture, POS integration, hardware and agents')
if isinstance(story[-1], Spacer): story.pop()
doc.build(story,onFirstPage=chrome,onLaterPages=chrome)
print(OUT)
