# Data sources

All checked on **2026-11-09**. Anything not confirmed is marked **(not verified)**.

## 1. RTB average rents → `rents.json`

| | |
|---|---|
| Dataset | **RIA02: RTB Average Monthly Rent Report** (annual). Sibling tables with the same layout: RIQ02 (quarterly, latest 2025Q4) and RIH02 (half-yearly) |
| Owner / publisher | Residential Tenancies Board (RTB), hosted by the Central Statistics Office (CSO) on PxStat |
| Catalogue page | https://data.gov.ie/dataset/ria02-rtb-average-monthly-rent-report |
| Table page | https://data.cso.ie/table/RIA02 |
| API used (JSON-stat 2.0) | https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en |
| CSV form (not kept, 46 MB) | https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/CSV/1.0/en |
| Licence | **Creative Commons Attribution 4.0 (CC BY 4.0)**, as stated on data.gov.ie |
| Table last updated | 2026-05-14 |
| Raw copies | `data/raw/RIA02.json`, `data/raw/RIQ02.json` (unchanged downloads) |
| Build script | `node data/scripts/build-rents.mjs` (reads raw, writes `rents.json`) |

**Attribution text to show (API responses + dashboard footer):**

> Rent data: Residential Tenancies Board (RTB), *RTB Average Monthly Rent Report* (CSO PxStat table RIA02, 2025), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Values rounded to the nearest euro; we changed the format but not the figures.

**What the table contains**
- Time: years 2008–2025 (RIA02). Quarterly 2008Q1–2025Q4 in RIQ02.
- Bedrooms: All, One, Two, Three, Four plus, "1 to 2 bed", "1 to 3 bed".
- Property type: All, Detached house, Semi detached house, Terrace house, Apartment, Other flats.
- Location (446 codes): 26 counties, cities/towns (Cork City, Galway City, Limerick City, Waterford City, Kilkenny City, ...), local neighbourhoods ("Rathmines, Dublin 6"), and Dublin postal districts Dublin 1–24 + 6W.
- **Dublin postal district totals are empty from 2022 onwards** (the last values are 2021). For 2025 only some neighbourhoods inside each district have figures.
- About 106 of the 446 locations have no 2025 value (suppressed or absent). The reason is probably small sample size **(not verified)**.
- No tenancy counts are published in this table, so neighbourhood figures cannot be correctly averaged up to district level.

**What `rents.json` keeps:** period 2025 (annual), all property types, bedroom keys `all`, `1bed`, `2bed`, `3bed`, `4plusbed`. It also includes `postal_districts` (for each Dublin district: the neighbourhoods with data, plus a `Dublin` county fallback) and `aliases` (D6/D06/Dublin 06 → Dublin 6, "Co. Cork" → Cork, unique neighbourhood short names like "Rathmines" → "Rathmines, Dublin 6"). Ambiguous names (Blackrock, Ballymun, Terenure, Harolds Cross, Drogheda, Athlone, ...) deliberately have no alias.

**Not used:** RTB Rent Index PDFs (local electoral area level, standardised rents), e.g. https://rtb.ie/wp-content/uploads/2026/05/RTB-Rent-Index-Q4-2025.pdf. Licence not confirmed **(not verified)**, so nothing was extracted.

## 2. Scam signals → `scam-signals.json`

Each signal's `source` / `extra_sources` points to one of the pages below. The descriptions paraphrase the official advice. **`example_phrases` are our own illustrative wording for matching, not quotes**, except where they match the source (e.g. "one-time offer", "no questions asked", "iTunes gift cards").

| Source | URL | Date | Licence / reuse |
|---|---|---|---|
| An Garda Síochána (GNECB), *Student fraud warning ahead of CAO offers* | https://www.garda.ie/en/about-us/our-departments/office-of-corporate-communications/press-releases/2026/august/25-08-2026-an-garda-siochana-issues-student-fraud-warning-ahead-of-cao-offers-25th-august-2026.html | 25 Aug 2026 | Public press release. We cite and paraphrase it and do not republish it. Formal reuse licence **(not verified)** |
| An Garda Síochána, *Student Accommodation Fraud Warning, August 2025* | https://www.garda.ie/en/about-us/our-departments/office-of-corporate-communications/press-releases/2025/august/an-garda-siochana-student-accommodation-fraud-warning-august-2025.html | 24 Aug 2025 | Same as above |
| An Garda Síochána, *Student Accommodation Fraud Warning, August 2024* | https://garda.ie/en/about-us/our-departments/office-of-corporate-communications/press-releases/2024/august/an-garda-siochana-student-accommodation-fraud-warning-august-2024.html | Aug 2024 | Same as above |
| An Garda Síochána, *Rental Scam Awareness Advice (25/7/19)* | https://www.garda.ie/en/about-us/our-departments/office-of-corporate-communications/news-media/news-archive/rental-scam-awareness-advice-25-7-19-.html | 25 Jul 2019 | Same as above |
| CCPC, *Rental accommodation scams* | https://www.ccpc.ie/consumers/housing/rental-accommodation-scams/ | No date on page (© 2026) | Cited and paraphrased. Licence **(not verified)** |
| CCPC, *Student accommodation: how can I tell the genuine from a scam?* | https://www.ccpc.ie/news-and-media/news/article/2026/09/09/student-accommodation--how-can-i-tell-the-genuine-from-a-scam | 9 Sep 2026 | Same as above |
| Threshold, *Scamwatch* | https://www.threshold.ie/advocacy-campaign/scamwatch/ | No date on page (© 2026) | Same as above |
| University of Galway Accommodation Advisory Service, *Off campus* | https://www.universityofgalway.ie/student-life/accommodation/off-campus/ | No date on page | Same as above |

**Attribution text to show (next to signals / in the disclaimer):**

> Risk signals are based on public advice from An Garda Síochána (GNECB), the CCPC, Threshold and the University of Galway Accommodation Advisory Service. These are automated risk signals, not a verdict, and are not endorsed by those organisations.

**Newer Garda figures:** over 230 rental and reservation scam reports and more than €400k lost up to 31 Jul 2026 (Garda, 25 Aug 2026). In H1 2025 reports rose 22% to about 160, with €385k lost (Garda, Aug 2025).

**Gap:** no official Irish source uses the exact phrase "keys sent by post". The official wording is "fake keys" (CCPC 2026) and "ensure keys fit ... prior to payment of deposit" (Garda 2019). The `keys_by_post` signal is our generalisation of these **(not verified as official wording)**. No rtb.ie scam-advice page was found, so RTB is used only as the rent data source.
