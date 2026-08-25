# Deposit GRAM Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete Deposit GRAM flow in the Advertise section with wallet address display, amount input, sender wallet verification, admin approval/rejection, and deposit history tracking.

**Architecture:** Add new database tables for deposits, create a new deposit handler with multi-step state machine flow, add admin approval endpoints, and display deposit history. The deposit button will be in the Advertise section only (NOT in Wallet).

**Tech Stack:** TypeScript, Cloudflare Workers, Supabase, Telegram Bot API

---

## Requirements Restatement

### Core Requirements:
1. **Deposit GRAM Button Location:** ONLY in the Advertise section. NOT in Wallet section.
2. **Deposit Flow (12 steps):**
   - User clicks Deposit GRAM button
   - Shows Snapbucks wallet address + Copy button
   - User enters amount (minimum 1 GRAM, decimals allowed)
   - User clicks "Add Fund" button
   - New input appears for sender wallet address
   - User enters their sender wallet address (format: UQAX9aBtG6o1g-CjHRZeIaUPQMFyPWnB0wd_UPyTG_G2m0HF)
   - User clicks "Submit" button
   - Deposit request goes to admin panel
   - Admin can Accept or Reject
   - On Accept: GRAM added to user balance, status "Completed"
   - On Reject: Deposit cancelled, status "Rejected"
   - Deposit History shows: Amount, Sender Wallet, Date & Time, Status

3. **Issues to Fix:**
   - Remove Deposit GRAM button from Wallet section
   - Fix Recent Requests and Deposit History display
   - Ensure Deposit History loads correctly (not showing "Loading...")

### Database Tables Needed:
- `gram_deposits` - Store deposit requests with status tracking

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `schema.sql` | Modify | Add `gram_deposits` table |
| `src/handlers/deposit.ts` | Create | Deposit flow handler with state machine |
| `src/keyboards.ts` | Modify | Add deposit keyboards |
| `src/index.ts` | Modify | Add deposit route handlers |
| `src/handlers/admin.ts` | Modify | Add admin deposit approval handlers |

---

## Implementation Phases

### Phase 1: Database Schema (1 file)
- [ ] **Step 1.1:** Add `gram_deposits` table to schema.sql
- [ ] **Step 1.2:** Run migration to create table in Supabase

### Phase 2: Deposit Handler (1 file)
- [ ] **Step 2.1:** Create `src/handlers/deposit.ts` with state machine
- [ ] **Step 2.2:** Implement `handleDepositStart()` - shows wallet address
- [ ] **Step 2.3:** Implement `handleDepositAmount()` - validates amount input
- [ ] **Step 2.4:** Implement `handleDepositAddFund()` - shows sender wallet input
- [ ] **Step 2.5:** Implement `handleDepositSubmit()` - creates deposit request
- [ ] **Step 2.6:** Implement `handleDepositHistory()` - shows deposit history

### Phase 3: Keyboards (1 file)
- [ ] **Step 3.1:** Add `depositKeyboard()` - shows wallet address + copy
- [ ] **Step 3.2:** Add `depositAmountKeyboard()` - amount input + Add Fund button
- [ ] **Step 3.3:** Add `depositSenderKeyboard()` - sender wallet input + Submit
- [ ] **Step 3.4:** Add `depositHistoryKeyboard()` - history display
- [ ] **Step 3.5:** Add `adminDepositApproveKeyboard()` - Accept/Reject buttons

### Phase 4: Admin Handlers (1 file)
- [ ] **Step 4.1:** Add `handleAdminListDeposits()` - list pending deposits
- [ ] **Step 4.2:** Add `handleAdminApproveDeposit()` - approve and credit GRAM
- [ ] **Step 4.3:** Add `handleAdminRejectDeposit()` - reject deposit
- [ ] **Step 4.4:** Add admin deposit notification messages

### Phase 5: Index Integration (1 file)
- [ ] **Step 5.1:** Add deposit button handler in Advertise section
- [ ] **Step 5.2:** Add callback query handlers for deposit flow
- [ ] **Step 5.3:** Add text input handlers for deposit state machine
- [ ] **Step 5.4:** Add admin deposit handlers
- [ ] **Step 5.5:** Remove Deposit GRAM button from Wallet section (if exists)

