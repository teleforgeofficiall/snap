// Inline keyboard for Welcome screen (3 buttons)
export function welcomeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📢 Join Official Channel", url: "https://t.me/Snapbucks_Official" },
      ],
      [
        { text: "✖️ Follow on X", url: "https://x.com/Snapbucks_" },
      ],
      [
        { text: "Continue ➡️", callback_data: "verify_continue" },
      ],
    ],
  };
}

// Reply Keyboard for Main Menu
export function mainMenuKeyboard() {
  return {
    keyboard: [
      [
        { text: "💵 Wallet" },
        { text: "👥 Refer" },
      ],
      [
        { text: "🏆 Leaderboard" },
        { text: "ℹ️ About" },
      ],
      [{ text: "💸 Withdraw" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// Inline keyboard for Wallet daily claim
export function walletClaimKeyboard(claimed: boolean) {
  return {
    inline_keyboard: [
      [
        {
          text: claimed ? "✅ Claimed Today" : "📅 Claim Daily Bonus",
          callback_data: claimed ? "noop" : "claim_daily",
        },
      ],
    ],
  };
}

// Inline keyboard for Refer leaderboard link
export function referInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🏆 View Leaderboard", callback_data: "menu_leaderboard" }],
    ],
  };
}

// Inline keyboard for Leaderboard load more
export function leaderboardLoadMoreKeyboard(currentPage: number, totalItems: number) {
  const buttons: any[] = [];

  if (currentPage * 20 < totalItems) {
    buttons.push([
      {
        text: "Load More ⬇️",
        callback_data: `lb_page_${currentPage + 1}`,
      },
    ]);
  }

  return { inline_keyboard: buttons };
}

// Inline keyboard for About channel link
export function aboutInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📢 Official Channel",
          url: "https://t.me/Snapbucks_Official",
        },
      ],
    ],
  };
}

// Inline keyboard for Withdraw claim button
export function withdrawClaimKeyboard(miniAppUrl: string | null) {
  if (miniAppUrl) {
    return {
      inline_keyboard: [
        [
          {
            text: "🎁 CLAIM SNAP",
            web_app: { url: miniAppUrl },
          },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text: "🎁 CLAIM SNAP",
          callback_data: "claim_coming_soon",
        },
      ],
    ],
  };
}

// Reply Keyboard for Admin Panel
export function adminPanelKeyboard() {
  return {
    keyboard: [
      [
        { text: "📊 Stats" },
        { text: "📢 Add Channel" },
      ],
      [
        { text: "🗑️ Remove Channel" },
        { text: "📋 List Channels" },
      ],
      [
        { text: "📝 Claim Msg" },
        { text: "📢 Broadcast" },
      ],
      [
        { text: "🔍 User Info" },
        { text: "💰 Ref Points" },
      ],
      [
        { text: "🎁 Daily Bonus" },
        { text: "🔗 Mini App URL" },
      ],
      [
        { text: "🗑️ Remove Mini App URL" },
        { text: "🗑️ Reset Data" },
      ],
      [{ text: "⬅️ Back to Menu" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

// Launch message text (shown when Mini App is live)
export function launchMessageText(): string {
  return `🚀 <b>Snapbucks Mini App Is Now Live!</b>

<blockquote>The wait is over. Snapbucks has officially launched!</blockquote>

🎁 Your SNAP Coins have been added to your account automatically based on your eligible points.

💰 From now on, all rewards, earnings, tasks, games, referrals, and future airdrops will be available exclusively in the Snapbucks Mini App.

━━━━━━━━━━━━━━━
👇 Tap the button below to open Snapbucks and continue your journey.`;
}

// Launch message inline keyboard (web_app button)
export function launchMessageKeyboard(miniAppUrl: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "🚀 Open Snapbucks",
          web_app: { url: miniAppUrl },
        },
      ],
    ],
  };
}

// Inline keyboard for admin (back button inside messages)
export function backToAdminInline() {
  return {
    inline_keyboard: [
      [{ text: "⬅️ Back to Admin", callback_data: "admin" }],
    ],
  };
}

// Confirm remove Mini App URL
export function confirmRemoveMiniAppKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Yes, Remove", callback_data: "admin_rm_miniapp_yes" },
        { text: "❌ Cancel", callback_data: "admin" },
      ],
    ],
  };
}

// Confirm broadcast after URL set
export function confirmBroadcastKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📢 Yes, Broadcast", callback_data: "admin_broadcast_yes" },
        { text: "❌ No, Skip", callback_data: "admin" },
      ],
    ],
  };
}

// Confirm reset data
export function confirmResetDataKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Yes, Reset Everything", callback_data: "admin_reset_yes" },
        { text: "❌ Cancel", callback_data: "admin" },
      ],
    ],
  };
}

// Broadcast confirm keyboard
export function broadcastConfirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📤 Send to All", callback_data: "broadcast_send" },
        { text: "❌ Cancel", callback_data: "admin" },
      ],
    ],
  };
}

// Broadcast success keyboard
export function broadcastSuccessKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "⬅️ Back to Admin", callback_data: "admin" }],
    ],
  };
}
