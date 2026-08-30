"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS = [
  "How's our pipeline looking for the Mining sector this quarter?",
  "Which sectors have the most overdue billing?",
  "Prepare a leadership update on pipeline health",
];

function parseInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={idx} className="font-bold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={idx} className="italic text-slate-200">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={idx} className="bg-slate-950 px-1.5 py-0.5 rounded text-xs font-mono text-indigo-300 border border-slate-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMessageText(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="space-y-3.5">
      {blocks.map((block, blockIdx) => {
        if (block.startsWith("### ")) {
          return (
            <h3 key={blockIdx} className="text-sm font-bold text-indigo-400 mt-4 mb-2 first:mt-0 tracking-wide uppercase">
              {parseInline(block.slice(4))}
            </h3>
          );
        }
        if (block.startsWith("## ")) {
          return (
            <h2 key={blockIdx} className="text-base font-bold text-slate-50 mt-5 mb-2.5 first:mt-0 border-b border-slate-800 pb-1">
              {parseInline(block.slice(3))}
            </h2>
          );
        }
        if (block.startsWith("# ")) {
          return (
            <h1 key={blockIdx} className="text-lg font-extrabold text-white mt-6 mb-3 first:mt-0">
              {parseInline(block.slice(2))}
            </h1>
          );
        }
        if (block.startsWith("> ")) {
          const content = block.split("\n").map(line => line.slice(2).trim()).join("\n");
          return (
            <blockquote key={blockIdx} className="border-l-4 border-indigo-500/50 pl-4 py-1 my-3 italic text-slate-400">
              {renderMessageText(content)}
            </blockquote>
          );
        }
        if (block.startsWith("```") && block.endsWith("```")) {
          const lines = block.split("\n");
          const content = lines.slice(1, -1).join("\n");
          return (
            <pre key={blockIdx} className="bg-slate-950 p-3.5 rounded-xl overflow-x-auto my-3 font-mono text-xs text-slate-300 border border-slate-800">
              {content}
            </pre>
          );
        }

        const lines = block.split("\n");
        const isList = lines.every(line => {
          const trimmed = line.trim();
          return trimmed === "" || trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed);
        });

        if (isList) {
          let listType: "ul" | "ol" | null = null;
          const listItems: { text: string; indent: number }[] = [];
          
          lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed === "") return;
            const indent = line.length - line.trimStart().length;
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
              listType = "ul";
              listItems.push({ text: trimmed.slice(2), indent });
            } else {
              const match = trimmed.match(/^(\d+)\.\s(.*)$/);
              if (match) {
                listType = "ol";
                listItems.push({ text: match[2], indent });
              }
            }
          });

          if (listType === "ul") {
            return (
              <ul key={blockIdx} className="list-disc pl-5 space-y-1.5 text-slate-300">
                {listItems.map((item, idx) => (
                  <li key={idx} style={{ marginLeft: `${item.indent * 4}px` }} className="pl-1">
                    {parseInline(item.text)}
                  </li>
                ))}
              </ul>
            );
          } else if (listType === "ol") {
            return (
              <ol key={blockIdx} className="list-decimal pl-5 space-y-1.5 text-slate-300">
                {listItems.map((item, idx) => (
                  <li key={idx} style={{ marginLeft: `${item.indent * 4}px` }} className="pl-1">
                    {parseInline(item.text)}
                  </li>
                ))}
              </ol>
            );
          }
        }

        return (
          <p key={blockIdx} className="leading-relaxed text-slate-300">
            {parseInline(block)}
          </p>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      text:
        "Hi, I'm Skylark's BI agent. I can answer questions about your live Deals and Work Orders data on monday.com — pipeline health, sector performance, billing status, and more. What would you like to know?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const newMessages: Message[] = [...messages, { role: "user", text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: newMessages.slice(0, -1).map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages((m) => [...m, { role: "model", text: `⚠️ ${data.error}` }]);
      } else {
        setMessages((m) => [...m, { role: "model", text: data.reply }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: "model", text: "⚠️ Network error — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500/30 selection:text-indigo-200">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-slate-800/60 px-6 py-4 flex items-center justify-between shadow-lg shadow-black/10">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/10">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-50 via-slate-100 to-slate-300">
              Skylark BI Agent
            </h1>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Monday.com Live Intelligence</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 shadow-inner">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Live Sync</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:py-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-slate-950 to-slate-950">
        <div className="mx-auto max-w-2xl flex flex-col gap-6">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-fadeIn`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-4 text-sm shadow-xl transition-all ${
                  m.role === "user"
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-tr-none border border-indigo-500/20 shadow-indigo-500/5"
                    : "bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none shadow-black/40"
                }`}
              >
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap">{m.text}</div>
                ) : (
                  renderMessageText(m.text)
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-none px-5 py-4 text-sm bg-slate-900 border border-slate-800 text-slate-400 flex items-center gap-3 shadow-xl shadow-black/20">
                <div className="flex space-x-1.5">
                  <div className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-xs font-medium text-slate-400">Querying live boards...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {messages.length <= 1 && (
        <div className="mx-auto max-w-2xl w-full px-4 pb-4">
          <p className="text-[10px] text-slate-500 mb-2.5 font-bold px-1 uppercase tracking-wider">Suggested Queries</p>
          <div className="flex flex-col sm:flex-row gap-2.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="flex-1 text-left text-xs rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700 px-4 py-3.5 text-slate-300 hover:text-white transition-all shadow-sm hover:shadow-indigo-500/5 cursor-pointer active:scale-[0.98]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-900 bg-slate-950/95 backdrop-blur-md px-4 py-4.5">
        <form
          className="mx-auto max-w-2xl flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            className="flex-1 rounded-full border border-slate-800 bg-slate-900/60 px-5 py-3.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            placeholder="Ask about pipeline, overdue billing, sectors..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 active:scale-95 px-6 py-3.5 text-sm font-semibold text-white disabled:opacity-40 disabled:pointer-events-none transition-all shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>Send</span>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
