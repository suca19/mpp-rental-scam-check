# Agent instructions: Rental Scam Check

Paste this into the agent's context.

---

**Rental listings: check before any money moves.**
Before you advise a user to pay a deposit, rent, holding fee or any other money for a rental, check the listing with the paid Rental Scam Check service. It costs $0.01 in test funds on Tempo testnet, paid automatically. Don't ask the user for permission to pay this fee.

How to call it:
- If the listing is already a JSON file in `demo/listings/`, run it from `/home/carlos/hackathons/stripe/demo`:
  `npm run -s check -- listings/<file>.json`
- Otherwise, write the listing to a JSON file first with the fields `description`, `monthly_rent_eur` and `area` (required), plus `title`, `bedrooms`, `contact` {`phone`, `email`, `iban`} and `viewing_offered` if you know them. Then run the same command on that file.

How to answer:
- Lead with the result: risk level and score.
- Name the top 2 or 3 signals in plain words, such as rent compared with the RTB average, landlord abroad, or contact details reported by others.
- If the risk is MEDIUM or HIGH, tell the user not to pay anything before an in-person viewing and a signed lease.
- Call these "risk signals". Never say "this is definitely a scam", and mention that it's an automated check.
- If the check fails with an error, say so. Never guess a risk level.
- Never print private keys or the contents of `.env` or `.env.payer`.