### Phase 6: Testing & Verification
- [ ] **Step 6.1:** Test deposit flow end-to-end
- [ ] **Step 6.2:** Test admin approval/rejection
- [ ] **Step 6.3:** Test deposit history display
- [ ] **Step 6.4:** Verify Wallet section has NO deposit button

---

## Task Details

### Task 1: Database Schema

**Files:**
- Modify: `schema.sql`

**Step 1.1:** Add gram_deposits table

```sql
-- Gram Deposits table
CREATE TABLE IF NOT EXISTS gram_deposits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(20,8) NOT NULL,
  sender_wallet TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gram_deposits_user ON gram_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_gram_deposits_status ON gram_deposits(status);
```

**Step 1.2:** Run migration
```bash
# Execute the SQL in Supabase dashboard or via CLI
```

---

### Task 2: Deposit Handler

**Files:**
- Create: `src/handlers/deposit.ts`

**Interfaces:**
- Consumes: `SupabaseClient`, Telegram API functions
- Produces: `handleDepositStart()`, `handleDepositAmount()`, `handleDepositAddFund()`, `handleDepositSubmit()`, `handleDepositHistory()`

**Step 2.1:** Create state machine and handler file

```typescript
import { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage, answerCallbackQuery } from "../telegram";
import { 
  depositKeyboard, 
  depositAmountKeyboard, 
  depositSenderKeyboard,
  depositHistoryKeyboard 
} from "../keyboards";

// Deposit state machine
const DEPOSIT_STATE: Record<number, { 
  action: string; 
  amount?: number;
  walletAddress?: string;
}> = {};

// Snapbucks deposit wallet address (from settings or hardcoded)
const SNAPBUCKS_WALLET = "UQAX9aBtG6o1g-CjHRZeIaUPQMFyPWnB0wd_UPyTG_G2m0HF";

export async function handleDepositStart(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId: number
) {
  await deleteMessage(token, chatId, messageId);
  
  await sendMessage(token, {
    chat_id: chatId,
    text: `💰 <b>Deposit GRAM</b>

Send GRAM to this address:
<code>${SNAPBUCKS_WALLET}</code>

Minimum deposit: 1 GRAM (decimals allowed)

Enter amount (Gram):`,
    reply_markup: depositKeyboard(SNAPBUCKS_WALLET),
  });
  
  DEPOSIT_STATE[userId] = { action: "waiting_amount" };
}

export async function handleDepositAmountInput(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  text: string
): Promise<boolean> {
  const state = DEPOSIT_STATE[userId];
  if (!state || state.action !== "waiting_amount") return false;
  
  const amount = parseFloat(text.trim());
  if (isNaN(amount) || amount < 1) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ Invalid amount. Minimum deposit is 1 GRAM.",
    });
    return true;
  }
  
  DEPOSIT_STATE[userId] = { action: "waiting_add_fund", amount };
  
  await sendMessage(token, {
    chat_id: chatId,
    text: `✅ Amount: <b>${amount} GRAM</b>

Click "Add Fund" to continue:`,
    reply_markup: depositAmountKeyboard(amount),
  });
  
  return true;
}

export async function handleDepositAddFund(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });
  
  const state = DEPOSIT_STATE[userId];
  if (!state || state.action !== "waiting_add_fund") {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ Session expired. Please try again.",
      show_alert: true,
    });
    return;
  }
  
  DEPOSIT_STATE[userId] = { action: "waiting_sender_wallet", amount: state.amount };
  
  await sendMessage(token, {
    chat_id: chatId,
    text: `📤 <b>Enter Sender Wallet Address</b>

Enter the wallet address from which you sent ${state.amount} GRAM:

Example: <code>UQAX9aBtG6o1g-CjHRZeIaUPQMFyPWnB0wd_UPyTG_G2m0HF</code>`,
    reply_markup: depositSenderKeyboard(),
  });
}

export async function handleDepositSenderInput(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  text: string
): Promise<boolean> {
  const state = DEPOSIT_STATE[userId];
  if (!state || state.action !== "waiting_sender_wallet") return false;
  
  const walletAddress = text.trim();
  if (!walletAddress.startsWith("UQ") || walletAddress.length < 20) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ Invalid wallet address. Please enter a valid TON wallet address.",
    });
    return true;
  }
  
  // Get user UUID
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_id", userId)
    .single();
  
  if (!user) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ User not found.",
    });
    delete DEPOSIT_STATE[userId];
    return true;
  }
  
  // Create deposit request
  const { error } = await supabase.from("gram_deposits").insert({
    user_id: user.id,
    amount: state.amount,
    sender_wallet: walletAddress,
    status: "pending",
  });
  
  delete DEPOSIT_STATE[userId];
  
  if (error) {
    await sendMessage(token, {
      chat_id: chatId,
      text: `❌ Error: ${error.message}`,
    });
  } else {
    await sendMessage(token, {
      chat_id: chatId,
      text: `✅ <b>Deposit Request Submitted!</b>

