"use client";

import { useState, useEffect, useCallback, useRef, ChangeEvent } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  format, parseISO, isWithinInterval,
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
} from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, X, BookOpen, Target, AlertTriangle, Lightbulb,
  Activity, BarChart2, Award, Trash2, TrendingUp, TrendingDown,
  Calendar, ChevronDown, Upload, Download, Edit2,
  Flame, Snowflake, FileText, Smile, Meh, Frown,
} from "lucide-react";
import type { Trade, Lesson, JournalEntry, LessonCategory, LessonSeverity, Mood } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const fmt = (n: number) =>
  (n >= 0 ? "+" : "") + n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtAbs = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

function tradePnl(t: Trade): number {
  if (!t.exitPrice) return 0;
  const raw = (t.exitPrice - t.entryPrice) * t.shares;
  return (t.direction === "SHORT" ? -raw : raw) - (t.commission ?? 0);
}

function tradeDuration(t: Trade): string | null {
  if (!t.entryTime || !t.exitTime) return null;
  const [eh, em] = t.entryTime.split(":").map(Number);
  const [xh, xm] = t.exitTime.split(":").map(Number);
  const mins = (xh * 60 + xm) - (eh * 60 + em);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERIOD
// ═══════════════════════════════════════════════════════════════════════════════

type Period = "today" | "week" | "month" | "ytd" | "all";
const PERIOD_LABELS: Record<Period, string> = {
  today: "Today", week: "This Week", month: "This Month", ytd: "Year to Date", all: "All Time",
};

function getInterval(period: Period) {
  const now = new Date();
  switch (period) {
    case "today": return { start: startOfDay(now),   end: endOfDay(now) };
    case "week":  return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "ytd":   return { start: startOfYear(now),  end: endOfYear(now) };
    case "all":   return null;
  }
}

function filterByPeriod<T extends { date: string }>(items: T[], period: Period): T[] {
  const iv = getInterval(period);
  if (!iv) return items;
  return items.filter(t => isWithinInterval(parseISO(t.date), iv));
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function calcMaxDrawdown(trades: Trade[]): number {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let peak = 0, maxDD = 0, running = 0;
  for (const t of sorted) {
    running += tradePnl(t);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcStreak(trades: Trade[]): { count: number; type: "win" | "loss" | "none" } {
  const sorted = [...trades.filter(t => t.status === "CLOSED")]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!sorted.length) return { count: 0, type: "none" };
  const first = tradePnl(sorted[0]);
  const type = first >= 0 ? "win" : "loss";
  let count = 0;
  for (const t of sorted) {
    const p = tradePnl(t);
    if ((type === "win" && p >= 0) || (type === "loss" && p < 0)) count++;
    else break;
  }
  return { count, type };
}

function calcLongestLosingStreak(trades: Trade[]): number {
  const sorted = [...trades.filter(t => t.status === "CLOSED")]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let max = 0, cur = 0;
  for (const t of sorted) {
    if (tradePnl(t) < 0) { cur++; max = Math.max(max, cur); } else cur = 0;
  }
  return max;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function parseCSVLine(line: string): string[] {
  const res: string[] = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  res.push(cur.trim());
  return res;
}

function cleanNum(s: string): number {
  const cleaned = s.replace(/[$, ]/g, "").replace(/^\((.+)\)$/, "-$1");
  return parseFloat(cleaned) || 0;
}

function toISODate(s: string): string {
  // MM/DD/YYYY → YYYY-MM-DD
  const p = s.trim().split("/");
  if (p.length === 3) return `${p[2]}-${p[0].padStart(2,"0")}-${p[1].padStart(2,"0")}`;
  return s.trim();
}

interface RawRow { date: string; action: string; symbol: string; qty: number; price: number; fees: number; }

function matchPairs(opens: RawRow[], closes: RawRow[], dir: "LONG"|"SHORT", date: string, symbol: string): Trade[] {
  const trades: Trade[] = [];
  const oQ = [...opens], cQ = [...closes];
  while (oQ.length && cQ.length) {
    const o = oQ.shift()!, c = cQ.shift()!;
    const shares = Math.min(o.qty, c.qty);
    trades.push({
      id: uuidv4(), date, ticker: symbol, direction: dir,
      entryPrice: o.price, exitPrice: c.price, shares,
      commission: (o.fees || 0) + (c.fees || 0),
      status: "CLOSED", setup: "", notes: "Imported from CSV",
      createdAt: new Date().toISOString(),
    });
    if (o.qty > shares) oQ.unshift({ ...o, qty: o.qty - shares, fees: 0 });
    if (c.qty > shares) cQ.unshift({ ...c, qty: c.qty - shares, fees: 0 });
  }
  return trades;
}

function importSchwebCSV(text: string): { trades: Trade[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const hi = lines.findIndex(l => /date/i.test(l) && /action/i.test(l) && /symbol/i.test(l));
  if (hi === -1) return { trades: [], errors: ["Could not find header row. Expected columns: Date, Action, Symbol, Quantity, Price, Fees."] };

  const headers = parseCSVLine(lines[hi]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (...names: string[]) => {
    for (const n of names) { const i = headers.findIndex(h => h.includes(n)); if (i >= 0) return i; }
    return -1;
  };

  const dateC   = col("date");
  const actionC = col("action");
  const symC    = col("symbol", "sym");
  const qtyC    = col("quantity", "qty", "shares");
  const priceC  = col("price");
  const feesC   = col("fees", "comm");

  if ([dateC, actionC, symC, qtyC, priceC].includes(-1)) {
    return { trades: [], errors: ["Missing required columns. Need: Date, Action, Symbol, Quantity, Price."] };
  }

  const rows: RawRow[] = [];
  for (const l of lines.slice(hi + 1)) {
    const r = parseCSVLine(l);
    if (!r[symC] || r[symC] === "Symbol") continue;
    rows.push({
      date:   toISODate(r[dateC] || ""),
      action: (r[actionC] || "").toLowerCase().trim(),
      symbol: (r[symC] || "").toUpperCase().trim(),
      qty:    Math.abs(cleanNum(r[qtyC] || "0")),
      price:  Math.abs(cleanNum(r[priceC] || "0")),
      fees:   feesC >= 0 ? Math.abs(cleanNum(r[feesC] || "0")) : 0,
    });
  }

  const groups: Record<string, RawRow[]> = {};
  for (const r of rows) {
    if (!r.date || !r.symbol || r.price <= 0) continue;
    const k = `${r.date}_${r.symbol}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }

  const trades: Trade[] = [];
  for (const [key, group] of Object.entries(groups)) {
    const [date, symbol] = key.split("_");
    const isLongBuy   = (a: string) => a === "buy" || a === "buy to open";
    const isLongSell  = (a: string) => a === "sell" || a === "sell to close";
    const isShortSell = (a: string) => a.includes("sell short") || a === "short";
    const isShortCover= (a: string) => a.includes("buy to cover") || a.includes("cover");

    const longBuys   = group.filter(r => isLongBuy(r.action));
    const longSells  = group.filter(r => isLongSell(r.action));
    const shortSells = group.filter(r => isShortSell(r.action));
    const shortCovers= group.filter(r => isShortCover(r.action));

    trades.push(...matchPairs(longBuys, longSells, "LONG", date, symbol));
    trades.push(...matchPairs(shortSells, shortCovers, "SHORT", date, symbol));

    const unmatched = group.filter(r =>
      !isLongBuy(r.action) && !isLongSell(r.action) &&
      !isShortSell(r.action) && !isShortCover(r.action)
    );
    if (unmatched.length) errors.push(`${symbol} on ${date}: skipped ${unmatched.length} unrecognized row(s)`);
  }

  if (!trades.length && !errors.length) errors.push("No matching buy/sell pairs found.");
  return { trades, errors };
}

function exportToCSV(trades: Trade[]) {
  const headers = ["Date","EntryTime","ExitTime","Duration","Ticker","Direction","Entry","Exit","Shares","Commission","P&L","Setup","Notes","Status"];
  const rows = trades.map(t => [
    t.date, t.entryTime ?? "", t.exitTime ?? "", tradeDuration(t) ?? "",
    t.ticker, t.direction,
    t.entryPrice, t.exitPrice ?? "",
    t.shares, t.commission,
    t.status === "CLOSED" ? tradePnl(t).toFixed(2) : "",
    `"${t.setup}"`, `"${t.notes}"`, t.status,
  ]);
  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tradelog-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED & CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const SEED_TRADES: Trade[] = [
  { id:"seed-1", date:"2026-06-04", ticker:"BB", direction:"LONG", entryPrice:9.95, exitPrice:10.076, shares:3000, commission:1.21, status:"CLOSED", setup:"Momentum", notes:"Bought 3000 shares, sold into strength", createdAt:"2026-06-04T10:00:00Z", entryTime:"09:35", exitTime:"10:12" },
  { id:"seed-2", date:"2026-06-04", ticker:"BB", direction:"LONG", entryPrice:9.01, exitPrice:9.64, shares:2500, commission:0.99, status:"CLOSED", setup:"Pullback re-entry", notes:"Second BB trade on same day, bought dip", createdAt:"2026-06-04T11:00:00Z", entryTime:"10:28", exitTime:"11:43" },
  { id:"seed-3", date:"2026-06-02", ticker:"HPE", direction:"SHORT", entryPrice:59.9205, exitPrice:56.0925, shares:300, commission:0.43, status:"CLOSED", setup:"Short sell", notes:"Sold short 300 @ 59.9205, covered: 150 @ 55.605 + 150 @ 56.58 (blended exit $56.0925)", createdAt:"2026-06-02T10:00:00Z", entryTime:"09:32", exitTime:"11:28" },
];

const SEVERITY_CONFIG: Record<LessonSeverity, { color: string; bg: string; icon: JSX.Element; label: string }> = {
  critical: { color:"text-red-400",    bg:"bg-red-400/10 border-red-400/30",       icon:<AlertTriangle size={14}/>, label:"Mistake"   },
  warning:  { color:"text-yellow-400", bg:"bg-yellow-400/10 border-yellow-400/30", icon:<Target size={14}/>,        label:"Watch Out" },
  insight:  { color:"text-indigo-400", bg:"bg-indigo-400/10 border-indigo-400/30", icon:<Lightbulb size={14}/>,     label:"Insight"   },
};

const CATEGORY_COLORS: Record<LessonCategory, string> = {
  "Risk Management":"#6366f1","Entry":"#06b6d4","Exit":"#10b981",
  "Psychology":"#f59e0b","Setup":"#8b5cf6","Other":"#6b7280",
};

const MOOD_CONFIG: Record<Mood, { icon: JSX.Element; label: string; color: string }> = {
  great:   { icon:<Smile size={16}/>,   label:"Great",   color:"text-emerald-400" },
  good:    { icon:<Smile size={16}/>,   label:"Good",    color:"text-green-400"   },
  neutral: { icon:<Meh size={16}/>,     label:"Neutral", color:"text-gray-400"    },
  bad:     { icon:<Frown size={16}/>,   label:"Bad",     color:"text-orange-400"  },
  terrible:{ icon:<Frown size={16}/>,   label:"Terrible",color:"text-red-400"     },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PERIOD DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════

function PeriodDropdown({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-bold text-indigo-300 hover:text-white bg-indigo-500/20 hover:bg-indigo-500/35 border border-indigo-500/40 hover:border-indigo-400/60 px-3 py-1.5 rounded-lg transition-all">
        <Calendar size={13}/> {PERIOD_LABELS[period]}
        <ChevronDown size={13} className={`transition-transform ${open?"rotate-180":""}`}/>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[150px] rounded-xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
          {(Object.entries(PERIOD_LABELS) as [Period,string][]).map(([p,label]) => (
            <button key={p} onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-xs font-semibold transition-colors flex items-center justify-between gap-3
                ${period===p ? "bg-indigo-600/20 text-indigo-300" : "text-gray-400 hover:bg-gray-800 hover:text-white"}`}>
              {label} {period===p && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"/>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, sub, icon, positive, neutral, topRight }: {
  label: string; value: string; sub?: string; icon?: React.ReactNode;
  positive?: boolean; neutral?: boolean; topRight?: React.ReactNode;
}) {
  const color = neutral ? "text-gray-300" : positive ? "text-emerald-400" : "text-red-400";
  const glow  = neutral ? "" : positive ? "glow-green" : "glow-red";
  return (
    <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${glow}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">{label}</span>
        {topRight ?? <span className="text-gray-600">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold font-mono ${color} animate-count`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE ROW (mobile-responsive card)
// ═══════════════════════════════════════════════════════════════════════════════

function TradeRow({ trade, onDelete, onEdit }: {
  trade: Trade; onDelete: (id: string) => void; onEdit: (t: Trade) => void;
}) {
  const pnl   = tradePnl(trade);
  const isPos = pnl >= 0;
  const pnlPct = trade.exitPrice
    ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.direction === "SHORT" ? -1 : 1)
    : null;

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[80px_80px_60px_90px_90px_75px_65px_1fr_60px] gap-2 items-center px-4 py-3 rounded-lg border border-gray-800 bg-gray-900/60 hover:bg-gray-900 transition-colors text-sm">
        <span className="text-gray-400 text-xs">{format(parseISO(trade.date),"MMM d")}</span>
        <span className="font-bold text-white tracking-wide">{trade.ticker}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${trade.direction==="LONG" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"}`}>
          {trade.direction}
        </span>
        <span className="font-mono text-gray-300">${trade.entryPrice.toFixed(2)}</span>
        <span className="font-mono text-gray-300">{trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : <span className="text-yellow-400 text-xs">OPEN</span>}</span>
        <span className="font-mono text-gray-400">{trade.shares.toLocaleString()}</span>
        <span className="font-mono text-xs text-indigo-300/80">{tradeDuration(trade) ?? <span className="text-gray-700">—</span>}</span>
        <div>
          {trade.exitPrice ? (
            <span className={`font-mono font-bold ${isPos?"text-emerald-400":"text-red-400"}`}>
              {fmt(pnl)}{" "}{pnlPct!==null&&<span className="text-xs opacity-70">({pct(pnlPct)})</span>}
              {trade.commission>0&&<span className="text-gray-600 text-xs ml-1">-${trade.commission.toFixed(2)}</span>}
            </span>
          ) : <span className="text-yellow-400 text-xs font-semibold">OPEN</span>}
          {trade.notes && <p className="text-gray-500 text-xs truncate max-w-[220px]">{trade.notes}</p>}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => onEdit(trade)} className="text-gray-600 hover:text-indigo-400 transition-colors"><Edit2 size={13}/></button>
          <button onClick={() => onDelete(trade.id)} className="text-gray-600 hover:text-red-400 transition-colors"><Trash2 size={13}/></button>
        </div>
      </div>

      {/* Mobile card */}
      <div className="md:hidden rounded-lg border border-gray-800 bg-gray-900/60 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">{trade.ticker}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${trade.direction==="LONG"?"bg-emerald-400/10 text-emerald-400":"bg-red-400/10 text-red-400"}`}>
              {trade.direction}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{format(parseISO(trade.date),"MMM d")}</span>
            <button onClick={() => onEdit(trade)} className="text-gray-600 hover:text-indigo-400"><Edit2 size={13}/></button>
            <button onClick={() => onDelete(trade.id)} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div><span className="text-gray-600">Entry</span><div className="font-mono text-gray-300">${trade.entryPrice.toFixed(2)}</div></div>
          <div><span className="text-gray-600">Exit</span><div className="font-mono text-gray-300">{trade.exitPrice?`$${trade.exitPrice.toFixed(2)}`:<span className="text-yellow-400">OPEN</span>}</div></div>
          <div><span className="text-gray-600">Shares</span><div className="font-mono text-gray-400">{trade.shares.toLocaleString()}</div></div>
          <div><span className="text-gray-600">Duration</span><div className="font-mono text-indigo-300/80">{tradeDuration(trade) ?? "—"}</div></div>
        </div>
        {trade.exitPrice && (
          <div className={`font-mono font-bold text-sm ${isPos?"text-emerald-400":"text-red-400"}`}>
            {fmt(pnl)} {pnlPct!==null&&<span className="text-xs opacity-70">({pct(pnlPct)})</span>}
          </div>
        )}
        {trade.notes && <p className="text-gray-500 text-xs">{trade.notes}</p>}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LESSON CARD
// ═══════════════════════════════════════════════════════════════════════════════

function LessonCard({ lesson, onDelete }: { lesson: Lesson; onDelete: (id: string) => void }) {
  const cfg = SEVERITY_CONFIG[lesson.severity];
  return (
    <div className={`relative rounded-xl p-4 border ${cfg.bg} group`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`flex items-center gap-1 text-xs font-semibold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400"
            style={{ borderLeft:`3px solid ${CATEGORY_COLORS[lesson.category]}` }}>{lesson.category}</span>
          <span className="text-xs text-gray-600">{format(parseISO(lesson.date),"MMM d, yyyy")}</span>
        </div>
        <button onClick={() => onDelete(lesson.id)} className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"><Trash2 size={13}/></button>
      </div>
      <h4 className="mt-2 font-semibold text-white text-sm">{lesson.title}</h4>
      <p className="mt-1 text-gray-400 text-xs leading-relaxed">{lesson.description}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNAL CARD
// ═══════════════════════════════════════════════════════════════════════════════

function JournalCard({ entry, onDelete, onEdit }: {
  entry: JournalEntry; onDelete: (id: string) => void; onEdit: (e: JournalEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mood = MOOD_CONFIG[entry.mood];
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 group">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-400">{format(parseISO(entry.date),"EEE, MMM d yyyy")}</span>
          <span className={`flex items-center gap-1 text-xs ${mood.color}`}>{mood.icon} {mood.label}</span>
          {entry.maxLossTarget > 0 && (
            <span className="text-xs text-gray-600">Max loss: <span className="text-red-400 font-mono">-${entry.maxLossTarget}</span></span>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
          <button onClick={e=>{e.stopPropagation();onEdit(entry)}} className="text-gray-600 hover:text-indigo-400"><Edit2 size={13}/></button>
          <button onClick={e=>{e.stopPropagation();onDelete(entry.id)}} className="text-gray-600 hover:text-red-400"><Trash2 size={13}/></button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3">
          {entry.watchlist && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-widest">Watchlist</div>
              <div className="flex flex-wrap gap-1.5">
                {entry.watchlist.split(",").map(t => (
                  <span key={t} className="px-2 py-0.5 rounded bg-gray-800 text-xs font-mono text-indigo-300">{t.trim()}</span>
                ))}
              </div>
            </div>
          )}
          {entry.premarketPlan && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-widest">Pre-Market Plan</div>
              <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{entry.premarketPlan}</p>
            </div>
          )}
          {entry.postmarketReview && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-widest">End-of-Day Review</div>
              <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{entry.postmarketReview}</p>
            </div>
          )}
          {entry.focusLevel > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Focus:</span>
              {[1,2,3,4,5].map(i => (
                <span key={i} className={`w-3 h-3 rounded-sm ${i<=entry.focusLevel?"bg-indigo-500":"bg-gray-700"}`}/>
              ))}
              <span className="text-xs text-gray-500">{entry.focusLevel}/5</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV IMPORT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function CSVImportModal({ onImport, onClose }: {
  onImport: (trades: Trade[]) => void; onClose: () => void;
}) {
  const [preview, setPreview] = useState<Trade[] | null>(null);
  const [errors, setErrors]   = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const { trades, errors } = importSchwebCSV(text);
      setPreview(trades);
      setErrors(errors);
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="Import Trades from CSV" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-gray-600 bg-gray-800/50 p-6 text-center">
          <Upload size={24} className="mx-auto mb-2 text-gray-500"/>
          <p className="text-sm text-gray-400 mb-1">Upload your broker CSV export</p>
          <p className="text-xs text-gray-600 mb-3">Supports Schwab / TD Ameritrade / thinkorswim format</p>
          <label className="cursor-pointer px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
            Choose File
            <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile}/>
          </label>
          {fileName && <p className="mt-2 text-xs text-gray-500">{fileName}</p>}
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-3">
          <p className="text-xs font-semibold text-gray-400 mb-1">How to export from thinkorswim:</p>
          <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
            <li>Open thinkorswim → Monitor tab → Account Statement</li>
            <li>Select your date range</li>
            <li>Click the export icon (↓) → Save as CSV</li>
          </ol>
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3 space-y-1">
            {errors.map((e,i) => <p key={i} className="text-xs text-yellow-400">{e}</p>)}
          </div>
        )}

        {preview && preview.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold">{preview.length} trade{preview.length!==1?"s":""} found — preview:</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {preview.slice(0,10).map(t => (
                <div key={t.id} className="flex items-center justify-between text-xs px-3 py-2 rounded bg-gray-800">
                  <span className="text-gray-400">{t.date}</span>
                  <span className="font-bold text-white">{t.ticker}</span>
                  <span className={t.direction==="LONG"?"text-emerald-400":"text-red-400"}>{t.direction}</span>
                  <span className="font-mono text-gray-300">${t.entryPrice.toFixed(2)} → ${t.exitPrice?.toFixed(2)}</span>
                  <span className="font-mono font-bold text-gray-300">{t.shares.toLocaleString()}</span>
                </div>
              ))}
              {preview.length > 10 && <p className="text-xs text-gray-600 text-center">+{preview.length-10} more</p>}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={() => { onImport(preview); onClose(); }}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors">
                Import {preview.length} Trade{preview.length!==1?"s":""}
              </button>
            </div>
          </div>
        )}

        {preview && preview.length === 0 && !errors.length && (
          <p className="text-center text-xs text-gray-500">No trades detected in this file.</p>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  const [trades,  setTrades]  = useState<Trade[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [tab,     setTab]     = useState<"trades"|"analytics"|"journal"|"lessons">("trades");
  const [period,  setPeriod]  = useState<Period>("all");
  const [showTradeForm,   setShowTradeForm]   = useState(false);
  const [showLessonForm,  setShowLessonForm]  = useState(false);
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [showCSVImport,   setShowCSVImport]   = useState(false);
  const [editTrade,   setEditTrade]   = useState<Trade | null>(null);
  const [editJournal, setEditJournal] = useState<JournalEntry | null>(null);
  const [lessonFilter, setLessonFilter] = useState<LessonSeverity|"all">("all");

  useEffect(() => {
    const t = localStorage.getItem("trades");
    const l = localStorage.getItem("lessons");
    const j = localStorage.getItem("journal");
    if (t) setTrades(JSON.parse(t)); else { setTrades(SEED_TRADES); localStorage.setItem("trades", JSON.stringify(SEED_TRADES)); }
    if (l) setLessons(JSON.parse(l));
    if (j) setJournal(JSON.parse(j));
  }, []);

  const saveTrades  = useCallback((t: Trade[])        => { setTrades(t);  localStorage.setItem("trades",  JSON.stringify(t)); }, []);
  const saveLessons = useCallback((l: Lesson[])        => { setLessons(l); localStorage.setItem("lessons", JSON.stringify(l)); }, []);
  const saveJournal = useCallback((j: JournalEntry[]) => { setJournal(j); localStorage.setItem("journal", JSON.stringify(j)); }, []);

  // ── Period-scoped stats ──────────────────────────────────────────────────
  const allClosed    = trades.filter(t => t.status === "CLOSED");
  const periodClosed = filterByPeriod(allClosed, period);
  const periodPnl    = periodClosed.reduce((s,t) => s + tradePnl(t), 0);
  const periodWins   = periodClosed.filter(t => tradePnl(t) > 0);
  const periodLosses = periodClosed.filter(t => tradePnl(t) < 0);
  const winRate      = periodClosed.length ? (periodWins.length / periodClosed.length) * 100 : 0;
  const avgWin       = periodWins.length   ? periodWins.reduce((s,t)   => s+tradePnl(t),0)/periodWins.length   : 0;
  const avgLoss      = periodLosses.length ? periodLosses.reduce((s,t) => s+tradePnl(t),0)/periodLosses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? avgWin/Math.abs(avgLoss) : 0;
  const streak       = calcStreak(periodClosed);
  const maxDD        = calcMaxDrawdown(allClosed);
  const longestLoss  = calcLongestLosingStreak(allClosed);

  // ── Bar chart data (period-scoped daily P&L) ─────────────────────────────
  const dailyMap: Record<string,number> = {};
  periodClosed.forEach(t => { dailyMap[t.date] = (dailyMap[t.date]||0) + tradePnl(t); });
  const chartData = Object.entries(dailyMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date,pnl]) => ({ date: format(parseISO(date),"MM/dd"), pnl }));

  // ── Setup performance ────────────────────────────────────────────────────
  const setupMap: Record<string,{pnl:number;count:number;wins:number}> = {};
  periodClosed.forEach(t => {
    const s = t.setup || "No Setup";
    if (!setupMap[s]) setupMap[s] = { pnl:0, count:0, wins:0 };
    const p = tradePnl(t);
    setupMap[s].pnl += p; setupMap[s].count++; if (p>0) setupMap[s].wins++;
  });
  const setupData = Object.entries(setupMap)
    .map(([setup,v]) => ({ setup, ...v, winPct: v.count ? (v.wins/v.count)*100 : 0 }))
    .sort((a,b) => b.pnl - a.pnl);

  // ── Ticker performance ───────────────────────────────────────────────────
  const tickerMap: Record<string,{pnl:number;count:number;wins:number}> = {};
  periodClosed.forEach(t => {
    if (!tickerMap[t.ticker]) tickerMap[t.ticker] = { pnl:0, count:0, wins:0 };
    const p = tradePnl(t);
    tickerMap[t.ticker].pnl += p; tickerMap[t.ticker].count++; if (p>0) tickerMap[t.ticker].wins++;
  });
  const tickerData = Object.entries(tickerMap)
    .map(([ticker,v]) => ({ ticker, ...v }))
    .sort((a,b) => b.pnl - a.pnl);

  const displayTrades  = [...filterByPeriod(trades, period)].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const displayLessons = lessonFilter==="all" ? lessons : lessons.filter(l => l.severity===lessonFilter);
  const periodSub = `${periodClosed.length} trade${periodClosed.length!==1?"s":""}  ·  ${periodWins.length}W / ${periodLosses.length}L`;

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* ── Header ── */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
              <Activity size={16} className="text-white"/>
            </div>
            <span className="font-bold text-white text-lg tracking-tight">TradeLog</span>
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot"/>Live
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 hidden lg:block">{format(new Date(),"EEEE, MMM d yyyy")}</span>
            <button onClick={() => setShowCSVImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors">
              <Upload size={13}/> Import CSV
            </button>
            <button onClick={() => exportToCSV(trades)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors">
              <Download size={13}/> Export
            </button>
            <button onClick={() => { setEditTrade(null); setShowTradeForm(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
              <Plus size={14}/> Log Trade
            </button>
            <button onClick={() => setShowLessonForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors">
              <BookOpen size={14}/> Add Lesson
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* P&L with period dropdown */}
          <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${periodPnl>0?"glow-green":periodPnl<0?"glow-red":""}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">P&amp;L</span>
              <PeriodDropdown period={period} onChange={setPeriod}/>
            </div>
            <div className={`text-2xl font-bold font-mono animate-count ${periodPnl>0?"text-emerald-400":periodPnl<0?"text-red-400":"text-gray-300"}`}>
              {periodClosed.length===0 ? "—" : fmt(periodPnl)}
            </div>
            <div className="mt-1 text-xs text-gray-500">{periodSub}</div>
          </div>

          {/* Win Rate */}
          <StatCard label="Win Rate" value={periodClosed.length ? `${winRate.toFixed(1)}%` : "—"}
            sub={`${PERIOD_LABELS[period]}  ·  ${periodWins.length}W / ${periodLosses.length}L`}
            icon={<Award size={16}/>} positive={winRate>=50} neutral={!periodClosed.length}/>

          {/* Streak */}
          <div className={`rounded-xl p-5 border border-gray-800 bg-gray-900 ${streak.type==="win"?"glow-green":streak.type==="loss"?"glow-red":""}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold tracking-widest uppercase text-gray-500">Streak</span>
              <span className="text-gray-600">{streak.type==="win" ? <Flame size={16}/> : <Snowflake size={16}/>}</span>
            </div>
            <div className={`text-2xl font-bold font-mono animate-count ${streak.type==="win"?"text-emerald-400":streak.type==="loss"?"text-red-400":"text-gray-300"}`}>
              {streak.type==="none" ? "—" : `${streak.count} ${streak.type==="win"?"🔥":"❄️"}`}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {streak.type==="none" ? "No trades yet" : `${streak.count} ${streak.type} trade${streak.count!==1?"s":""} in a row`}
            </div>
          </div>

          {/* Profit Factor */}
          <StatCard label="Profit Factor" value={profitFactor>0 ? profitFactor.toFixed(2) : "—"}
            sub={`Avg W: ${avgWin>0?fmt(avgWin):"—"}  ·  Avg L: ${avgLoss<0?fmt(avgLoss):"—"}`}
            icon={<BarChart2 size={16}/>} positive={profitFactor>=1} neutral={!profitFactor}/>
        </div>

        {/* ── Bar Chart (period-filtered daily P&L) ── */}
        {chartData.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Daily P&amp;L — {PERIOD_LABELS[period]}
              </h3>
              <span className={`text-sm font-bold font-mono ${periodPnl>=0?"text-emerald-400":"text-red-400"}`}>{fmt(periodPnl)}</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937"/>
                <XAxis dataKey="date" tick={{fill:"#6b7280",fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#6b7280",fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)", radius: 4 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const val = payload[0].value as number;
                    return (
                      <div className="rounded-xl border border-gray-700 bg-gray-900/95 px-4 py-3 shadow-2xl">
                        <div className={`text-xl font-bold font-mono ${val>=0?"text-emerald-400":"text-red-400"}`}>{fmt(val)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="pnl" radius={[4,4,0,0]}>
                  {chartData.map((e,i) => <Cell key={i} fill={e.pnl>=0?"#10b981":"#ef4444"} fillOpacity={0.85}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 border-b border-gray-800 overflow-x-auto">
          {(["trades","analytics","journal","lessons"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize whitespace-nowrap transition-colors border-b-2 -mb-px
                ${tab===t?"border-indigo-500 text-white":"border-transparent text-gray-500 hover:text-gray-300"}`}>
              {t==="lessons"?"Lessons Learned":t==="journal"?"Journal":t.charAt(0).toUpperCase()+t.slice(1)}
              {t==="trades"  && displayTrades.length>0  && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{displayTrades.length}</span>}
              {t==="lessons" && lessons.length>0         && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{lessons.length}</span>}
              {t==="journal" && journal.length>0         && <span className="ml-2 text-xs bg-gray-800 px-1.5 py-0.5 rounded-full text-gray-400">{journal.length}</span>}
            </button>
          ))}
        </div>

        {/* ── Trades Tab ── */}
        {tab==="trades" && (
          <div className="space-y-3">
            {period!=="all" && (
              <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-xs text-indigo-300 flex items-center gap-1.5">
                  <Calendar size={12}/> <strong>{PERIOD_LABELS[period]}</strong> · <span className={`font-mono font-bold ${periodPnl>=0?"text-emerald-400":"text-red-400"}`}>{fmt(periodPnl)}</span>
                </span>
                <button onClick={() => setPeriod("all")} className="text-xs text-indigo-400 hover:text-white flex items-center gap-1"><X size={11}/> Show all</button>
              </div>
            )}
            {displayTrades.length===0 ? (
              <div className="text-center py-16 text-gray-600">
                <Activity size={32} className="mx-auto mb-3 opacity-40"/>
                <p className="text-sm">{period!=="all"
                  ? <><strong className="text-gray-400">{PERIOD_LABELS[period]}</strong> — no trades. <button className="underline text-indigo-400" onClick={()=>setPeriod("all")}>Show all</button></>
                  : <>No trades yet. Click <strong className="text-gray-400">Log Trade</strong> to get started.</>}</p>
              </div>
            ) : (
              <>
                <div className="hidden md:grid grid-cols-[80px_80px_60px_90px_90px_75px_65px_1fr_60px] gap-2 px-4 py-2 text-xs font-semibold tracking-widest uppercase text-gray-600">
                  <span>Date</span><span>Ticker</span><span>Dir</span><span>Entry</span><span>Exit</span><span>Shares</span><span>Duration</span><span>P&amp;L</span><span/>
                </div>
                <div className="space-y-2">
                  {displayTrades.map(t => (
                    <TradeRow key={t.id} trade={t}
                      onDelete={id => saveTrades(trades.filter(x=>x.id!==id))}
                      onEdit={t => { setEditTrade(t); setShowTradeForm(true); }}/>
                  ))}
                </div>
                {displayTrades.filter(t=>t.status==="CLOSED").length>1 && (
                  <div className="flex justify-end px-4 pt-2 border-t border-gray-800">
                    <span className="text-xs text-gray-500">Period total: <span className={`font-mono font-bold ${periodPnl>=0?"text-emerald-400":"text-red-400"}`}>{fmt(periodPnl)}</span></span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {tab==="analytics" && (
          <div className="space-y-6">
            {/* Risk metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label:"Max Drawdown",       value: maxDD>0 ? `-${fmtAbs(maxDD)}` : "—", pos:false,  neutral:maxDD===0 },
                { label:"Profit Factor",      value: profitFactor>0 ? profitFactor.toFixed(2) : "—", pos:profitFactor>=1, neutral:!profitFactor },
                { label:"Longest Loss Streak",value: longestLoss>0 ? `${longestLoss} trades` : "—", pos:false, neutral:!longestLoss },
                { label:"Avg Win / Avg Loss", value: (avgWin>0&&avgLoss<0) ? (avgWin/Math.abs(avgLoss)).toFixed(2)+"x" : "—", pos:true, neutral:!(avgWin>0&&avgLoss<0) },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-4 border border-gray-800 bg-gray-900 text-center">
                  <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                  <div className={`text-lg font-bold font-mono ${s.neutral?"text-gray-400":s.pos?"text-emerald-400":"text-red-400"}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {periodClosed.length===0 ? (
              <div className="text-center py-12 text-gray-600">
                <BarChart2 size={32} className="mx-auto mb-3 opacity-40"/>
                <p className="text-sm">No closed trades for <strong className="text-gray-400">{PERIOD_LABELS[period]}</strong>.</p>
              </div>
            ) : (
              <>
                {/* Per-trade P&L */}
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">P&amp;L per Trade</h3>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {[...periodClosed].sort((a,b)=>tradePnl(b)-tradePnl(a)).map(t => {
                      const p = tradePnl(t);
                      const maxAbs = Math.max(...periodClosed.map(x=>Math.abs(tradePnl(x))));
                      const barW = maxAbs>0 ? (Math.abs(p)/maxAbs)*100 : 0;
                      return (
                        <div key={t.id} className="flex items-center gap-3 text-xs">
                          <span className="w-12 text-gray-500 font-mono">{format(parseISO(t.date),"MM/dd")}</span>
                          <span className="w-14 font-bold text-white">{t.ticker}</span>
                          <div className="flex-1 relative h-5 flex items-center">
                            <div className={`h-4 rounded absolute ${p>=0?"bg-emerald-500/30":"bg-red-500/30"}`}
                              style={{width:`${barW}%`,[p>=0?"left":"right"]:"50%",maxWidth:"50%"}}/>
                            <span className={`absolute ${p>=0?"left-[52%]":"right-[52%]"} font-mono font-bold ${p>=0?"text-emerald-400":"text-red-400"}`}>{fmt(p)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Setup performance */}
                {setupData.length > 0 && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Setup Performance</h3>
                    <div className="space-y-3">
                      {setupData.map(s => (
                        <div key={s.setup} className="flex items-center gap-3 text-sm">
                          <span className="w-32 text-gray-300 truncate font-medium">{s.setup}</span>
                          <span className="w-16 text-center text-xs text-gray-500">{s.count} trade{s.count!==1?"s":""}</span>
                          <span className={`w-12 text-center text-xs font-semibold px-1.5 py-0.5 rounded-full ${s.winPct>=50?"bg-emerald-400/10 text-emerald-400":"bg-red-400/10 text-red-400"}`}>
                            {s.winPct.toFixed(0)}%W
                          </span>
                          <div className="flex-1">
                            <div className={`font-mono font-bold ${s.pnl>=0?"text-emerald-400":"text-red-400"}`}>{fmt(s.pnl)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ticker performance */}
                {tickerData.length > 0 && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Ticker Performance</h3>
                    <div className="space-y-3">
                      {tickerData.map(s => (
                        <div key={s.ticker} className="flex items-center gap-3 text-sm">
                          <span className="w-16 font-bold text-white font-mono">{s.ticker}</span>
                          <span className="w-16 text-center text-xs text-gray-500">{s.count} trade{s.count!==1?"s":""}</span>
                          <span className={`w-12 text-center text-xs font-semibold px-1.5 py-0.5 rounded-full ${(s.wins/s.count)*100>=50?"bg-emerald-400/10 text-emerald-400":"bg-red-400/10 text-red-400"}`}>
                            {((s.wins/s.count)*100).toFixed(0)}%W
                          </span>
                          <div className="flex-1">
                            <div className={`font-mono font-bold ${s.pnl>=0?"text-emerald-400":"text-red-400"}`}>{fmt(s.pnl)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Best / Worst */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {label:"Best Trade",  val:fmt(Math.max(...periodClosed.map(tradePnl))), pos:true},
                    {label:"Worst Trade", val:fmt(Math.min(...periodClosed.map(tradePnl))), pos:false},
                    {label:"Avg Win",     val:avgWin>0?fmt(avgWin):"—", pos:true},
                    {label:"Avg Loss",    val:avgLoss<0?fmt(avgLoss):"—", pos:false},
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-4 border border-gray-800 bg-gray-900 text-center">
                      <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                      <div className={`text-lg font-bold font-mono ${s.pos?"text-emerald-400":"text-red-400"}`}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Journal Tab ── */}
        {tab==="journal" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Plan your sessions, review your day, track your mindset.</p>
              <button onClick={() => { setEditJournal(null); setShowJournalForm(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
                <Plus size={13}/> New Entry
              </button>
            </div>
            {journal.length===0 ? (
              <div className="text-center py-16 text-gray-600">
                <FileText size={32} className="mx-auto mb-3 opacity-40"/>
                <p className="text-sm">No journal entries yet. Write your first pre-market plan.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...journal].sort((a,b)=>b.date.localeCompare(a.date)).map(e => (
                  <JournalCard key={e.id} entry={e}
                    onDelete={id => saveJournal(journal.filter(x=>x.id!==id))}
                    onEdit={e => { setEditJournal(e); setShowJournalForm(true); }}/>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Lessons Tab ── */}
        {tab==="lessons" && (
          <div className="space-y-4">
            {lessons.length>0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Filter:</span>
                {(["all","critical","warning","insight"] as const).map(f => (
                  <button key={f} onClick={()=>setLessonFilter(f)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${lessonFilter===f?"bg-indigo-600 text-white":"bg-gray-800 text-gray-400 hover:text-gray-300"}`}>
                    {f==="all"?"All":SEVERITY_CONFIG[f].label}
                    {f!=="all"&&<span className="ml-1.5 opacity-60">{lessons.filter(l=>l.severity===f).length}</span>}
                  </button>
                ))}
              </div>
            )}
            {displayLessons.length===0 ? (
              <div className="text-center py-16 text-gray-600">
                <BookOpen size={32} className="mx-auto mb-3 opacity-40"/>
                <p className="text-sm">No lessons yet. Track mistakes and insights to grow as a trader.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {[...displayLessons].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(l => (
                  <LessonCard key={l.id} lesson={l} onDelete={id=>saveLessons(lessons.filter(x=>x.id!==id))}/>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Modals ── */}
      {showTradeForm && (
        <TradeForm
          trade={editTrade}
          onSave={t => {
            saveTrades(editTrade
              ? trades.map(x => x.id===editTrade.id ? t : x)
              : [...trades, t]);
            setShowTradeForm(false); setEditTrade(null);
          }}
          onClose={() => { setShowTradeForm(false); setEditTrade(null); }}/>
      )}
      {showLessonForm && (
        <LessonForm trades={trades}
          onSave={l => { saveLessons([...lessons,l]); setShowLessonForm(false); }}
          onClose={() => setShowLessonForm(false)}/>
      )}
      {showJournalForm && (
        <JournalForm
          entry={editJournal}
          onSave={e => {
            saveJournal(editJournal
              ? journal.map(x => x.id===editJournal.id ? e : x)
              : [...journal, e]);
            setShowJournalForm(false); setEditJournal(null);
          }}
          onClose={() => { setShowJournalForm(false); setEditJournal(null); }}/>
      )}
      {showCSVImport && (
        <CSVImportModal
          onImport={imported => saveTrades([...trades, ...imported])}
          onClose={() => setShowCSVImport(false)}/>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE FORM (create + edit)
// ═══════════════════════════════════════════════════════════════════════════════

function TradeForm({ trade, onSave, onClose }: {
  trade: Trade|null; onSave: (t: Trade) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    date:        trade?.date        ?? new Date().toISOString().slice(0,10),
    ticker:      trade?.ticker      ?? "",
    direction:   (trade?.direction  ?? "LONG") as "LONG"|"SHORT",
    entryPrice:  trade?.entryPrice?.toString()  ?? "",
    exitPrice:   trade?.exitPrice?.toString()   ?? "",
    shares:      trade?.shares?.toString()      ?? "",
    commission:  trade?.commission?.toString()  ?? "",
    setup:       trade?.setup       ?? "",
    notes:       trade?.notes       ?? "",
    entryTime:   trade?.entryTime   ?? "",
    exitTime:    trade?.exitTime    ?? "",
  });

  const pnlPreview = (() => {
    const en=parseFloat(form.entryPrice),ex=parseFloat(form.exitPrice),sh=parseFloat(form.shares),cm=parseFloat(form.commission)||0;
    if (!en||!ex||!sh) return null;
    return (form.direction==="SHORT" ? -(ex-en)*sh : (ex-en)*sh) - cm;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ticker||!form.entryPrice||!form.shares) return;
    onSave({
      id:         trade?.id ?? uuidv4(),
      date:       form.date,
      ticker:     form.ticker.toUpperCase(),
      direction:  form.direction,
      entryPrice: parseFloat(form.entryPrice),
      exitPrice:  form.exitPrice ? parseFloat(form.exitPrice) : null,
      shares:     parseFloat(form.shares),
      commission: parseFloat(form.commission)||0,
      status:     form.exitPrice ? "CLOSED" : "OPEN",
      setup:      form.setup,
      notes:      form.notes,
      createdAt:  trade?.createdAt ?? new Date().toISOString(),
      entryTime:  form.entryTime || undefined,
      exitTime:   form.exitTime  || undefined,
    });
  };

  const f = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";
  return (
    <Modal title={trade ? "Edit Trade" : "Log Trade"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className={f} value={form.date} onChange={e=>setForm({...form,date:e.target.value})} required/></div>
          <div><label className="label">Ticker</label><input className={f} placeholder="AAPL" value={form.ticker} onChange={e=>setForm({...form,ticker:e.target.value})} required/></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Entry Time</label><input type="time" className={f} value={form.entryTime} onChange={e=>setForm({...form,entryTime:e.target.value})}/></div>
          <div>
            <label className="label">Exit Time
              {form.entryTime && form.exitTime && (() => { const d = tradeDuration({entryTime:form.entryTime,exitTime:form.exitTime} as Trade); return d ? <span className="ml-2 text-indigo-400 font-mono font-semibold">{d}</span> : null; })()}
            </label>
            <input type="time" className={f} value={form.exitTime} onChange={e=>setForm({...form,exitTime:e.target.value})}/>
          </div>
        </div>
        <div>
          <label className="label">Direction</label>
          <div className="flex gap-2">
            {(["LONG","SHORT"] as const).map(d => (
              <button key={d} type="button" onClick={()=>setForm({...form,direction:d})}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${form.direction===d?(d==="LONG"?"bg-emerald-500/20 border border-emerald-500 text-emerald-400":"bg-red-500/20 border border-red-500 text-red-400"):"bg-gray-800 border border-gray-700 text-gray-500"}`}>
                {d==="LONG"?"▲ LONG":"▼ SHORT"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Entry $</label><input type="number" step="0.0001" className={f} placeholder="0.00" value={form.entryPrice} onChange={e=>setForm({...form,entryPrice:e.target.value})} required/></div>
          <div><label className="label">Exit $</label><input type="number" step="0.0001" className={f} placeholder="0.00" value={form.exitPrice} onChange={e=>setForm({...form,exitPrice:e.target.value})}/></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Shares / Qty</label><input type="number" step="1" className={f} placeholder="100" value={form.shares} onChange={e=>setForm({...form,shares:e.target.value})} required/></div>
          <div><label className="label">Commission $</label><input type="number" step="0.01" className={f} placeholder="0.00" value={form.commission} onChange={e=>setForm({...form,commission:e.target.value})}/></div>
        </div>
        {pnlPreview!==null && (
          <div className={`rounded-lg px-4 py-3 text-center font-mono font-bold text-lg ${pnlPreview>=0?"bg-emerald-500/10 text-emerald-400 border border-emerald-500/30":"bg-red-500/10 text-red-400 border border-red-500/30"}`}>
            {pnlPreview>=0?"▲":"▼"} {fmt(pnlPreview)}
          </div>
        )}
        <div><label className="label">Setup / Strategy</label><input className={f} placeholder="e.g. Breakout, VWAP bounce…" value={form.setup} onChange={e=>setForm({...form,setup:e.target.value})}/></div>
        <div><label className="label">Notes</label><textarea rows={2} className={f+" resize-none"} placeholder="What happened?" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700 transition-colors">Cancel</button>
          <button type="submit" className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors">{trade?"Save Changes":"Save Trade"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LESSON FORM
// ═══════════════════════════════════════════════════════════════════════════════

function LessonForm({ trades, onSave, onClose }: {
  trades: Trade[]; onSave: (l: Lesson) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0,10), title:"", description:"",
    category:"Psychology" as LessonCategory, severity:"warning" as LessonSeverity, tradeId:"",
  });
  const f = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!form.title) return;
    onSave({ id:uuidv4(), date:form.date, title:form.title, description:form.description,
      category:form.category, severity:form.severity, tradeId:form.tradeId||undefined, createdAt:new Date().toISOString() });
  };
  return (
    <Modal title="Add Lesson Learned" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className={f} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div>
          <div><label className="label">Linked Trade</label>
            <select className={f} value={form.tradeId} onChange={e=>setForm({...form,tradeId:e.target.value})}>
              <option value="">None</option>
              {trades.map(t=><option key={t.id} value={t.id}>{t.ticker} — {format(parseISO(t.date),"MMM d")}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Type</label>
          <div className="flex gap-2">
            {(["critical","warning","insight"] as LessonSeverity[]).map(s => {
              const cfg=SEVERITY_CONFIG[s];
              return <button key={s} type="button" onClick={()=>setForm({...form,severity:s})}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors ${form.severity===s?cfg.bg:"bg-gray-800 border-gray-700 text-gray-500"}`}>
                <span className={form.severity===s?cfg.color:""}>{cfg.icon}</span>
                <span className={form.severity===s?cfg.color:""}>{cfg.label}</span>
              </button>;
            })}
          </div>
        </div>
        <div>
          <label className="label">Category</label>
          <div className="flex flex-wrap gap-2">
            {(["Risk Management","Entry","Exit","Psychology","Setup","Other"] as LessonCategory[]).map(c=>(
              <button key={c} type="button" onClick={()=>setForm({...form,category:c})}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${form.category===c?"text-white":"bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                style={form.category===c?{background:CATEGORY_COLORS[c]}:{}}>{c}</button>
            ))}
          </div>
        </div>
        <div><label className="label">Title</label><input className={f} placeholder="e.g. Chased entry after missing the breakout" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required/></div>
        <div><label className="label">Details</label><textarea rows={3} className={f+" resize-none"} placeholder="What happened, what to do differently…" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700">Cancel</button>
          <button type="submit" className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">Save Lesson</button>
        </div>
      </form>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNAL FORM
// ═══════════════════════════════════════════════════════════════════════════════

function JournalForm({ entry, onSave, onClose }: {
  entry: JournalEntry|null; onSave: (e: JournalEntry) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    date:              entry?.date              ?? new Date().toISOString().slice(0,10),
    watchlist:         entry?.watchlist         ?? "",
    maxLossTarget:     entry?.maxLossTarget?.toString() ?? "",
    premarketPlan:     entry?.premarketPlan     ?? "",
    postmarketReview:  entry?.postmarketReview  ?? "",
    mood:             (entry?.mood              ?? "neutral") as Mood,
    focusLevel:        entry?.focusLevel        ?? 3,
  });

  const f = "bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 w-full";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    onSave({
      id:              entry?.id ?? uuidv4(),
      date:            form.date,
      watchlist:       form.watchlist,
      maxLossTarget:   parseFloat(form.maxLossTarget)||0,
      premarketPlan:   form.premarketPlan,
      postmarketReview:form.postmarketReview,
      mood:            form.mood,
      focusLevel:      form.focusLevel,
      createdAt:       entry?.createdAt ?? now,
      updatedAt:       now,
    });
  };

  return (
    <Modal title={entry ? "Edit Journal Entry" : "New Journal Entry"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className={f} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div>
          <div><label className="label">Max Daily Loss $</label><input type="number" step="1" className={f} placeholder="500" value={form.maxLossTarget} onChange={e=>setForm({...form,maxLossTarget:e.target.value})}/></div>
        </div>
        <div><label className="label">Watchlist (comma-separated)</label><input className={f} placeholder="BB, HPE, NVDA…" value={form.watchlist} onChange={e=>setForm({...form,watchlist:e.target.value})}/></div>
        <div><label className="label">Pre-Market Plan</label><textarea rows={3} className={f+" resize-none"} placeholder="What setups are you watching? What's your game plan?" value={form.premarketPlan} onChange={e=>setForm({...form,premarketPlan:e.target.value})}/></div>
        <div><label className="label">End-of-Day Review</label><textarea rows={3} className={f+" resize-none"} placeholder="How did it go? What worked, what didn't?" value={form.postmarketReview} onChange={e=>setForm({...form,postmarketReview:e.target.value})}/></div>
        <div>
          <label className="label">Mood</label>
          <div className="flex gap-2">
            {(["great","good","neutral","bad","terrible"] as Mood[]).map(m=>{
              const cfg=MOOD_CONFIG[m];
              return <button key={m} type="button" onClick={()=>setForm({...form,mood:m})}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 border transition-colors ${form.mood===m?"border-indigo-500 bg-indigo-500/10 text-white":"bg-gray-800 border-gray-700 text-gray-500"}`}>
                <span className={form.mood===m?cfg.color:""}>{cfg.icon}</span>
                <span className="hidden sm:block">{cfg.label}</span>
              </button>;
            })}
          </div>
        </div>
        <div>
          <label className="label">Focus Level</label>
          <div className="flex items-center gap-2">
            {[1,2,3,4,5].map(i=>(
              <button key={i} type="button" onClick={()=>setForm({...form,focusLevel:i})}
                className={`w-8 h-8 rounded-lg text-xs font-bold border transition-colors ${form.focusLevel>=i?"bg-indigo-600 border-indigo-500 text-white":"bg-gray-800 border-gray-700 text-gray-500"}`}>{i}</button>
            ))}
            <span className="text-xs text-gray-500 ml-1">
              {["","Distracted","Below avg","Average","Focused","In the zone"][form.focusLevel]}
            </span>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm font-semibold hover:bg-gray-700">Cancel</button>
          <button type="submit" className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">{entry?"Save Changes":"Save Entry"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X size={18}/></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
