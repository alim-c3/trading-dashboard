export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED";
export type LessonCategory = "Risk Management" | "Entry" | "Exit" | "Psychology" | "Setup" | "Other";
export type LessonSeverity = "critical" | "warning" | "insight";

export interface Trade {
  id: string;
  date: string;          // ISO date string YYYY-MM-DD
  ticker: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  commission: number;    // total commission paid
  status: TradeStatus;
  notes: string;
  setup: string;
  createdAt: string;
}

export interface Lesson {
  id: string;
  date: string;
  title: string;
  description: string;
  category: LessonCategory;
  severity: LessonSeverity;
  tradeId?: string;
  createdAt: string;
}

export interface DailyStats {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}