Amount: <b>${state.amount} GRAM</b>
Sender: <code>${walletAddress}</code>
Status: ⏳ Pending

Your request is under review. You will be notified once approved.`,
    });
  }
  
  return true;
}

export async function handleDepositHistory(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  userId: number,
  messageId?: number
) {
  if (messageId) await deleteMessage(token, chatId, messageId);
  
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_id", userId)
    .single();
  
  if (!user) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ User not found.",
    });
    return;
  }
  
  const { data: deposits } = await supabase
    .from("gram_deposits")
    .select("amount, sender_wallet, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (!deposits || deposits.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "📋 <b>Deposit History</b>\n\nNo deposits yet.",
      reply_markup: depositHistoryKeyboard([]),
    });
    return;
  }
  
  let text = "📋 <b>Deposit History</b>\n\n";
  for (const d of deposits) {
    const status = d.status === "completed" ? "✅" : d.status === "rejected" ? "❌" : "⏳";
    const date = new Date(d.created_at).toLocaleDateString();
    text += `${status} <b>${d.amount} GRAM</b>\n`;
    text += `   Sender: <code>${d.sender_wallet.slice(0, 20)}...</code>\n`;
    text += `   Date: ${date}\n\n`;
  }
  
  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: depositHistoryKeyboard(deposits),
  });
}
```

---

### Task 3: Keyboards

**Files:**
- Modify: `src/keyboards.ts`

**Step 3.1:** Add deposit keyboards at the end of the file

```typescript
// Deposit GRAM keyboards

// Deposit keyboard - shows wallet address
export function depositKeyboard(walletAddress: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "📋 Copy Address",
          callback_data: "deposit_copy_address",
        },
      ],
    ],
  };
}

// Deposit amount keyboard - after amount entered
export function depositAmountKeyboard(amount: number) {
  return {
    inline_keyboard: [
      [
        {
          text: `➕ Add Fund (${amount} GRAM)`,
          callback_data: "deposit_add_fund",
        },
      ],
    ],
  };
}

// Deposit sender wallet keyboard
export function depositSenderKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Submit",
          callback_data: "deposit_submit",
        },
      ],
    ],
  };
}

// Deposit history keyboard
export function depositHistoryKeyboard(deposits: any[]) {
  return {
    inline_keyboard: [],
  };
}

// Admin deposit approve/reject keyboard
export function adminDepositApproveKeyboard(depositId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Accept", callback_data: `admin_deposit_accept_${depositId}` },
        { text: "❌ Reject", callback_data: `admin_deposit_reject_${depositId}` },
      ],
    ],
  };
}
```

---

### Task 4: Admin Handlers

**Files:**
- Modify: `src/handlers/admin.ts`

**Step 4.1:** Add admin deposit handlers

