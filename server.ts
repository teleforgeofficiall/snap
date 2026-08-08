import http from "http";
import { Env, loadAdminIds } from "./config";
import { getSupabase } from "./supabase";
import { sendMessage, copyMessage, deleteMessage, answerCallbackQuery } from "./telegram";
import { launchMessageText, launchMessageKeyboard } from "./keyboards";
import { handleStart, handleVerifyContinue } from "./handlers/start";
import { handleMainMenu } from "./handlers/menu";
import { handleWallet, handleDailyClaim } from "./handlers/wallet";
import { handleRefer } from "./handlers/refer";
import { handleLeaderboard } from "./handlers/leaderboard";
import { handleAbout } from "./handlers/about";
import {
  handleWithdraw,
  handleClaimComingSoon,
} from "./handlers/withdraw";
import {
  isAdmin,
  handleAdmin,
  handleAdminStats,
  handleAdminAddChannel,
  handleAdminRemoveChannel,
  handleAdminRemoveChannelConfirm,
  handleAdminListChannels,
  handleAdminClaimMsg,
  handleAdminBroadcast,
  handleAdminUserInfo,
  handleAdminRefPoints,
  handleAdminDailyBonus,
  handleAdminMiniApp,
  handleAdminRemoveMiniApp,
  handleAdminRemoveMiniAppYes,
  handleAdminResetData,
  handleAdminResetDataYes,
  handleAdminBroadcastYes,
  handleAdminBroadcastSend,
  handleAdminInput,
  BROADCAST_PENDING,
} from "./handlers/admin";
import { getSetting } from "./utils";

const USER_MENU_BUTTONS = ["💵 Wallet", "👥 Refer", "🏆 Leaderboard", "ℹ️ About", "💸 Withdraw", "⬅️ Back to Menu"];
const ADMIN_MENU_BUTTONS = ["📊 Stats", "📢 Add Channel", "🗑️ Remove Channel", "📋 List Channels", "📝 Claim Msg", "📢 Broadcast", "🔍 User Info", "💰 Ref Points", "🎁 Daily Bonus", "🔗 Mini App URL", "🗑️ Remove Mini App URL", "🗑️ Reset Data"];

const env: Env = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",
  ADMIN_IDS: process.env.ADMIN_IDS || "",
};

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    try {
      const update = JSON.parse(body);
      await handleUpdate(update, env);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } catch (err) {
      console.error("Webhook error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error");
    }
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Snapbucks Telegram Bot is running!");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`🤖 Snapbucks Bot running on port ${PORT}`);
});

async function handleUpdate(update: any, env: Env) {
  const supabase = getSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);
  const adminIds = loadAdminIds(env.ADMIN_IDS);

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env, supabase, adminIds);
    return;
  }

  if (update.message) {
    await handleMessage(update.message, env, supabase, adminIds);
  }
}

