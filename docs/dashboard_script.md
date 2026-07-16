# Dashboard Script

This script is written as a conversational walkthrough for presenting the USAspending Power BI dashboard.

---

## Opening

This dashboard is designed to help us understand federal award activity for the companies in our at-risk materials list.

The goal is not just to see a list of contracts. The goal is to understand which parent companies and subsidiaries are connected to federal awards, which agencies are awarding the money, and which companies are driving the largest totals.

The dashboard is built from the refined USAspending data pull. That process starts with the company list, identifies parent and child companies, pulls award data by UEI, and then creates readable Power BI tables for analysis.

---

## Overview Page

The first page is the main overview page.

Across the top, we have four summary cards.

The first card is **Total Award Amount**. This shows the total dollar value of the awards currently included in the dashboard. This number changes when we apply filters, so it gives us a quick view of the selected slice of the data.

The second card is **Award Count**. This counts the distinct award IDs in the current view. It is useful because one company may have a small number of very large awards, while another may have many smaller awards.

The third card is **Recipient Count**. This tells us how many unique recipient UEIs appear in the award data. In plain terms, it shows how many distinct entities received awards in the current filtered view.

The fourth card is **Ultimate Parent Count**. This counts the number of parent companies represented in the award data. This is not the same as the total number of parent companies discovered in the entity table. It only counts parent companies that actually have award records in the current dashboard view.

---

## Award Amount by Ultimate Parent

The first main chart shows **Total Award Amount by Ultimate Parent**.

This chart rolls awards up to the parent company level. That matters because many awards are issued to subsidiaries, divisions, or related entities. If we only looked at the recipient name, we could miss the larger corporate picture.

For example, an award may be issued to a child company, but the dashboard can still roll that award up under the ultimate parent. This gives us a clearer view of which parent organizations are most connected to federal award dollars.

When reading this chart, the largest bars show the parent companies with the highest total award value in the current view. Smaller bars do not necessarily mean the company is unimportant. It may mean the company has fewer awards, smaller awards, or awards outside the selected time period or filter.

---

## Award Amount by Awarding Agency

The second main chart shows **Award Amount by Awarding Agency**.

This view helps answer the question: which federal agencies are spending the most with these companies?

In many cases, the Department of Defense will dominate the award amount because defense contracts can be very large. Other agencies may still be important even if their totals are smaller. For example, Health and Human Services, Veterans Affairs, Energy, Agriculture, NASA, and Homeland Security may all show up depending on the companies in the list.

This chart is useful for understanding the federal customer base. If most of the award activity is concentrated in one agency, that tells a different story than if the spending is spread across many agencies.

---

## Award Detail Table

The award detail table gives us the record-level view behind the summary charts.

Each row represents an award record. The table includes the award ID, recipient name, ultimate parent name, award amount, awarding agency, awarding sub-agency, start date, and end date.

This is where we can validate what is driving a chart. If a parent company has a large total, we can look at the table to see which specific awards are contributing to that amount.

The table also helps identify cases where the award was issued to a subsidiary but rolled up to a parent company. That is important because federal award data often uses the recipient entity name, while our analysis may care about the broader parent company relationship.

---

## Slicers and Filters

The slicers let us narrow the dashboard to a specific slice of the data.

The **date slicer** can be used to focus on awards by start date. If we want to look only at awards that started in a certain period, we can adjust the date range.

The **awarding agency slicer** lets us focus on one or more agencies. For example, we can select only Department of Defense to see which companies are tied to defense award activity.

If we add an **ultimate parent slicer**, we can focus the dashboard on one parent company at a time. This is useful when we want to drill into one company and see its award profile across agencies and subsidiaries.

One important note: the date fields shown in the dashboard are award start and end dates. Some awards may have started before the pull window if they were still relevant in the USAspending results. If we want the dashboard to show only awards active during a specific period, we should use a filter that keeps awards where the end date is on or after the selected start date.

---

## Company Hierarchy Page

The Company Hierarchy page focuses on parent-child relationships.

This page shows which child companies are connected to each parent company. That matters because award activity may not always appear under the parent company name directly.

For example, a parent company may look like it has little activity if we only search the parent name. But when we include subsidiaries and related entities, the award picture can change significantly.

The hierarchy table helps us explain why certain awards are being rolled up to a specific parent. It also gives us a way to review whether the parent-child relationships look reasonable.

---

## Entity Detail Page

The Entity Detail page provides a lookup view of the entities in the dataset.

This page includes fields like entity name, UEI, DUNS, recipient level, original company name, ultimate parent name, and ultimate parent UEI.

This is useful when we need to check identity details. For example, if we see a company name in the award detail table and want to know how it connects back to the original company list, this page gives us that context.

It is also helpful for troubleshooting. If a company appears under an unexpected parent, the entity detail page is where we can start checking the underlying identifiers.

---

## How to Read the Dashboard

The best way to use the dashboard is to start broad and then narrow down.

First, look at the total award amount and award count to understand the size of the current data view.

Next, look at the parent company chart to see which organizations account for the largest share of award dollars.

Then look at the awarding agency chart to understand which federal agencies are driving the spending.

After that, use the detail table to inspect the specific awards behind the numbers.

Finally, use the hierarchy and entity pages when we need to understand why a specific subsidiary or recipient is being grouped under a parent company.

---

## Interpretation Notes

There are a few things to keep in mind when interpreting the dashboard.

First, very large awards can dominate the visuals. A company with one major contract may appear much larger than a company with many smaller contracts.

Second, some companies may appear to have low totals when the chart is scaled in billions. In those cases, switching the chart display units to millions or thousands makes the smaller companies easier to read.

Third, the parent count in the dashboard only counts parent companies with award records. It may be lower than the number of parent companies in the entity master table because some discovered parents do not have awards in the current award dataset.

Fourth, the dashboard depends on the quality of the parent and child company matching. The refined script improves this by using UEIs and parent-child lookups, but company identity data can still require review.

---

## Closing

Overall, this dashboard gives us a structured way to move from a company list to a federal award picture.

It shows who is receiving awards, how those awards roll up to parent companies, which agencies are issuing the awards, and which specific award records support the totals.

The most useful part is that it connects the summary view to the underlying award details. That lets us use the dashboard for both high-level reporting and deeper review.

