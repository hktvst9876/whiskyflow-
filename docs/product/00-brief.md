# Product brief (source of truth)

> This is the founder's original brief, preserved verbatim in substance. Every other
> document in `docs/` answers to it. When a design decision conflicts with this brief,
> the brief wins unless the conflict is written down in `docs/product/decisions.md`.

You are a senior product strategist, SaaS architect, retention marketer, F&B operator, CRM
expert, and full-stack product designer.

Design a software platform inspired by the underlying retention mechanic of bottle-keeping
systems, but NOT copy any specific company or product.

The core principle is:

**Customers should leave a business with something valuable that they already own but have
not fully consumed or redeemed. That unfinished value becomes a reason to return.**

The platform should work across: bars and pubs, beer concepts, restaurants, cafes, casual
dining, beauty and wellness businesses, fitness businesses, other repeat-service businesses.

The system should turn:

**First purchase → unfinished entitlement → reminder → return visit → incremental purchase →
another reason to return**

into a measurable retention loop.

---

## 1. Core product concept

The platform should allow businesses to create a customer's own "stored value" or
"unfinished entitlement."

### Bars
Customer buys a bottle but does not finish it. System stores: bottle, brand, remaining
amount, storage location, expiry, customer identity. Customer later receives reminders to
come back and finish it. When they return, the business should upsell: mixers, Coke, soda,
food, finger food, additional bottles, table reservations.

### Beer businesses
Customers should be able to have: stored pints, beer balance, beer locker, remaining bucket
beers, keg allocation.

Example: customer was going to order 4 beers + wings = $60. System identifies a deal:
6 beers + wings = $70. Customer drinks 4 beers tonight. 2 beers remain in their account.
Customer leaves thinking: **"I still have 2 beers at that place."** Several days later:
"You still have 2 beers waiting. Come down Friday and add our burger + fries for $16."
The beer creates the return visit. Food and additional drinks create new revenue.

## 2. Restaurant Return-Anchor model

The customer should intentionally leave the restaurant with food entitlement remaining.

Customer intends to order 2 mains + 2 sides = $60. System detects 3 mains + 2 sides package
= $68. Offer: "For another $8, you qualify for our 3-main set. Have your two mains and sides
tonight, and we'll keep one main for your next visit." Customer pays $68, consumes 2 mains +
2 sides. Their account now contains **1 Main Waiting**. The customer should NOT see "$22
credit." They should see **1 Main Waiting at Restaurant X**.

When they return, the remaining main brings them through the door. The business then sells:
another main for their companion, drinks, sides, desserts, premium upgrades, additional food,
another return package.

**Leave enough behind to cause the next visit, but leave room for incremental spending when
the customer returns.** Call this remaining item the **RETURN ANCHOR**.

## 3. Dynamic deal engine

Analyse the customer's current basket BEFORE checkout and ask: **"What small additional
amount could this customer pay today that creates meaningful unfinished value for their next
visit?"** (e.g. basket 2 mains + 2 sides = $58 → package 3 mains + 2 sides = $65 → **Pay +$7
today → keep 1 main for next visit**).

Inputs: current basket, menu prices, food cost, gross margin, customer history, likelihood of
returning, average spend, party size, expected next-visit incremental spend, customer
lifetime value, existing promotions, time/day, merchant capacity, customer response history.

Do NOT blindly discount. Every offer has an expected profitability calculation:

    Incremental payment today
    + Expected gross profit from next visit
    − Cost of the stored entitlement
    − Discount cost
    = Expected incremental contribution

Only recommend offers where the economics are attractive.

## 4. Discount and offer engine

Offer types (not generic discounts): immediate upgrade; stored item + add-on; bring-a-friend;
new menu trigger; off-peak trigger; food + drink attachment; premium upgrade ("your stored
main covers dishes up to $24 — upgrade to ribeye for +$8"); near-completion trigger (renew
package + bonus side); win-back offer (30+ days → complimentary drink).

