#!/usr/bin/env node
// Auto-draw cron: runs every hour, triggers draw for expired raffles
const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getSetting(key) {
  const { data } = await supabase.from("settings").select("value").eq("key", key).single();
  return data?.value ?? null;
}

async function creditReferrerCommission(userId, amount, token) {
  try {
    const commissionPercent = await getSetting("ref_commission_percent");
    const pct = parseInt(commissionPercent || "10");
    if (pct <= 0) return;
    const { data: user } = await supabase.from("users").select("referred_by").eq("id", userId).single();
    if (!user?.referred_by) return;
    const commission = Math.floor(amount * pct / 100);
    if (commission <= 0) return;
    const { data: referrer } = await supabase.from("users").select("id, balance, gram").eq("telegram_id", user.referred_by).single();
    if (!referrer) return;
    if (token === "SNAP") {
      await supabase.from("users").update({ balance: (referrer.balance || 0) + commission }).eq("id", referrer.id);
    } else {
      await supabase.from("users").update({ gram: (referrer.gram || 0) + commission }).eq("id", referrer.id);
    }
  } catch (e) {}
}

async function drawRaffle(raffle) {
  console.log(`Drawing raffle: ${raffle.title} (${raffle.id})`);

  const totalBoxes = raffle.total_boxes || 8;

  const { data: allEntries } = await supabase
    .from("raffle_entries")
    .select("*, users(telegram_id, first_name, balance)")
    .eq("raffle_id", raffle.id);

  if (!allEntries || allEntries.length === 0) {
    console.log("No participants, skipping");
    await supabase.from("raffles").update({ status: "completed" }).eq("id", raffle.id);
    return;
  }

  const fullBoxEntries = allEntries.filter((e) => {
    const opened = Array.isArray(e.boxes_opened) ? e.boxes_opened.length : 0;
    return opened >= totalBoxes;
  });

  let winner;
  if (fullBoxEntries.length > 0) {
    fullBoxEntries.sort((a, b) => (b.total_luck || 0) - (a.total_luck || 0));
    winner = fullBoxEntries[0];
  } else {
    allEntries.sort((a, b) => {
      const aOpened = Array.isArray(a.boxes_opened) ? a.boxes_opened.length : 0;
      const bOpened = Array.isArray(b.boxes_opened) ? b.boxes_opened.length : 0;
      if (bOpened !== aOpened) return bOpened - aOpened;
      return (b.total_luck || 0) - (a.total_luck || 0);
    });
    winner = allEntries[0];
  }

  // Credit winner prize
  const winnerPrize = raffle.winner_prize || 0;
  const winnerData = winner?.users;
  if (winnerPrize > 0 && winner?.user_id) {
    const currentBalance = winnerData?.balance || 0;
    await supabase.from("users").update({ balance: currentBalance + winnerPrize }).eq("id", winner.user_id);
    try {
      await supabase.from("transactions").insert({
        user_id: winner.user_id,
        type: "raffle_prize",
        amount: winnerPrize,
        token: "SNAP",
        description: `Won ${raffle.title}`,
      });
    } catch (e) {}
    await creditReferrerCommission(winner.user_id, winnerPrize, "SNAP");
  }

  await supabase.from("raffles").update({ status: "completed" }).eq("id", raffle.id);

  // Send winner message
  if (winnerData?.telegram_id) {
    try {
      const miniAppUrl = await getSetting("mini_app_url");
      const buttons = [];
      if (miniAppUrl) {
        buttons.push([{ text: "🎉 Open Mini App", web_app: { url: miniAppUrl } }]);
      }
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: winnerData.telegram_id,
          text: `🎉 Congratulations, ${winnerData.first_name || "User"}!\n\nYou won the ${raffle.title}!\n\nPrize: ${winnerPrize} SNAP\nBoxes opened: ${totalBoxes}/${totalBoxes}\nLuck: ${winner.total_luck || 100}%\n\nYour reward has been credited to your balance!`,
          reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
        }),
      });
      console.log(`Winner message sent to ${winnerData.telegram_id}`);
    } catch (e) {
      console.error("Winner message error:", e.message);
    }
  }

  // Send loser messages
  for (const entry of allEntries) {
    if (entry.user_id === winner?.user_id) continue;
    const entryUser = entry.users;
    if (entryUser?.telegram_id) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: entryUser.telegram_id,
            text: `Better luck next time! 🍀\n\nThe ${raffle.title} draw has ended.\nYour luck was ${entry.total_luck || 0}%\n\nNext raffle starts soon — keep unlocking boxes!`,
          }),
        });
      } catch (e) {}
    }
  }

  // Auto-create next raffle if weekly
  if (raffle.draw_frequency === "weekly") {
    const nextEnd = new Date();
    nextEnd.setDate(nextEnd.getDate() + 7);
    await supabase.from("raffles").insert({
      title: raffle.title,
      description: raffle.description,
      total_boxes: 8,
      prize_pool: raffle.prize_pool,
      reward_token: raffle.reward_token,
      reward_per_box: raffle.reward_per_box,
      winner_prize: raffle.winner_prize,
      draw_frequency: "weekly",
      ad_zone_id: raffle.ad_zone_id,
      status: "active",
      start_date: new Date().toISOString(),
      end_date: nextEnd.toISOString(),
    });
    console.log("Auto-created next weekly raffle");
  }

  console.log(`Draw complete. Winner: ${winnerData?.first_name || "Unknown"} (${winnerPrize} SNAP)`);
}

async function main() {
  const now = new Date().toISOString();
  const { data: expiredRaffles } = await supabase
    .from("raffles")
    .select("*")
    .eq("status", "active")
    .not("end_date", "is", null)
    .lte("end_date", now);

  if (!expiredRaffles || expiredRaffles.length === 0) {
    console.log(`[${now}] No expired raffles`);
    return;
  }

  for (const raffle of expiredRaffles) {
    await drawRaffle(raffle);
  }
}

main().catch(console.error);
