import { NextRequest, NextResponse } from "next/server";
import { runAgent, type ChatMessage } from "@/lib/agent";

export const maxDuration = 60;

function formatErrorMessage(error: any): string {
  const message = error.message || String(error);
  try {
    const parsed = JSON.parse(message);
    if (parsed.error && parsed.error.message) {
      return parsed.error.message;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch (e) {
    try {
      const parsedClean = JSON.parse(message.trim());
      if (parsedClean.error && parsedClean.error.message) {
        return parsedClean.error.message;
      }
      if (parsedClean.message) {
        return parsedClean.message;
      }
    } catch (e2) {}
  }
  return message;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];
    const message: string = body.message;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing 'message' in request body" }, { status: 400 });
    }

    const reply = await runAgent(history, message);
    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("Chat API error:", err);
    let errMsg = err.message || "Something went wrong talking to the agent.";
    if (errMsg.includes("AI analysis is temporarily unavailable")) {
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
    const formattedMsg = formatErrorMessage(err);
    if (
      formattedMsg.toLowerCase().includes("quota") ||
      formattedMsg.includes("429") ||
      formattedMsg.toLowerCase().includes("limit") ||
      formattedMsg.toLowerCase().includes("exhausted")
    ) {
      errMsg = "AI analysis is temporarily unavailable. Please try again shortly.";
    } else {
      errMsg = formattedMsg;
    }
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