## 5. Offer guardrails (extremely important)

The platform MUST prevent customers from learning to wait for discounts. Do not repeatedly
reward inactivity. Rules: do not offer discounts every visit; vary offer type; use
non-discount perks where possible; reward behaviour, not inactivity; limit aggressive
win-back discounts; track whether the customer would likely return anyway; avoid subsidising
frequent visitors; no discount stacking; minimum contribution margin; cap promotional cost per
customer; cooldown after an offer; differentiate loyal from price-sensitive customers; avoid
teaching customers that waiting longer generates better deals.

Prefer high-perceived-value / low-cost benefits: priority booking, complimentary side, small
appetiser, reserved seating, additional mixer, flexible redemption, menu upgrade, early
access, bonus entitlement after multiple visits — instead of constant percentage discounts.

## 6. Customer segmentation

- **Likely regular** — already likely to return. Do not heavily discount. Use recognition,
  convenience, priority, VIP treatment, new menu access.
- **Persuadable** — could return with the right reminder or benefit. Use return-anchor
  reminder, small add-on, food pairing, bring-a-friend.
- **At-risk** — unused entitlement, not returned. Use reminder, expiry warning, small comeback
  benefit.
- **High-value** — high spend / large groups. Use table reservation, premium experiences,
  group bundles, bottle/food packages, VIP benefits.
- **Price-sensitive** — responds primarily to discounts. Do not continuously increase
  discounts. Use controlled offers and frequency caps.

## 7. Customer wallet

No native app initially. Use Apple Wallet, Google Wallet, WhatsApp, web-based customer
account, QR identification. Show tangible entitlements (BAR: Macallan 42% remaining; BEER: 3
pints remaining; RESTAURANT: 1 Main Waiting; CAFE: 4 Coffees Remaining; FITNESS: 3 Classes
Remaining; SPA: 2 Massages Remaining), not primarily monetary credits. The customer should
feel: **"I still have something there."**

## 8. WhatsApp retention engine

WhatsApp is the main channel initially. Behaviour-triggered messages, e.g. "You still have
one main waiting at ABC Kitchen."; "You've got 2 pints left in your beer locker."; "Your last
visit was 17 days ago. Your usual Saturday evening table is available."; "Your main is
covered — add another main + two drinks for $32."; "Your bottle is almost finished. Want us
to have your next bottle ready?" Actions: reserve table, redeem entitlement, add food, add
drinks, bring friends, top up, purchase next package, view balance.

## 9. Next-visit upsell engine

On return, identify the most likely fresh purchases. One remaining main → companion main,
side, drinks, dessert. 2 beers → wings, burger, additional beer, beer flight. Half a bottle →
mixer package, finger food, table package, second bottle. One massage → upgrade,
aromatherapy, longer session, new package. **Existing entitlement creates visit. New spending
creates merchant profit.**

## 10. Return Score

Inputs: remaining entitlement value, days since last visit, normal visit frequency, average
spend, group size, tenure, previous offer response, preferred visit day/time, expiry, product
preferences, distance/frequency where legally appropriate. Output: High / Medium / At risk.
Used to prioritise campaigns.

## 11. Revenue attribution (one of the most important parts)

Do not only say "40 customers came back." Show: return-anchor redemptions; customers
returning; stored value redeemed; additional new cash spent during redemption visits; gross
profit from incremental spend; new packages sold; total attributable revenue; promotional
cost; estimated incremental contribution. The merchant needs to understand: **"This software
generated money for me."**

## 12. Merchant dashboard

- **Today**: customers likely to return; customers with remaining entitlements; high-value
  opportunities; upcoming expiry.
- **Revenue opportunities**: bottle refill, food upsell, beer return, package renewal.
- **Customer list**: name, remaining entitlement, last visit, average spend, party size,
  Return Score, lifetime value, next recommended action.
- **Campaigns**: suggested campaign, target segment, expected cost, expected return, actual
  performance.
