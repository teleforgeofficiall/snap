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

export async function creditReferrerCommission(
  supabase: SupabaseClient,
  earnerId: string,
  earnedAmount: number,
  tokenType: "snap" | "gram" = "snap"
): Promise<void> {
  if (!earnedAmount || earnedAmount <= 0) return;

  const { data: earner } = await supabase
    .from("users")
    .select("referred_by")
    .eq("id", earnerId)
    .single();

  if (!earner?.referred_by) return;

  const commPctStr = await getSetting(supabase, "ref_commission_percent");
  const commPct = parseFloat(commPctStr || "10");
  if (commPct <= 0) return;

  const commission = Math.floor(earnedAmount * commPct / 100);
  if (commission <= 0) return;

  const { data: referrer } = await supabase
    .from("users")
    .select("id, telegram_id, balance, gram")
    .eq("id", earner.referred_by)
    .single();

  if (!referrer) return;

  const updateField: any = {};
  if (tokenType === "gram") {
    updateField.gram = (referrer.gram || 0) + commission;
  } else {
    updateField.balance = (referrer.balance || 0) + commission;
  }
  await supabase.from("users").update(updateField).eq("id", referrer.id);

  // Update snap_earned in referrals (only for SNAP commission)
  if (tokenType === "snap") {
    const { data: ref } = await supabase
      .from("referrals")
      .select("snap_earned")
      .eq("referrer_id", referrer.id)
      .eq("referred_id", earnerId)
      .single();
    const currentEarned = ref?.snap_earned || 0;
    await supabase.from("referrals").update({
      snap_earned: currentEarned + commission,
    }).eq("referrer_id", referrer.id).eq("referred_id", earnerId);
  }

  const label = tokenType === "gram" ? "Gram" : "SNAP";
  try {
    const { sendMessage } = require("./telegram");
    const botToken = process.env.BOT_TOKEN || "";
    if (botToken && referrer.telegram_id) {
      await sendMessage(botToken, {
        chat_id: referrer.telegram_id,
        text: `💰 <b>Lifetime Commission!</b>\n\nYou earned <b>${commission} ${label}</b> commission from your referral's earnings!`,
      });
    }
  } catch {}
}

export async function grantReferrerSpins(
  supabase: SupabaseClient,
  referrerId: string,
  referredUserId: string
): Promise<void> {
  const spinsStr = await getSetting(supabase, "ref_spins_per_refer");
  const spins = parseInt(spinsStr || "5");
  if (spins <= 0) return;

  const today = new Date().toISOString().split("T")[0];

  await supabase.from("referrals").update({
    spins_granted: spins,
  }).eq("referrer_id", referrerId).eq("referred_id", referredUserId);

  try {
    const { sendMessage } = require("./telegram");
    const botToken = process.env.BOT_TOKEN || "";
    const { data: referrer } = await supabase
      .from("users")
      .select("telegram_id")
      .eq("id", referrerId)
      .single();
    if (botToken && referrer?.telegram_id) {
      await sendMessage(botToken, {
        chat_id: referrer.telegram_id,
        text: `🎰 <b>Referral Bonus!</b>\n\nYou earned <b>${spins} Free Spins</b> for referring a friend!`,
      });
    }
  } catch {}
}