```typescript
// Add to admin.ts

export async function handleAdminListDeposits(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });
  
  const { data: deposits } = await supabase
    .from("gram_deposits")
    .select(`
      id, amount, sender_wallet, status, created_at,
      users(telegram_id, first_name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (!deposits || deposits.length === 0) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "📋 No pending deposits.",
      reply_markup: backToAdminInline(),
    });
    return;
  }
  
  let text = "📋 <b>Pending Deposits</b>\n\n";
  const buttons: any[] = [];
  
  for (const d of deposits) {
    const user = d.users as any;
    text += `💰 <b>${d.amount} GRAM</b>\n`;
    text += `   User: ${user?.first_name} (${user?.telegram_id})\n`;
    text += `   Sender: <code>${d.sender_wallet.slice(0, 25)}...</code>\n`;
    text += `   Date: ${new Date(d.created_at).toLocaleDateString()}\n\n`;
    
    buttons.push([
      {
        text: `✅ Review ${d.amount} GRAM`,
        callback_data: `admin_deposit_review_${d.id}`,
      },
    ]);
  }
  
  buttons.push([{ text: "⬅️ Back to Admin", callback_data: "admin" }]);
  
  await sendMessage(token, {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function handleAdminReviewDeposit(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  depositId: string,
  callbackQueryId: string
) {
  await answerCallbackQuery(token, { callback_query_id: callbackQueryId });
  
  const { data: deposit } = await supabase
    .from("gram_deposits")
    .select(`
      id, amount, sender_wallet, status, created_at,
      users(telegram_id, first_name, gram)
    `)
    .eq("id", depositId)
    .single();
  
  if (!deposit) {
    await sendMessage(token, {
      chat_id: chatId,
      text: "❌ Deposit not found.",
      reply_markup: backToAdminInline(),
    });
    return;
  }
  
  const user = deposit.users as any;
  
  await sendMessage(token, {
    chat_id: chatId,
    text: `🔍 <b>Deposit Review</b>

💰 Amount: <b>${deposit.amount} GRAM</b>
👤 User: ${user?.first_name} (${user?.telegram_id})
📤 Sender: <code>${deposit.sender_wallet}</code>
📅 Date: ${new Date(deposit.created_at).toLocaleString()}
💳 Current Balance: ${user?.gram || 0} GRAM`,
    reply_markup: adminDepositApproveKeyboard(depositId),
  });
}

export async function handleAdminApproveDeposit(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  depositId: string,
  callbackQueryId: string
) {
  const { data: deposit } = await supabase
    .from("gram_deposits")
    .select("id, amount, user_id, users(telegram_id, gram)")
    .eq("id", depositId)
    .single();
  
  if (!deposit) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ Deposit not found.",
    });
    return;
  }
  
  const user = deposit.users as any;
  
  // Update deposit status
  await supabase
    .from("gram_deposits")
    .update({ 
      status: "completed",
      reviewed_at: new Date().toISOString()
    })
    .eq("id", depositId);
  
  // Credit GRAM to user
  await supabase
    .from("users")
    .update({ gram: (user?.gram || 0) + deposit.amount })
    .eq("id", deposit.user_id);
  
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "✅ Deposit approved!",
  });
  
  // Notify user
  await sendMessage(token, {
    chat_id: user?.telegram_id,
    text: `✅ <b>Deposit Approved!</b>

<b>${deposit.amount} GRAM</b> has been added to your wallet.

Your new balance: ${(user?.gram || 0) + deposit.amount} GRAM`,
  });
  
  // Back to admin
  await sendMessage(token, {
    chat_id: chatId,
    text: `✅ Deposit approved! ${deposit.amount} GRAM credited to user.`,
    reply_markup: backToAdminInline(),
  });
}

export async function handleAdminRejectDeposit(
  token: string,
  supabase: SupabaseClient,
  chatId: number,
  depositId: string,
  callbackQueryId: string
) {
  const { data: deposit } = await supabase
    .from("gram_deposits")
    .select("id, amount, user_id, users(telegram_id)")
    .eq("id", depositId)
    .single();
  
  if (!deposit) {
    await answerCallbackQuery(token, {
      callback_query_id: callbackQueryId,
      text: "❌ Deposit not found.",
    });
    return;
  }
  
  const user = deposit.users as any;
  
  // Update deposit status
  await supabase
    .from("gram_deposits")
    .update({ 
      status: "rejected",
      reviewed_at: new Date().toISOString()
    })
    .eq("id", depositId);
  
  await answerCallbackQuery(token, {
    callback_query_id: callbackQueryId,
    text: "❌ Deposit rejected.",
  });
  
  // Notify user
  await sendMessage(token, {
    chat_id: user?.telegram_id,
    text: `❌ <b>Deposit Rejected</b>

Your deposit of <b>${deposit.amount} GRAM</b> has been rejected.

Please contact support for more information.`,
  });
  
  // Back to admin
  await sendMessage(token, {
    chat_id: chatId,
    text: `❌ Deposit rejected.`,
    reply_markup: backToAdminInline(),
  });
}
```

---

### Task 5: Index Integration

**Files:**
- Modify: `src/index.ts`

**Step 5.1:** Add deposit imports and handlers

```typescript
// Add imports at top
import {
  handleDepositStart,
  handleDepositAmountInput,
  handleDepositAddFund,
  handleDepositSenderInput,
  handleDepositHistory,
} from "./handlers/deposit";

