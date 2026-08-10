import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage, answerCallbackQuery, getChatMember } from "../telegram";
import { welcomeKeyboard, launchMessageText, launchMessageKeyboard, mainMenuKeyboard } from "../keyboards";
import { generateReferralCode, getSetting } from "../utils";

const CHANNEL_ID = -1003697895532;

interface StartUser {
  id: number;
  first_name: string;
  username?: string;
}

export async function handleStart(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  user: StartUser,
  referralCode?: string,
  messageId?: number
) {
  // Create user if new
  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", userId)
    .single();

  if (!existingUser) {
    const myRefCode = generateReferralCode(userId);

    const newUser: any = {
      telegram_id: userId,
      first_name: user.first_name,
      username: user.username || null,
      referral_code: myRefCode,
    };

    let referrerId: string | null = null;
    let referrerTelegramId: number | null = null;

    if (referralCode) {
      const { data: referrer } = await supabase
        .from("users")
        .select("id, telegram_id")
        .eq("referral_code", referralCode)
        .single();

      if (referrer) {
        newUser.referred_by = referrer.id;
        referrerId = referrer.id;
        referrerTelegramId = referrer.telegram_id;
      }
    }

    const { error: insertError } = await supabase
      .from("users")
      .insert(newUser);

    if (insertError) {
      console.error("Insert error:", insertError);
      return;
    }

    // Notify referrer: new user joined via their link
    if (referrerTelegramId) {
      const newUsername = user.username ? `@${user.username}` : user.first_name;
      await sendMessage(token, {
        chat_id: referrerTelegramId,
        text: `🔗 <b>New Referral!</b>\n\n<b>${newUsername}</b> joined using your referral link.\n\nWhen they verify by joining the channel, you'll earn SNAP! 🪙`,
      });
    }

    // Store referrer info for verification notification
    if (referrerId && referrerTelegramId) {
      // Store in a temporary way - we'll use referred_by to find referrer on verify
      await supabase.from("referrals").insert({
        referrer_id: referrerId,
        referred_id: newUser.id || userId,
      });
    }
  }

  // Check if Mini App is live
  const miniAppUrl = await getSetting(supabase, "mini_app_url");

  // Check channel membership first
  const result = await getChatMember(token, CHANNEL_ID, userId);
  const status = result?.result?.status;
  const isMember = status === "member" || status === "administrator" || status === "creator";

  if (isMember) {
    // User is already a member — show main menu directly
    if (miniAppUrl) {
      await sendMessage(token, {
        chat_id: chatId,
        text: launchMessageText(),
        reply_markup: launchMessageKeyboard(miniAppUrl),
      });
    } else {
      await sendMessage(token, {
        chat_id: chatId,
        text: mainMenuText(),
        reply_markup: mainMenuKeyboard(),
      });
    }
  } else {
    // User is NOT a member — show welcome with join buttons
    await sendMessage(token, {
      chat_id: chatId,
      text: welcomeText(),
      reply_markup: welcomeKeyboard(),
    });
  }
}

export async function handleVerifyContinue(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string,
  messageId: number
) {
  const result = await getChatMember(token, CHANNEL_ID, userId);
  const status = result?.result?.status;
  const isMember = status === "member" || status === "administrator" || status === "creator";

  if (isMember) {
    // Delete old message
    await deleteMessage(token, chatId, messageId);
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "✅ Verified! Welcome to Snapbucks!",
    });

    // Check if this user was referred by someone
    const { data: user } = await supabase
      .from("users")
      .select("referred_by, username, first_name, referral_count")
      .eq("telegram_id", userId)
      .single();

    // Update eligible flag if user already has 5+ referrals
    if (user && user.referral_count >= 5) {
      await supabase
        .from("users")
        .update({ eligible: true })
        .eq("telegram_id", userId);
    }

    if (user?.referred_by) {
      // Find referrer
      const { data: referrer } = await supabase
        .from("users")
        .select("id, telegram_id, referral_count, balance")
        .eq("id", user.referred_by)
        .single();

      if (referrer) {
        const perRefStr = await getSetting(supabase, "per_referral_points");
        const perRef = parseInt(perRefStr || "100");
        const newUsername = user.username ? `@${user.username}` : user.first_name;
        const newReferralCount = referrer.referral_count + 1;

        // Credit referrer: update referral_count, balance, and eligible flag
        const updateData: any = {
          referral_count: newReferralCount,
          balance: referrer.balance + perRef,
        };

        // Mark eligible if 5+ referrals
        if (newReferralCount >= 5) {
          updateData.eligible = true;
        }

        await supabase
          .from("users")
          .update(updateData)
          .eq("id", referrer.id);

        // Notify referrer: user verified, SNAP credited
        await sendMessage(token, {
          chat_id: referrer.telegram_id,
          text: `🎉 <b>Referral Complete!</b>\n\n<b>${newUsername}</b> joined the channel and verified!\n\nYou earned <b>${perRef} SNAP</b>! 🪙`,
        });
      }
    }

    // Check if Mini App is live
    const miniAppUrl = await getSetting(supabase, "mini_app_url");

    if (miniAppUrl) {
      // MINI APP IS LIVE — show launch message
      await sendMessage(token, {
        chat_id: chatId,
        text: launchMessageText(),
        reply_markup: launchMessageKeyboard(miniAppUrl),
      });
    } else {
      // NOT LIVE — show main menu
      await sendMessage(token, {
        chat_id: chatId,
        text: mainMenuText(),
        reply_markup: mainMenuKeyboard(),
      });
    }
  } else {
    // Delete old message, show welcome again
    await deleteMessage(token, chatId, messageId);
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ Please join our official channel first!",
      show_alert: true,
    });
    await sendMessage(token, {
      chat_id: chatId,
      text: welcomeText(),
      reply_markup: welcomeKeyboard(),
    });
  }
}

function welcomeText(): string {
  return `🎉 <b>Welcome to Snapbucks!</b> 👋

Before you start, Please join our official Telegram channel and follow us on X to stay updated with the latest announcements.

━━━━━━━━━━━━━━━
Complete both steps below to continue.`;
}

function mainMenuText(): string {
  return `🎉 <b>Welcome to Snapbucks!</b> 👋

━━━━━━━━━━━━━━━
Choose an option below to get started: 🚀`;
}
