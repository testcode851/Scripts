# Power BI Dashboard Build Guide

This guide explains how to build the first Power BI dashboard from the refined USAspending pipeline outputs.

The refined script creates normalized source tables and readable dashboard files. For the easiest dashboard build, use the readable files in:

```text
output/powerbi_prototype/
```

---

## 1) Create the Power BI Export Files

Before opening Power BI, make sure the refined script has created the readable export files.

For a full refresh, run:

```bash
python company_management/usaspending_data_pull_refined.py --step all --input config/CompanyNames.xlsx --non-interactive
```

If the pipeline already ran and you only need to recreate the Power BI files, run:

```bash
python company_management/usaspending_data_pull_refined.py --step powerbi-exports --non-interactive
```

Confirm these files exist:

```text
output/powerbi_prototype/entity_master.csv
output/powerbi_prototype/award_fact_readable.csv
output/powerbi_prototype/relationships_readable.csv
```

---

## 2) Open Power BI Desktop

1. Open **Power BI Desktop**.
2. Click **File**.
3. Click **New**.
4. Save the file before building:
   - Click **File**
   - Click **Save As**
   - Name the file something like `USAspending_At_Risk_Materials_Dashboard.pbix`

---

## 3) Load the Readable CSV Files

1. On the top ribbon, click **Home**.
2. Click **Get data**.
3. Click **Text/CSV**.
4. Browse to:

   ```text
   output/powerbi_prototype/
   ```

5. Select `award_fact_readable.csv`.
6. Click **Open**.
7. In the preview window, click **Load**.

Repeat the same steps for:

```text
entity_master.csv
relationships_readable.csv
```

You should now see these tables in the **Data** pane:

- `award_fact_readable`
- `entity_master`
- `relationships_readable`

---

## 4) Check Data Types

Power BI may guess some column types incorrectly. Check the important fields before creating visuals.

1. Click the **Data view** icon on the left side of Power BI.
2. Click the `award_fact_readable` table.
3. Click the `award_amount` column.
4. On the top ribbon, set:
   - **Data type**: Decimal number
   - **Format**: Currency
5. Click the `start_date` column.
6. Set:
   - **Data type**: Date
7. Click the `end_date` column.
8. Set:
   - **Data type**: Date

For ID fields, use text:

1. Click `award_id`.
2. Set **Data type** to Text.
3. Click `recipient_uei`.
4. Set **Data type** to Text.
5. Click `ultimate_parent_uei`.
6. Set **Data type** to Text.

Repeat this text check for the UEI columns in `entity_master` and `relationships_readable`.

---

## 5) Create Basic Measures

Measures make the dashboard easier to build and keep the numbers consistent.

1. Click the **Report view** icon on the left side.
2. In the **Data** pane, right-click `award_fact_readable`.
3. Click **New measure**.
4. Enter this measure:

```DAX
Total Award Amount = SUM(award_fact_readable[award_amount])
```

5. Press **Enter**.
6. Right-click `award_fact_readable` again.
7. Click **New measure**.
8. Enter:

```DAX
Award Count = DISTINCTCOUNT(award_fact_readable[award_id])
```

9. Create another measure:

```DAX
Recipient Count = DISTINCTCOUNT(award_fact_readable[recipient_uei])
```

10. Create another measure:

```DAX
Ultimate Parent Count = DISTINCTCOUNT(award_fact_readable[ultimate_parent_uei])
```

---

## 6) Build the Dashboard Page

Start with one clean overview page.

1. Click the **Report view** icon.
2. In the bottom page tab, right-click **Page 1**.
3. Click **Rename**.
4. Rename it:

```text
Overview
```

---

## 7) Add KPI Cards

Create four KPI cards across the top of the page.

### Total Award Amount

1. In the **Visualizations** pane, click **Card**.
2. Drag the `Total Award Amount` measure into the card.
3. Resize the card and place it at the top left.
4. With the card selected, click **Format visual**.
5. Open **Callout value** and set the display units if needed.
   - **Display units**: Millions
   - **Decimal places**: 1 or 2
6. Open **Title** and turn it on.
7. Set the title to:

```text
Total Award Amount
```

### Award Count

1. Click a blank area on the canvas.
2. Click **Card**.
3. Drag `Award Count` into the card.
4. Place it next to the first card.
5. Open **Callout value**.
6. Set:
   - **Display units**: None
   - **Decimal places**: 0
7. Turn on **Title**.
8. Set the title to:

```text
Award Count
```

### Recipient Count

1. Add another **Card**.
2. Drag `Recipient Count` into it.
3. Open **Callout value**.
4. Set:
   - **Display units**: None
   - **Decimal places**: 0
5. Set the title to:

```text
Recipient Count
```

### Ultimate Parent Count

1. Add another **Card**.
2. Drag `Ultimate Parent Count` into it.
3. Open **Callout value**.
4. Set:
   - **Display units**: None
   - **Decimal places**: 0
5. Set the title to:

```text
Ultimate Parent Count
```

---

## 8) Add Award Amount by Ultimate Parent

This chart shows which parent companies account for the most award dollars.

1. Click a blank area on the canvas.
2. In **Visualizations**, click **Clustered bar chart**.
3. Drag `ultimate_parent_name` from `award_fact_readable` to the **Y-axis** field well.
4. Drag `Total Award Amount` to the **X-axis** field well.
5. With the chart selected, click **Format visual**.
6. Open **Title**.
7. Turn the title on.
8. Set the title to:

```text
Award Amount by Ultimate Parent
```

9. Open **Y-axis**.
10. Turn on word wrap if names are cut off.
11. Open **X-axis**.
12. Set display units to Millions or Thousands if needed.

