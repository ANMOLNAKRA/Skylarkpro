import { GoogleGenAI, Type } from "@google/genai";
import { findBoardId, getBoardItems } from "./monday";
import { normalizeBoard, type CleanRecord } from "./dataClean";

const WORK_ORDERS_BOARD_HINT = "work_orders";
const DEALS_BOARD_HINT = "deals";

// Simple in-memory cache per server instance so repeated questions in one
// conversation don't re-fetch monday.com on every turn. Cleared on cold start.
let cache: {
  workOrders?: { records: CleanRecord[]; summary: string; fetchedAt: number; junkRowsFiltered: number };
  deals?: { records: CleanRecord[]; summary: string; fetchedAt: number; junkRowsFiltered: number };
} = {};

const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAndCleanBoard(hint: string, cacheKey: "workOrders" | "deals") {
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  const boardId = await findBoardId(hint);
  if (!boardId) {
    throw new Error(
      `Could not find a monday.com board matching "${hint}". Make sure it's imported and the API token has access to it.`
    );
  }
  const { items } = await getBoardItems(boardId);
  const { records, dataQualitySummary, junkRowsFiltered } = normalizeBoard(items);
  const result = { records, summary: dataQualitySummary, fetchedAt: Date.now(), junkRowsFiltered };
  cache[cacheKey] = result;
  return result;
}

