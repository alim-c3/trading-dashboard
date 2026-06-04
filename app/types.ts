export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED";
export type LessonCategory = "Risk Management" | "Entry" | "Exit" | "Psychology" | "Setup" | "Other";
export type LessonSeverity = "critical" | "warning" | "insight";
export type Mood = "great" | "good" | "neutral" | "bad" | "terrible";

export interface Trade {
  id: string;
  date: string;
  ticker: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  commission: number;
  status: TradeStatus;
  notes: string;
  setup: string;
  createdAt: string;
  entryTime?: string; // "HH:mm" 24-hour
  exitTime?: string;  // "HH:mm" 24-hour
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

export interface JournalEntry {
  id: string;
  date: string;
  premarketPlan: string;
  watchlist: string;
  maxLossTarget: number;
  postmarketReview: string;
  mood: Mood;
  focusLevel: number; // 1–5
  createdAt: string;
  updatedAt: string;
}
