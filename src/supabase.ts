import { createClient, SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(url: string, key: string): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(url, key, {
      realtime: {
        params: { eventsPerSecond: 0 },
      },
    });
  }
  return supabaseInstance;
}