- **Offers**: all active offers, acceptance rate, redemption rate, incremental spend,
  profitability.

## 13. Merchant offer builder

Merchant defines: menu items, item cost, retail price, eligible return anchors, minimum
margins, maximum discount, redemption restrictions, blackout periods, expiry rules,
transferability, upgradeable items, upsell products, business hours, off-peak periods. The
engine constructs offers within these boundaries. The merchant always maintains control.

## 14. Service business version

Salon (haircut + colour + 1 treatment waiting), massage (3-session package, 2 remaining),
car detailing (1 wash remaining), fitness (3 classes remaining). Workflow: entitlement →
reminder → booking → add-on → redemption → renewal.

## 15. Consumer trust

Not lock-in. Customers always see: what they own, what they used, what remains, expiry,
restrictions, upgrade rules, transfer rules, refund rules, transaction history. No dark
patterns. Do not rely on customers forgetting their value. Actively encourage redemption.

## 16. Business principle

NOT a loyalty points app. NOT a discount platform. NOT a prepaid credit wallet. It IS **a
retention operating system built around unfinished customer value.**

Core loop: PURCHASE → CREATE RETURN ANCHOR → CUSTOMER LEAVES WITH UNFINISHED VALUE →
REMINDER → RETURN VISIT → REDEMPTION → INCREMENTAL PURCHASES → CREATE NEW RETURN ANCHOR →
REPEAT.

## 17. MVP flow (exact)

1. Merchant enters menu + prices + approximate food cost.
2. Customer orders normally.
3. System analyses basket.
4. System identifies profitable package upgrade.
5. Staff sees: "Offer customer +$8 → 1 Main Waiting."
6. Customer accepts.
7. Customer scans QR.
8. Customer receives entitlement in web wallet / Apple Wallet / Google Wallet.
9. Customer receives WhatsApp confirmation: "You have 1 Main Waiting."
10. System waits for appropriate return timing.
11. WhatsApp sends personalised reminder.
12. Customer books or walks in.
13. Staff scans customer's QR.
14. Stored entitlement is redeemed.
15. System recommends relevant add-ons.
16. Customer makes additional purchase.
17. System calculates incremental revenue.
18. System decides whether another Return Anchor should be created.

## 18. Building requirements (deliverables)

1 Full product specification · 2 User personas · 3 Customer journeys · 4 Merchant journey ·
5 Complete database schema · 6 Recommended technology stack · 7 Backend architecture · 8 API
architecture · 9 Authentication design · 10 Merchant dashboard wireframes · 11 Customer
wallet UX · 12 Offer engine logic · 13 Return Score logic · 14 Discount guardrail logic ·
15 WhatsApp integration architecture · 16 Apple Wallet / Google Wallet architecture · 17 POS
integration strategy · 18 Payment flow · 19 Redemption system · 20 Fraud prevention ·
21 Reporting and analytics · 22 Revenue attribution methodology · 23 MVP scope · 24 Phase 2
features · 25 Phase 3 features · 26 Testing plan · 27 Merchant onboarding flow · 28 Example
restaurant · 29 Example bar · 30 Example beer pub · 31 Example service business.

For every feature, challenge whether it is genuinely necessary. Prioritise the smallest
usable MVP capable of proving: **Does deliberately creating a Return Anchor increase
profitable repeat visits?** Do not overengineer before proving this hypothesis.

## 19. Devil's-advocate requirement

For each important feature identify: why the customer might reject it; why the merchant
might reject it; margin risk; cannibalisation risk; fraud risk; operational complexity;
customer trust risk; regulatory risk; whether the customer would have returned anyway; how we
can experimentally prove incremental lift.

Do not assume increased redemptions equal increased profit. The optimisation objective is
**INCREMENTAL PROFITABLE CUSTOMER LIFETIME VALUE** — not number of offers, messages,
redemptions or amount of prepaid value. The system must ultimately answer: **Did this
intervention make the customer more valuable than they would have been without it?**
