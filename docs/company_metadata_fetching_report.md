# Company Metadata Fetching

Audience: non-technical and technical non-expert.

## How It Works

The company metadata fetching workflow converts an initial supplier list into structured company profiles that support development of the Materials at Risk dashboard. The workflow starts with company names from the Supply Menu, standardizes those names, and searches USAspending for matching government recipient records. The primary objective is to identify stronger company identifiers, especially UEI and DUNS, because those identifiers are more reliable than company names alone. From the original 1,654 supplier companies, the workflow identified 301 parent companies with both DUNS and UEI values, which is approximately 18.2% of the starting list.

After parent companies are identified, the workflow looks for related child or subsidiary companies so the dashboard can account for larger company structures. From the 301 parent companies, the script identified 1,138 associated child companies, or approximately 3.8 child companies per identified parent. The USAspending script also gathers federal award and contract metadata for matched companies, including award ID, recipient UEI, ultimate parent UEI, award amount, awarding agency, awarding sub-agency, start date, and end date. This financial and contractual data is important for the Materials at Risk dashboard because it helps show which suppliers have government award activity, the scale of that activity, which agencies are connected to the supplier, and whether related entities may carry exposure that is not visible from the original supplier name alone. The workflow also connects matched companies to SEC profile data when possible. Out of the 301 USAspending parent companies used for extraction, 67 were matched to SEC company metadata, representing approximately 22.3% of that parent company set. The Power BI prototype reports metadata such as original company name, matched parent name, UEI, DUNS, child company relationships, SEC company name, ticker, CIK, entity type, SIC code and description, fiscal year end, state of incorporation, business and mailing location, website, match method, match score, review status, and review notes.

Figure 1 summarizes the end-to-end data flow used to convert supplier names into validated, dashboard-ready company records.

[Insert Figure 1 here]

Figure 1. Company Identification and Reporting Data Pipeline. This workflow shows how supplier names are standardized, matched to government records, enriched with USAspending and SEC data, and stored for use in the Materials at Risk dashboard.

## Accomplishments

The company metadata fetching process created a repeatable method for moving from a plain supplier name to a more complete company identity record. The workflow identified 301 parent companies with DUNS and UEI values from the 1,654-company Supply Menu list and expanded those parent companies into 1,138 associated child companies. This is important for the Materials at Risk dashboard because awards, contracts, financial indicators, or other relevant records may be connected to subsidiaries or related entities rather than only the original supplier name.

The workflow also added a fuzzy matching approach and SEC enrichment path to improve data quality. Fuzzy matching helps identify likely company records even when names are written differently across systems, while preserving a review process for uncertain matches. The SEC enrichment process added company profile metadata for 67 companies, including public filing identifiers such as ticker and CIK where available. Together, these results provide a stronger company metadata foundation for the Power BI prototype and future Materials at Risk dashboard development.

The financial and contractual data gathered through USAspending and SEC enrichment can help identify suppliers that may carry risk. Contract data can show where suppliers have government award activity, the scale of awarded dollars, the agencies involved, and whether related companies or subsidiaries are connected to relevant work. SEC profile and filing metadata can add public-company context such as industry classification, corporate identity, filing status, fiscal year information, and parent-company relationships. When combined, these data points help the dashboard move beyond a flat supplier list and toward a more complete view of supplier exposure, concentration, and potential risk signals.

Figure 2 illustrates the fuzzy matching process used to improve company identification when names are written differently across systems.

[Insert Figure 2 here]

Figure 2. Fuzzy Company Name Matching Process. This workflow shows how the script handles company name differences, scores likely matches, and flags uncertain records for review.

## Next Steps

The next step is to make the workflow align with the updated project structure and reviewer expectations. This includes updating file paths and imports after moving workflow scripts, reusable source code, configuration files, documentation, notebooks, and logs into their assigned folders. It also includes replacing remaining print statements with structured logging and replacing CSV-based outputs with writes to the Access database, especially for manufacturer-related data and other dashboard tables.

Additional next steps should focus on improving how the workflow captures more SEC data and handles cases where SEC matches are not straightforward. DUNS and UEI are useful for USAspending records, but SEC records use different identifiers such as CIK and ticker. Because there is no direct one-to-one link between UEI, DUNS, and SEC CIK, some companies match cleanly while others may not return SEC data because they are privately held, listed under a parent company, use a different legal name, or do not file directly with the SEC. Future work should preserve the match method, match score, and review status so users can understand whether a match came from an exact SEC name, historical SEC name, former SEC name, ticker match, or manual review.

