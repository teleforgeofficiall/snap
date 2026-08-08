import { SupabaseClient } from "@supabase/supabase-js";
import { getChatMember } from "./telegram";

export function generateReferralCode(telegramId: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Date().toISOString().split("T")[0];
  return dateStr === today;
}

export function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

export async function checkAllChannelsJoined(
  token: string,
  userId: number,
  channels: { channel_id: number; channel_username: string }[]
): Promise<{ allJoined: boolean; notJoined: string[] }> {
  const notJoined: string[] = [];

  for (const ch of channels) {
    try {
      const result = await getChatMember(token, ch.channel_id, userId);
      const status = result?.result?.status;
      if (!status || status === "left" || status === "kicked") {
        notJoined.push(ch.channel_username);
      }
    } catch {
      notJoined.push(ch.channel_username);
    }
  }

  return { allJoined: notJoined.length === 0, notJoined };
}

export async function getSetting(
  supabase: SupabaseClient,
  key: string
): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export async function setSetting(
  supabase: SupabaseClient,
  key: string,
  value: string
): Promise<void> {
  await supabase.from("settings").upsert({ key, value });
}