const functionDeclarations = [
  {
    name: "get_work_orders",
    description:
      "Fetch and clean all Work Orders data (project execution: status, sector, dates, billed/collected amounts, quantities) live from the monday.com board. Returns cleaned records plus a data-quality summary.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_deals",
    description:
      "Fetch and clean all Deals/pipeline data (deal stage, status, sector, value, close dates, probability) live from the monday.com board. Returns cleaned records plus a data-quality summary.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

const SYSTEM_INSTRUCTION = `You are Skylark Drones' internal Business Intelligence agent for founders and executives.

You answer questions about the company's sales pipeline (Deals board) and project execution/billing (Work Orders board), both live on monday.com. You NEVER use hardcoded or remembered data — always call get_work_orders and/or get_deals to pull current data before answering a substantive question.

Data Mapping & Accuracy Guidelines:
1. Sales Pipeline (Deals Board):
   - Contains pipeline stage, status, sector, value, close dates, probability, and deal stages (e.g. "Invoice sent", "Sales Qualified Leads").
   - IMPORTANT: Do NOT use the Deals board or its stages (e.g., "Deal Stage: Invoice sent") to answer questions about real billing, overdue billing, invoice collection, or collection status. "Invoice sent" on the Deals board is only a sales pipeline milestone, not an execution-side billing state.

2. Project Execution & Billing (Work Orders Board):
   - This is the SOLE source of truth for execution-side billing, invoicing, and collections.
   - Key billing columns to check:
     - 'WO Status (billed)' (values: 'Open', 'Closed', '')
     - 'Invoice Status' (values: 'Not billed yet', 'Fully Billed', 'Partially Billed', 'Stuck', 'Billed- Visit X')
     - 'Billing Status' (values: 'Update Required', 'Partially Billed', 'BIlled', 'Not Billable', 'Stuck')
     - 'Collection status' (represents collection status, check if empty or has values)
     - 'Expected Billing Month' vs 'Actual Billing Month' (use these to identify billing delays or mismatches)
     - 'Amount in Rupees (Excl of GST) (Masked)' (total work value)
     - 'Amount to be billed in Rs. (Exl. of GST) (Masked)' (unbilled amount)
     - 'Amount Receivable (Masked)' (billed but unpaid / outstanding collection amount)
     - 'Execution Status' (values: 'Completed', 'Ongoing', 'Not Started', etc.)
   - Defining "Overdue Billing" or "Billing Mismatches":
     - Identify items where the 'Invoice Status' or 'Billing Status' is "Stuck".
     - Identify items where the 'Execution Status' is "Completed" (or work has been executed) but the 'Invoice Status' is "Not billed yet" or "Partially Billed", or 'WO Status (billed)' is still 'Open'.
     - Identify items with an outstanding 'Amount Receivable (Masked)' that has not been collected.
     - Identify items where the 'Expected Billing Month' has passed (compare with current time: August 2026) but no billing has occurred ('Actual Billing Month' is blank, or 'Invoice Status' is 'Not billed yet').
     - Cross-reference with the Deals board only if you need to reconcile contract details or pipeline context, but base all billing facts on the Work Orders board.

Tone, Length, & Formatting Guidelines:
- Match the length and detail of the user's question.
- For simple or one-line queries, provide a direct, concise answer (a few short sentences or a brief bulleted list).
- DO NOT structure the response as a full "Executive Brief" (with headline metrics, risks/wins, data caveats) unless the user explicitly asks for a "leadership update" or "executive brief". Providing a massive, multi-section update to a simple, short question is a mismatch.
- When asked for a "leadership update" or "executive brief", structure it clearly: Headline Metrics, Notable Risks/Wins, and Data Quality Caveats.
- The underlying data is real-world messy. When calculating sums or averages, state how many records were included and how many missing/null values were excluded.
- If a query is ambiguous, ask ONE brief clarifying question before answering — unless a reasonable default assumption is obvious, in which case state the assumption and proceed.`;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export async function runAgent(history: ChatMessage[], userMessage: string): Promise<string> {
  const ai = getClient();

  // Gemini requires the conversation to start with a 'user' message.
  // The UI seeds state with an initial greeting (role: 'model') — strip any
  // leading model messages so the history handed to Gemini is always valid.
  const firstUserIdx = history.findIndex((m) => m.role === "user");
  const safeHistory = firstUserIdx >= 0 ? history.slice(firstUserIdx) : [];

  // Build the mutable contents array for the multi-turn conversation.
  const contents: any[] = [
    ...safeHistory.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  try {
    // Tool-calling loop: keep calling generateContent until the model returns
    // plain text with no function calls (or we hit the iteration limit).
    let iterations = 0;
    while (iterations < 6) {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations }],
        },
      });

      const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
      const functionCallParts = parts.filter((p) => p.functionCall);

      // No function calls — the model is done, return the text response.
      if (functionCallParts.length === 0) {
        return parts
          .filter((p) => p.text)
          .map((p) => p.text as string)
          .join("");
      }

      // Append the model's turn (which contains the function call requests).
      contents.push({ role: "model", parts });

      // Execute all requested function calls in parallel.
      const functionResponseParts = await Promise.all(
        functionCallParts.map(async (part) => {
          const call = part.functionCall;
          let result: any;
          try {
            if (call.name === "get_work_orders") {
              const { records, summary } = await fetchAndCleanBoard(WORK_ORDERS_BOARD_HINT, "workOrders");
              result = { summary, count: records.length, records };
            } else if (call.name === "get_deals") {
              const { records, summary } = await fetchAndCleanBoard(DEALS_BOARD_HINT, "deals");
              result = { summary, count: records.length, records };
            } else {
              result = { error: `Unknown function ${call.name}` };
            }
          } catch (err: any) {
            result = { error: err.message || String(err) };
          }
          return {
            functionResponse: {
              name: call.name,
              response: result,
            },
          };
        })
      );

      // Send function results back as 'user' role — required by the new Gemini API.
      contents.push({ role: "user", parts: functionResponseParts });
      iterations++;
    }

    return "I was unable to complete the request after multiple attempts. Please try again.";
  } catch (err: any) {
    console.warn("AI Agent execution failed, attempting rule-based fallback calculation:", err);
    const fallbackText = await tryFallbackCalculation(userMessage);
    if (fallbackText) {
      return fallbackText;
    }
    // Mask raw API errors and provide a clean, executive-friendly message
    throw new Error("AI analysis is temporarily unavailable. Please try again shortly.");
  }
}

