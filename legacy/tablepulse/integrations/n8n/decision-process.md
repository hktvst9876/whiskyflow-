# How TablePulse decides a deal

Think of the decision maker as a manager with non-negotiable rules, fixed commercial goals and an optional AI ranking assistant. The AI can choose only from offers the backend has already approved, or choose `NO_OFFER`. Every event has a recorded reason, including when nothing is shown.

1. **Wait for a genuine new order.** Waiting, signing in, scanning a QR or requesting a check-in code does not trigger a reward. n8n only forwards accepted new POS orders.
2. **Apply the non-negotiable rules.** An open bill must have a qualifying organic order, no other discounts and no staff block. Live rewards need a verified customer. A table cannot receive a second reward; a customer cannot hold another active reward at another table or redeem a subsidy within 30 days. A campaign cannot repeat for the same customer within 60 days.
3. **Find useful add-ons.** Two mains without drinks can match a drink pairing; two beers without snacks can match a snack. A main plus one glass of wine may match the configured bottle campaign. An opted-in member's unused entitlement can match only after a new qualifying purchase. The offered item must not already be ordered.
4. **Protect stock, safety and profit.** Remove out-of-stock, disabled, capped and unsafe campaigns. Alcohol offers require staff verification that all recipients are 18+ and not flagged intoxicated. The potential additional gross profit must strictly exceed the venue's cash threshold and the offer's gross margin must meet its percentage threshold. Demo defaults are **more than S$2.50** and **at least 30%**.
5. **Let the agent rank only approved choices.** When enabled, the agent receives candidate IDs, commercial numbers, basket categories and limited opted-in preference/history summaries. It selects one approved ID or `NO_OFFER`. It cannot invent a price, item or campaign, alter the 30% margin goal, see a phone number/name/raw bill history, or approve its own choice.
6. **Apply score, allocation and control rules.** The final candidate must still exceed the configured weighted-score threshold and pass probabilistic allocation. A control visit shows no reward. If the agent is disabled, unavailable or returns an invalid result, the deterministic scorer chooses the best approved candidate.
7. **Lock the opportunity and recheck redemption.** Once a safe, profitable basket match is considered, the visit's opportunity is consumed even when the agent says `NO_OFFER`, score or random allocation withholds it. Another order, account link or staff override cannot reroll it. The backend rechecks the current bill, qualifying items, code, expiry, customer cap, stock, both profit floors and alcohol safety at redemption.

## Predetermined goal order

The agent is optimising inside this order of authority:

1. Safety, identity, one-offer, frequency, non-stacking and bill-binding rules.
2. Stock and daily campaign allocation.
3. Venue cash-profit and percentage-margin floors.
4. Avoid likely cannibalisation; prefer a genuinely additional purchase.
5. Rank remaining choices by likely relevance and incremental gross profit.
6. Use `NO_OFFER` when evidence is weak.

A venue manager can change the commercial floors in the dashboard. The AI cannot change them. For example, a S$3.90 snack costing S$1.20 produces S$2.70 and 69.2% gross margin. It passes the demo's S$2.50 and 30% goals. A S$10 item costing S$8 produces S$2 profit and 20% margin, so it is removed before AI ranking.

## Current scoring sheet

| Component                         | Implemented calculation                                                                 | Maximum points |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------- |
| Basket relevance                  | A campaign must match its configured basket rule; a match receives 28 points.           | 28             |
| Optional category preference      | Add 2 when the member has opted in and likes the offered item's category.               | 2              |
| Potential additional gross profit | `min(25, gross profit / 20 × 25)` in SGD.                                               | 25             |
| Inventory                         | `min(15, stock / offer quantity / 3)`.                                                  | 15             |
| Frequency                         | 10 after customer caps pass; a failed cap is rejected, not compensated by other scores. | 10             |
| Campaign priority                 | Venue priority (0–100) divided by 10.                                                   | 10             |
| Random factor                     | Cryptographic random value from 0 to just below 10.                                     | <10            |

Defaults: gross-profit threshold **S$2.50**, gross-margin threshold **30%**, score threshold **65**, allocation probability **78%**, and control assignment **15%** when a visit opens. The score is a ranking heuristic, not a probability that someone will buy. These defaults are editable in the manager dashboard. V1 considers stock but does not reserve physical inventory per offer; it rechecks stock on display and redemption.

## What customer memory does

A stable customer UUID joins the account to staff-confirmed visits, associated table orders, preferences and reward history. The permanent membership number is a lookup reference, not a password. Raw phone data stays in Supabase Auth. Shared-table orders are weak evidence because they do not prove which guest consumed an item.

The rules use history for reward caps, repeat-campaign suppression and the unused return entitlement. When the customer has opted in, the optional agent can receive explicit preferences and aggregated category counts from up to ten associated visits in the past 180 days. It does not receive the person's name, phone number, customer ID or raw line-by-line history. Opted-out customers receive basket-only ranking.

This is an agentic ranker, not a self-training model. It follows the fixed prompt and structured output contract on every decision. Learning purchase response or estimating causal uplift would require separate, consented experiment data, offline evaluation, shadow testing and a controlled rollout. Matched control tables remain necessary because conversion alone does not prove incremental profit.

## Exploit controls and remaining limits

- Stable event IDs and atomic commits stop duplicate webhook deliveries from generating extra stock deductions or reward attempts.
- Staff confirms attendance using a short-lived, one-use table check-in code; a screenshot of the public QR does not establish identity.
- A withheld profitable opportunity stays consumed, and customer active-reward checks apply across this venue's table visits.
- The agent sees a server-created allowlist and its output is schema-validated. The backend rechecks the selected ID in the same transaction.
- Redemption stays bound to the current bill and original qualifying items, with failed attempts logged.

Phone OTP proves possession of a number, not a unique person. Multiple phone accounts, account sharing, recycled numbers and staff collusion remain possible. A real POS adapter must preserve visit identity through table moves, bill splits and reopen events. V1 caps are venue-scoped and nominally one linked member per table; it does not recognise every person in a party. Use conservative allocations and investigate audit patterns during the pilot. “Impossible to exploit” would be an inaccurate promise.
