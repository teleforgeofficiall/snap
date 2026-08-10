import "dotenv/config";
import http from "http";
import WebSocket from "ws";
(globalThis as any).WebSocket = WebSocket;
import { Env, loadAdminIds } from "./src/config";
import { getSupabase } from "./src/supabase";
import { sendMessage, copyMessage, deleteMessage, answerCallbackQuery, getUpdates } from "./src/telegram";
import { launchMessageText, launchMessageKeyboard } from "./src/keyboards";
import { handleStart, handleVerifyContinue } from "./src/handlers/start";
import { handleMainMenu } from "./src/handlers/menu";
import { handleWallet, handleDailyClaim } from "./src/handlers/wallet";
import { handleRefer } from "./src/handlers/refer";
import { handleLeaderboard } from "./src/handlers/leaderboard";
import { handleAbout } from "./src/handlers/about";
import {
  handleWithdraw,
  handleClaimComingSoon,
} from "./src/handlers/withdraw";
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
  handleAdminCreateCampaign,
  handleAdminListCampaigns,
  handleAdminAddTask,
  BROADCAST_PENDING,
} from "./src/handlers/admin";
import { getSetting } from "./src/utils";
import { handleApi } from "./src/api";

const USER_MENU_BUTTONS = ["💵 Wallet", "👥 Refer", "🏆 Leaderboard", "ℹ️ About", "💸 Withdraw", "⬅️ Back to Menu"];
const ADMIN_MENU_BUTTONS = ["📊 Stats", "📢 Add Channel", "🗑️ Remove Channel", "📋 List Channels", "📝 Claim Msg", "📢 Broadcast", "🔍 User Info", "💰 Ref Points", "🎁 Daily Bonus", "🔗 Mini App URL", "🗑️ Remove Mini App URL", "🗑️ Reset Data", "🎯 Create Campaign", "📋 List Campaigns", "➕ Add Task"];

const env: Env = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",
  ADMIN_IDS: process.env.ADMIN_IDS || "",
};

const PORT = parseInt(process.env.PORT || "3000", 10);
const MODE = process.env.MODE || "polling";

if (MODE === "webhook") {
  const supabase = getSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);
  
  const server = http.createServer(async (req, res) => {
    // API routes
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res, supabase, env.BOT_TOKEN);
      return;
    }

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
    console.log(`🤖 Snapbucks Bot running on port ${PORT} (webhook mode)`);
    console.log(`📡 API available at http://localhost:${PORT}/api/`);
  });
} else {
  startPolling();
}

async function startPolling() {
  console.log("🤖 Snapbucks Bot starting in polling mode...");
  console.log("Token:", env.BOT_TOKEN ? "SET" : "MISSING");
  console.log("Supabase URL:", env.SUPABASE_URL ? "SET" : "MISSING");

  const supabase = getSupabase(env.SUPABASE_URL, env.SUPABASE_KEY);

  // Start HTTP server for API routes in polling mode too
  const apiServer = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res, supabase, env.BOT_TOKEN);
      return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Snapbucks Telegram Bot is running! (polling mode)");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  apiServer.listen(PORT, () => {
    console.log(`📡 API available at http://localhost:${PORT}/api/`);
  });

  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(env.BOT_TOKEN, offset);
      if (updates.ok && updates.result.length > 0) {
        console.log(`📩 Received ${updates.result.length} update(s)`);
        for (const update of updates.result) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update, env);
          } catch (updateErr) {
            console.error("❌ Error handling update:", updateErr);
          }
        }
      }
    } catch (err) {
      console.error("❌ Polling error:", err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

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
    if (text === "🗑️ Remove Mini App URL") { await handleAdminRemoveMiniApp(env.BOT_TOKEN, supabase, chatId, "admin_rm_miniapp"); return; }
    if (text === "🗑️ Reset Data") { await handleAdminResetData(env.BOT_TOKEN, supabase, chatId, "admin_reset"); return; }
    if (text === "🎯 Create Campaign") { await handleAdminCreateCampaign(env.BOT_TOKEN, supabase, chatId, userId); return; }
    if (text === "📋 List Campaigns") { await handleAdminListCampaigns(env.BOT_TOKEN, supabase, chatId); return; }
    if (text === "➕ Add Task") { await handleAdminAddTask(env.BOT_TOKEN, supabase, chatId, userId); return; }
  }

  if (adminIds.includes(String(userId)) && text && !text.startsWith("/")) {
    await handleAdminInput(env.BOT_TOKEN, supabase, chatId, userId, text);
    return;
  }

  if (adminIds.includes(String(userId))) {
    const { broadcastConfirmKeyboard } = await import("./src/keyboards");
    const { BROADCAST_PENDING: BP } = await import("./src/handlers/admin");

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