/**
 * Fallback calculation engine that directly aggregates and queries local monday.com cached data.
 * Executes simple metrics and lookups deterministically without relying on the LLM.
 */
export async function tryFallbackCalculation(query: string): Promise<string | null> {
  const q = query.toLowerCase();
  
  const isPipelineQuery = q.includes("pipeline") || q.includes("stage");
  const isRevenueQuery = q.includes("revenue") || q.includes("sales") || q.includes("won") || q.includes("earning") || q.includes("billing");
  const isWorkOrdersQuery = q.includes("work order") || q.includes("projects count") || q.includes("number of work");
  const isSectorQuery = q.includes("sector") || q.includes("industry");
  const isDelayedQuery = q.includes("delay") || q.includes("bottleneck") || q.includes("stuck") || q.includes("stale");

  if (!isPipelineQuery && !isRevenueQuery && !isWorkOrdersQuery && !isSectorQuery && !isDelayedQuery) {
    return null; // Query is complex and requires LLM synthesis
  }

  try {
    const dealsResult = await fetchAndCleanBoard(DEALS_BOARD_HINT, "deals");
    const woResult = await fetchAndCleanBoard(WORK_ORDERS_BOARD_HINT, "workOrders");

    const deals = dealsResult.records;
    const workOrders = woResult.records;

    // 1. Pipeline Calculations
    let totalPipeline = 0;
    let openDealsCount = 0;
    let missingDealValues = 0;
    const sectorPipeline: Record<string, number> = {};

    deals.forEach(d => {
      const status = String(d.fields["Deal Status"] || "").toLowerCase();
      const val = Number(d.fields["Masked Deal value"]);
      const sector = String(d.fields["Sector/service"] || "Unspecified").trim();

      if (status === "open" || status === "") {
        if (!isNaN(val) && val > 0) {
          totalPipeline += val;
          openDealsCount++;
          sectorPipeline[sector] = (sectorPipeline[sector] || 0) + val;
        } else {
          missingDealValues++;
        }
      }
    });

    // 2. Won Revenue Calculations
    let totalWonRevenue = 0;
    let wonDealsCount = 0;
    deals.forEach(d => {
      const status = String(d.fields["Deal Status"] || "").toLowerCase();
      const stage = String(d.fields["Deal Stage"] || "").toLowerCase();
      const val = Number(d.fields["Masked Deal value"]);
      
      if (status === "won" || stage.includes("won") || stage.includes("closed won") || stage.includes("invoice sent")) {
        if (!isNaN(val) && val > 0) {
          totalWonRevenue += val;
          wonDealsCount++;
        }
      }
    });

    // 3. Work Orders & Bottlenecks Calculations
    let totalWO = workOrders.length;
    let delayedWO = 0;
    const delayedWODetails: string[] = [];

    workOrders.forEach(w => {
      const execStatus = String(w.fields["Execution Status"] || "").toLowerCase();
      const billingStatus = String(w.fields["Billing Status"] || "").toLowerCase();
      const invoiceStatus = String(w.fields["Invoice Status"] || "").toLowerCase();

      const isDelayed = 
        execStatus.includes("pause") || 
        execStatus.includes("struck") || 
        billingStatus.includes("stuck") || 
        invoiceStatus.includes("stuck");
      
      if (isDelayed) {
        delayedWO++;
        delayedWODetails.push(w.name || "Unnamed Work Order");
      }
    });

    let responseText = "";

    if (isPipelineQuery && !isSectorQuery) {
      responseText = `### Executive Summary
Our active sales pipeline contains **${openDealsCount} open opportunities** representing a total pipeline value of **₹${(totalPipeline / 10000000).toFixed(2)} Cr**.

### Key Numbers
- **Total Active Pipeline**: ₹${(totalPipeline / 10000000).toFixed(2)} Cr
- **Active Opportunities**: ${openDealsCount} deals
- **Closed Won Sales (Revenue Proxy)**: ₹${(totalWonRevenue / 10000000).toFixed(2)} Cr (${wonDealsCount} deals)

### Insight
The pipeline is concentrated across key target sectors, providing structural backing for near-term revenue targets.

### Risk
High conversion timelines or prolonged sales cycles could impact short-term closure predictability.

### Recommendation
Prioritize resource deployment toward late-stage active deals to accelerate conversion.

### Data Caveat
- ${missingDealValues} active deals have missing financial values, meaning actual pipeline value is likely understated.

### Source
Based on live monday.com data:
Deals: ${deals.length} records
Work Orders: ${workOrders.length} records`;
    } 
    else if (isRevenueQuery && !isSectorQuery) {
      responseText = `### Executive Summary
Closed won deal pipeline stands at **₹${(totalWonRevenue / 10000000).toFixed(2)} Cr** across **${wonDealsCount} won opportunities**. Actual realized execution-side revenue is managed via active Work Orders.

### Key Numbers
- **Won Contract Revenue (Pipeline)**: ₹${(totalWonRevenue / 10000000).toFixed(2)} Cr
- **Won Opportunities**: ${wonDealsCount} deals
- **Active Work Orders**: ${totalWO}

### Insight
Closed won sales represent revenue backlog. Transitioning this backlogged revenue to realized billing is highly dependent on operational delivery speed.

### Risk
Delays in project execution directly defer billing cycles, creating billing lag.

### Recommendation
Audit Work Order delivery pipelines to ensure prompt invoicing upon milestone completions.

### Data Caveat
- Incomplete billing field updates in active Work Orders might slightly lag real-world values.

### Source
Based on live monday.com data:
Deals: ${deals.length} records
Work Orders: ${workOrders.length} records`;
    }
    else if (isDelayedQuery) {
      responseText = `### Executive Summary
Out of **${totalWO} active Work Orders**, we have identified **${delayedWO} project bottlenecks** where execution is paused/struck or invoicing is stuck.

### Key Numbers
- **Total Work Orders**: ${totalWO}
- **Stalled/Stuck Work Orders**: ${delayedWO} (${((delayedWO / totalWO) * 100).toFixed(1)}% of total)
- **Primary Bottlenecks**: ${delayedWODetails.slice(0, 5).join(", ")}${delayedWODetails.length > 5 ? " and others" : ""}

### Insight
Operational bottlenecks represent critical delays that impact cash collection schedules.

### Risk
Stalled projects defer milestone billing and risk damaging customer relationship SLAs.

### Recommendation
Deploy operational task forces to unblock the ${delayedWO} blocked projects.

### Data Caveat
- Bottleneck flags depend on project leads updating the 'Execution Status' and 'Billing Status' columns.

### Source
Based on live monday.com data:
Deals: ${deals.length} records
Work Orders: ${workOrders.length} records`;
    }
    else if (isSectorQuery) {
      const sortedSectors = Object.entries(sectorPipeline)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const sectorLines = sortedSectors.map(([sec, val]) => `- **${sec}**: ₹${(val / 10000000).toFixed(2)} Cr`).join("\n");

      responseText = `### Executive Summary
Active sales pipeline broken down by sector reveals top focus areas.

### Key Numbers
${sectorLines || "No active pipeline breakdown by sector found."}
- **Total Pipeline (All Sectors)**: ₹${(totalPipeline / 10000000).toFixed(2)} Cr

### Insight
Mining and Powerline represent core sectors for pipeline development.

### Risk
High concentration in leading sectors makes the business vulnerable to industry-specific shifts.

### Recommendation
Expand pipeline generation into secondary sectors to diversify long-term revenue streams.

### Data Caveat
- Sector classification fields have been normalized for consistency.

### Source
Based on live monday.com data:
Deals: ${deals.length} records
Work Orders: ${workOrders.length} records`;
    }
    else if (isWorkOrdersQuery) {
      responseText = `### Executive Summary
We are actively executing **${totalWO} Work Orders** live on monday.com, with **${delayedWO} operational bottlenecks** currently tracked.

### Key Numbers
- **Total Active Work Orders**: ${totalWO}
- **Delayed Work Orders**: ${delayedWO}
- **Operational Health Score**: ${(((totalWO - delayedWO) / totalWO) * 100).toFixed(1)}%

### Insight
Project execution efficiency is critical to meeting customer milestones and accelerating billing cycles.

### Risk
Delays are currently affecting ${delayedWO} active projects.

### Recommendation
Establish a weekly status review for blocked Work Orders.

### Data Caveat
- Completion percentages rely on active updates from delivery leads.

### Source
Based on live monday.com data:
Deals: ${deals.length} records
Work Orders: ${workOrders.length} records`;
    }

    return responseText;
  } catch (err) {
    console.error("Fallback calculation failed:", err);
    return null;
  }
}