Optional sorting:

1. Click the chart.
2. Click the three dots in the upper-right corner of the visual.
3. Click **Sort axis**.
4. Select **Total Award Amount**.
5. Click **Descending**.

---

## 9) Add Award Amount by Awarding Agency

This chart shows which agencies are spending the most.

1. Click a blank area on the canvas.
2. Click **Clustered column chart**.
3. Drag `awarding_agency` to the **X-axis** field well.
4. Drag `Total Award Amount` to the **Y-axis** field well.
5. Click **Format visual**.
6. Open **Title**.
7. Set the title to:

```text
Award Amount by Awarding Agency
```

8. If agency names overlap, switch the visual to a **Clustered bar chart**.

---

## 10) Add an Award Detail Table

This table lets the user inspect the underlying awards.

1. Click a blank area on the canvas.
2. In **Visualizations**, click **Table**.
3. Add these fields from `award_fact_readable`:
   - `award_id`
   - `recipient_name`
   - `ultimate_parent_name`
   - `award_amount`
   - `awarding_agency`
   - `awarding_sub_agency`
   - `start_date`
   - `end_date`
4. Click **Format visual**.
5. Open **Grid**.
6. Turn on row dividers if desired.
7. Open **Column headers**.
8. Turn on word wrap.
9. Resize the table so the important columns are visible.

---

## 11) Add Date Slicers

Date slicers let the user filter awards by time period.

1. Click a blank area on the canvas.
2. In **Visualizations**, click **Slicer**.
3. Drag `start_date` from `award_fact_readable` into the slicer.
4. Click **Format visual**.
5. Open **Slicer settings**.
6. Set the style to **Between**.
7. Turn on the slicer title and name it:

```text
Award Start Date
```

Optional second slicer:

1. Add another **Slicer**.
2. Drag `awarding_agency` into it.
3. Set the slicer style to **Dropdown**.
4. Name it:

```text
Awarding Agency
```

---

## 12) Add a Company Hierarchy Page

Use the relationships readable table to show parent-child relationships.

1. At the bottom of Power BI, click the **+** button to add a new page.
2. Right-click the new page tab.
3. Click **Rename**.
4. Rename it:

```text
Company Hierarchy
```

5. Click a blank area on the page.
6. In **Visualizations**, click **Table**.
7. Add these fields from `relationships_readable`:
   - `parent_name`
   - `child_name`
   - `relationship_source`
   - `relationship_confidence`
   - `first_seen_date`
   - `last_seen_date`
8. Click **Format visual**.
9. Open **Title**.
10. Set the title to:

```text
Parent and Child Company Relationships
```

Optional slicer:

1. Add a **Slicer**.
2. Drag `parent_name` from `relationships_readable` into it.
3. Set the slicer style to **Dropdown**.

---

## 13) Add a Recipient Detail Page

Use this page to inspect entities from `entity_master`.

1. Click the **+** button to add a new page.
2. Rename the page:

```text
Entity Detail
```

3. Add a **Table** visual.
4. Add these fields from `entity_master`:
   - `entity_name`
   - `uei`
   - `duns`
   - `recipient_level`
   - `original_company_name`
   - `ultimate_parent_name`
   - `ultimate_parent_uei`

5. Add a **Slicer**.
6. Drag `ultimate_parent_name` into the slicer.
7. Set the slicer style to **Dropdown**.

---

## 14) Refresh the Dashboard Later

When new data is pulled:

1. Run the refined script again.
2. Open the `.pbix` file.
3. Click **Home**.
4. Click **Refresh**.
5. Wait for the data refresh to finish.
6. Click **File**.
7. Click **Save**.

If Power BI says a file path is missing:

1. Click **Transform data**.
2. Click **Data source settings**.
3. Select the missing CSV source.
4. Click **Change Source**.
5. Browse to the correct file in:

```text
output/powerbi_prototype/
```

6. Click **OK**.
7. Click **Close & Apply**.

---

## 15) Recommended Layout

Use this layout for the first dashboard version:

```text
Overview page

Top row:
Total Award Amount | Award Count | Recipient Count | Ultimate Parent Count

Middle row:
Award Amount by Ultimate Parent | Award Amount by Awarding Agency

Left or top filter area:
Award Start Date slicer
Awarding Agency slicer

Bottom row:
Award Detail Table
```

Then add:

```text
Company Hierarchy page
Entity Detail page
```

---

## 16) Validation Checklist

Before sharing the dashboard, check the following:

1. The dashboard refreshes without errors.
2. `Total Award Amount` is not blank.
3. `Award Count` is not blank.
4. The parent company bar chart shows company names.
5. The agency chart shows agency names.
6. The award detail table includes readable recipient and parent names.
7. The hierarchy page shows `parent_name` and `child_name`.
8. The date slicer changes the visuals when adjusted.
9. The Power BI file is saved as `.pbix`.

---

## 17) Files Used by This Dashboard

Use these readable export files for the dashboard:

| File | Purpose |
|---|---|
| `output/powerbi_prototype/award_fact_readable.csv` | Main award table with recipient and parent names already added |
| `output/powerbi_prototype/entity_master.csv` | Entity lookup table with UEI, DUNS, recipient level, and ultimate parent fields |
| `output/powerbi_prototype/relationships_readable.csv` | Parent-child relationship table with readable names |

The normalized source files still exist in the project root:

| File | Purpose |
|---|---|
| `entity_master.csv` | Canonical entity dimension |
| `relationships.csv` | Canonical child-parent relationship table |
| `award_fact.csv` | Canonical award fact table |

Use the readable exports for fast dashboard building. Use the normalized root files when you want a more formal data model with explicit relationships.