async function handleMessage(
  message: any,
  env: Env,
  supabase: any,
  adminIds: string[]
) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || "";
  const messageId = message.message_id;

  const user = {
    id: userId,
    first_name: message.from.first_name,
    username: message.from.username,
  };

  if (text.startsWith("/start")) {
    const refCode = text.split(" ")[1] || undefined;
    await handleStart(env.BOT_TOKEN, supabase, chatId, userId, user, refCode, messageId);
    return;
  }

  if (text === "/menu" || text === "/help") {
    await deleteMessage(env.BOT_TOKEN, chatId, messageId);
    await handleMainMenu(env.BOT_TOKEN, supabase, chatId, 0);
    return;
  }

  if (text === "/admin") {
    if (isAdmin(userId, adminIds)) {
      await deleteMessage(env.BOT_TOKEN, chatId, messageId);
      await handleAdmin(env.BOT_TOKEN, supabase, chatId, userId, 0);
    } else {
      await sendMessage(env.BOT_TOKEN, { chat_id: chatId, text: "❌ Not authorized." });
    }
    return;
  }

  if (USER_MENU_BUTTONS.includes(text) || ADMIN_MENU_BUTTONS.includes(text)) {
    await deleteMessage(env.BOT_TOKEN, chatId, messageId);
  }

  if (USER_MENU_BUTTONS.includes(text)) {
    const miniAppUrl = await getSetting(supabase, "mini_app_url");
    if (miniAppUrl) {
      await sendMessage(env.BOT_TOKEN, {
        chat_id: chatId,
        text: launchMessageText(),
        reply_markup: launchMessageKeyboard(miniAppUrl),
      });
      return;
    }
  }

  if (text === "💵 Wallet") { await handleWallet(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "👥 Refer") { await handleRefer(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "🏆 Leaderboard") { await handleLeaderboard(env.BOT_TOKEN, supabase, chatId, userId, messageId, 1); return; }
  if (text === "ℹ️ About") { await handleAbout(env.BOT_TOKEN, chatId, messageId); return; }
  if (text === "💸 Withdraw") { await handleWithdraw(env.BOT_TOKEN, supabase, chatId, userId, messageId); return; }
  if (text === "⬅️ Back to Menu") { await handleMainMenu(env.BOT_TOKEN, supabase, chatId, messageId); return; }

  if (adminIds.includes(String(userId))) {
    if (text === "📊 Stats") { await handleAdminStats(env.BOT_TOKEN, supabase, chatId, "admin_stats"); return; }
    if (text === "📢 Add Channel") { await handleAdminAddChannel(env.BOT_TOKEN, supabase, chatId, userId, "admin_add_ch"); return; }
    if (text === "🗑️ Remove Channel") { await handleAdminRemoveChannel(env.BOT_TOKEN, supabase, chatId, userId, "admin_rm_ch"); return; }
    if (text === "📋 List Channels") { await handleAdminListChannels(env.BOT_TOKEN, supabase, chatId, "admin_list_ch"); return; }
    if (text === "📝 Claim Msg") { await handleAdminClaimMsg(env.BOT_TOKEN, supabase, chatId, userId, "admin_claim_msg"); return; }
    if (text === "📢 Broadcast") { await handleAdminBroadcast(env.BOT_TOKEN, supabase, chatId, userId, "admin_broadcast"); return; }
    if (text === "🔍 User Info") { await handleAdminUserInfo(env.BOT_TOKEN, supabase, chatId, userId, "admin_user"); return; }
    if (text === "💰 Ref Points") { await handleAdminRefPoints(env.BOT_TOKEN, supabase, chatId, userId, "admin_ref_pts"); return; }
    if (text === "🎁 Daily Bonus") { await handleAdminDailyBonus(env.BOT_TOKEN, supabase, chatId, userId, "admin_daily"); return; }
    if (text === "🔗 Mini App URL") { await handleAdminMiniApp(env.BOT_TOKEN, supabase, chatId, userId, "admin_miniapp"); return; }
    if (text === "🗑️ Remove Mini App URL") { await handleAdminRemoveMiniApp(env.BOT_TOKEN, supabase, chatId, userId, "admin_rm_miniapp"); return; }
    if (text === "🗑️ Reset Data") { await handleAdminResetData(env.BOT_TOKEN, supabase, chatId, userId, "admin_reset"); return; }
  }

  if (adminIds.includes(String(userId)) && text && !text.startsWith("/")) {
    await handleAdminInput(env.BOT_TOKEN, supabase, chatId, userId, text);
    return;
  }

  if (adminIds.includes(String(userId))) {
    const { broadcastConfirmKeyboard } = await import("./keyboards");
    const { BROADCAST_PENDING: BP } = await import("./handlers/admin");

    BP[userId] = {
      chatId: chatId,
      messageId: messageId,
    };

    await copyMessage(env.BOT_TOKEN, chatId, chatId, messageId);

    await sendMessage(env.BOT_TOKEN, {
      chat_id: chatId,
      text: "📤 <b>Send this message to all users?</b>",
      reply_markup: broadcastConfirmKeyboard(),
    });

    return;
  }
}

async function handleCallbackQuery(
  callbackQuery: any,
  env: Env,
  supabase: any,
  adminIds: string[]
) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message?.message_id;
  const callbackQueryId = callbackQuery.id;

  const user = {
    id: userId,
    first_name: callbackQuery.from.first_name,
    username: callbackQuery.from.username,
  };

  if (data === "verify_continue") {
    await handleVerifyContinue(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId, messageId);
    return;
  }

  if (data === "claim_daily") {
    await handleDailyClaim(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId, messageId);
    return;
  }

  if (data.startsWith("lb_page_")) {
    const page = parseInt(data.replace("lb_page_", "")) || 1;
    await handleLeaderboard(env.BOT_TOKEN, supabase, chatId, userId, messageId, page);
    return;
  }

  if (data === "claim_coming_soon") {
    await handleClaimComingSoon(env.BOT_TOKEN, chatId, callbackQueryId);
    return;
  }

  if (data.startsWith("admin_rm_ch_")) {
    if (isAdmin(userId, adminIds)) {
      await handleAdminRemoveChannelConfirm(env.BOT_TOKEN, supabase, chatId, data.replace("admin_rm_ch_", ""), callbackQueryId);
    }
    return;
  }

  if (data === "admin_rm_miniapp_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminRemoveMiniAppYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  if (data === "admin_broadcast_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminBroadcastYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  if (data === "broadcast_send") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminBroadcastSend(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId);
    }
    return;
  }

  if (data === "admin_reset_yes") {
    if (isAdmin(userId, adminIds)) {
      await handleAdminResetDataYes(env.BOT_TOKEN, supabase, chatId, callbackQueryId);
    }
    return;
  }

  if (data === "admin") {
    if (isAdmin(userId, adminIds)) {
      await handleAdmin(env.BOT_TOKEN, supabase, chatId, userId, messageId);
    }
    return;
  }

  if (data === "noop") {
    await answerCallbackQuery(env.BOT_TOKEN, { callback_query_id: callbackQueryId });
    return;
  }
}