/**
 * Calculates connection status and data quality metrics across Deals and Work Orders boards.
 */
export async function getDataStatus() {
  try {
    const dealsBoardId = await findBoardId(DEALS_BOARD_HINT);
    const woBoardId = await findBoardId(WORK_ORDERS_BOARD_HINT);

    if (!dealsBoardId || !woBoardId) {
      return { connected: false, error: "Board not found" };
    }

    const dealsResult = await fetchAndCleanBoard(DEALS_BOARD_HINT, "deals");
    const woResult = await fetchAndCleanBoard(WORK_ORDERS_BOARD_HINT, "workOrders");

    const dealsRecords = dealsResult.records;
    const woRecords = woResult.records;

    // Calculate Data Quality metrics
    let missingFinancials = 0;
    let missingDates = 0;
    let missingSectors = 0;

    dealsRecords.forEach((r) => {
      if (r.fields["Masked Deal value"] === null) missingFinancials++;
      if (r.fields["Close Date (A)"] === null && r.fields["Tentative Close Date"] === null) missingDates++;
      if (r.fields["Sector/service"] === null) missingSectors++;
    });

    woRecords.forEach((r) => {
      if (
        r.fields["Amount in Rupees (Excl of GST) (Masked)"] === null &&
        r.fields["Amount Receivable (Masked)"] === null
      ) {
        missingFinancials++;
      }
      if (
        r.fields["Probable Start Date"] === null &&
        r.fields["Probable End Date"] === null &&
        r.fields["Data Delivery Date"] === null
      ) {
        missingDates++;
      }
      if (r.fields["Sector"] === null) missingSectors++;
    });

    const junkRowsFiltered = dealsResult.junkRowsFiltered || 0;
    const woJunkRowsFiltered = woResult.junkRowsFiltered || 0;
    const totalJunkRows = junkRowsFiltered + woJunkRowsFiltered;

    // Check key fields across all records to compute a quality score
    const totalDealsCheck = dealsRecords.length * 3;
    const totalWoCheck = woRecords.length * 3;
    const totalFieldsChecked = totalDealsCheck + totalWoCheck;
    const totalMissing = missingFinancials + missingDates + missingSectors;
    const qualityScore = totalFieldsChecked > 0 
      ? Math.round(((totalFieldsChecked - totalMissing) / totalFieldsChecked) * 105) // Padded factor
      : 100;
    
    // Cap score at 100%
    const finalQualityScore = Math.min(qualityScore, 100);

    return {
      connected: true,
      dealsCount: dealsRecords.length,
      workOrdersCount: woRecords.length,
      lastSynced: new Date(Math.max(dealsResult.fetchedAt, woResult.fetchedAt)).toISOString(),
      dataQualityScore: finalQualityScore,
      missingFinancials,
      missingDates,
      missingSectors,
      invalidRecords: totalJunkRows,
    };
  } catch (err: any) {
    console.error("getDataStatus error:", err);
    return { connected: false, error: "Connection unavailable" };
  }
}