import {
  handleAdminListDeposits,
  handleAdminReviewDeposit,
  handleAdminApproveDeposit,
  handleAdminRejectDeposit,
} from "./handlers/admin";
```

**Step 5.2:** Add deposit button handler in handleMessage

```typescript
// Add after "💸 Withdraw" handler
if (text === "💰 Deposit GRAM") { 
  await handleDepositStart(env.BOT_TOKEN, supabase, chatId, userId, messageId); 
  return; 
}

if (text === "📋 Deposit History") { 
  await handleDepositHistory(env.BOT_TOKEN, supabase, chatId, userId, messageId); 
  return; 
}
```

**Step 5.3:** Add callback query handlers in handleCallbackQuery

```typescript
// Deposit callbacks
if (data === "deposit_copy_address") {
  await answerCallbackQuery(env.BOT_TOKEN, { 
    callback_query_id: callbackQueryId,
    text: "📋 Address copied!",
  });
  return;
}

if (data === "deposit_add_fund") {
  await handleDepositAddFund(env.BOT_TOKEN, supabase, chatId, userId, callbackQueryId);
  return;
}

if (data === "deposit_submit") {
  // This will be handled by text input
  return;
}

// Admin deposit callbacks
if (data.startsWith("admin_deposit_review_")) {
  if (isAdmin(userId, adminIds)) {
    const depositId = data.replace("admin_deposit_review_", "");
    await handleAdminReviewDeposit(env.BOT_TOKEN, supabase, chatId, depositId, callbackQueryId);
  }
  return;
}

if (data.startsWith("admin_deposit_accept_")) {
  if (isAdmin(userId, adminIds)) {
    const depositId = data.replace("admin_deposit_accept_", "");
    await handleAdminApproveDeposit(env.BOT_TOKEN, supabase, chatId, depositId, callbackQueryId);
  }
  return;
}

if (data.startsWith("admin_deposit_reject_")) {
  if (isAdmin(userId, adminIds)) {
    const depositId = data.replace("admin_deposit_reject_", "");
    await handleAdminRejectDeposit(env.BOT_TOKEN, supabase, chatId, depositId, callbackQueryId);
  }
  return;
}
```

**Step 5.4:** Add text input handlers for deposit state

```typescript
// Add before admin text input handler
// Deposit text inputs
const depositHandled = await handleDepositAmountInput(
  env.BOT_TOKEN, supabase, chatId, userId, text
);
if (depositHandled) return;

const senderHandled = await handleDepositSenderInput(
  env.BOT_TOKEN, supabase, chatId, userId, text
);
if (senderHandled) return;
```

**Step 5.5:** Add admin button for deposits

```typescript
// In ADMIN_MENU_BUTTONS array, add:
"💰 List Deposits"

// In admin buttons section, add:
if (text === "💰 List Deposits") { 
  await handleAdminListDeposits(env.BOT_TOKEN, supabase, chatId, "admin_list_deposits"); 
  return; 
}
```

---

## Testing Strategy

- **Unit Tests:** Test deposit state machine transitions, amount validation, wallet address validation
- **Integration Tests:** Test full deposit flow, admin approval/rejection, balance updates
- **E2E Tests:** Test complete user journey from deposit to admin approval

---

## Risks & Mitigations

- **HIGH:** Deposit state machine race conditions - Use proper state cleanup and timeout handling
- **MEDIUM:** Wallet address validation - Implement strict TON address format validation
- **MEDIUM:** Admin notification delivery - Add retry logic for failed notifications
- **LOW:** History display performance - Limit query results and add pagination

---

## Success Criteria

- [ ] Deposit GRAM button ONLY in Advertise section, NOT in Wallet
- [ ] Full 12-step deposit flow works correctly
- [ ] Admin can approve/reject deposits
- [ ] User gets notified on approval/rejection
- [ ] GRAM balance updates on approval
- [ ] Deposit History shows all deposits with correct status
- [ ] No "Loading..." issues in deposit history
- [ ] No deposit button in Wallet section

---

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)
