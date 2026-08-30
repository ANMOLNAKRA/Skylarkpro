# Skylark Drones — AI Business Intelligence Agent

An AI-powered founder-level Business Intelligence agent that connects to
Monday.com and answers conversational questions about sales pipeline,
revenue, work orders, operational performance, sectors, customers, and
business risks.

The agent dynamically reads data from two Monday.com boards:

- Deals Board — sales pipeline and commercial data
- Work Orders Board — project execution and operational data

The system is designed to handle messy real-world business data, including
missing values, inconsistent dates, inconsistent naming, and incomplete
records.

---

## 1. Problem Statement

Business data is often distributed across multiple operational systems and
contains missing or inconsistent values.

A founder may ask questions such as:

- "How is our pipeline looking this quarter?"
- "Which sectors have the highest pipeline value?"
- "Which customers are at risk?"
- "Which projects have operational delays?"
- "How much revenue have we generated?"
- "Which sectors have the highest overdue billing?"
- "What should I focus on this week?"

The agent interprets these questions, retrieves the required information
from Monday.com, cleans and normalizes the data, performs the required
analysis, and returns concise founder-level insights rather than only raw
records.

---

# 2. Core Features

## Monday.com Integration

The application connects to Monday.com using its API.

It reads data dynamically from:

1. Deals Board
2. Work Orders Board

The application does NOT hardcode the CSV dataset.

All business metrics and answers are generated from the current data
available in Monday.com.

### Access Mode

The Monday.com integration is strictly READ-ONLY.

The agent does not:

- Create items
- Update items
- Delete items
- Modify board data
- Change column values

---

# 3. Architecture

```text
                    ┌──────────────────────┐
                    │      Founder/User    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Conversational UI    │
                    │      / Chat          │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Query Understanding  │
                    │                      │
                    │ Intent Detection     │
                    │ Entity Extraction    │
                    │ Time/Quarter Filter  │
                    │ Clarification        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Monday.com Data      │
                    │ Retrieval Layer      │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    ▼                      ▼
          ┌─────────────────┐    ┌─────────────────┐
          │   Deals Board   │    │ Work Orders     │
          │                 │    │ Board           │
          └────────┬────────┘    └────────┬────────┘
                   │                      │
                   └──────────┬───────────┘
                              ▼
                    ┌──────────────────────┐
                    │ Data Resilience      │
                    │ & Normalization      │
                    │                      │
                    │ Null handling        │
                    │ Date normalization   │
                    │ Text normalization   │
                    │ Missing data checks  │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ BI / Analytics Layer │
                    │                      │
                    │ Revenue              │
                    │ Pipeline             │
                    │ Sector performance   │
                    │ Operations           │
                    │ Risks / delays       │
                    │ Data quality         │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ AI Insight Generator │
                    │                      │
                    │ Findings             │
                    │ Context              │
                    │ Risks                │
                    │ Recommendations      │
                    │ Caveats              │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Founder-level Answer │
                    └──────────────────────┘
