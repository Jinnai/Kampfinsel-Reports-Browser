import { createClient } from '@supabase/supabase-js';
import type { ReportSource, SpyReportRow } from '../domain/report';

type SpyReportsTable = {
  Row: SpyReportRow;
  Insert: {
    report_hash: string;
    reported_at?: string;
    target_player?: string | null;
    target_alliance?: string | null;
    ocean?: number | null;
    island_x?: number | null;
    island_y?: number | null;
    raw_report: string;
    parsed_report?: Record<string, unknown>;
    source?: ReportSource;
  };
  Update: Partial<SpyReportsTable['Insert']>;
  Relationships: [];
};

type Database = {
  public: {
    Tables: {
      spy_reports: SpyReportsTable;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!)
  : null;
