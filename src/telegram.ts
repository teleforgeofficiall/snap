import { BOT_API } from "./config";

interface SendMessageOpts {
  chat_id: number | string;
  text: string;
  parse_mode?: string;
  reply_markup?: object;
}

interface AnswerCallbackOpts {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export async function sendMessage(
  token: string,
  opts: SendMessageOpts
): Promise<any> {
  const res = await fetch(`${BOT_API(token)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...opts,
      parse_mode: opts.parse_mode ?? "HTML",
    }),
  });
  return res.json();
}

export async function copyMessage(
  token: string,
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  reply_markup?: object
): Promise<any> {
  const body: any = {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  };
  if (reply_markup) {
    body.reply_markup = reply_markup;
  }
  const res = await fetch(`${BOT_API(token)}/copyMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function deleteMessage(
  token: string,
  chatId: number,
  messageId: number
): Promise<any> {
  const res = await fetch(`${BOT_API(token)}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
  return res.json();
}

export async function answerCallbackQuery(
  token: string,
  opts: AnswerCallbackOpts
): Promise<any> {
  const res = await fetch(`${BOT_API(token)}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return res.json();
}

export async function getChatMember(
  token: string,
  chatId: string | number,
  userId: number
): Promise<any> {
  const res = await fetch(`${BOT_API(token)}/getChatMember`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, user_id: userId }),
  });
  return res.json();
}

export async function getUpdates(
  token: string,
  offset?: number
): Promise<any> {
  const url = `${BOT_API(token)}/getUpdates${offset ? `?offset=${offset}` : ""}`;
  const res = await fetch(url);
  return res.json();
}

export async function setWebhook(
  token: string,
  url: string
): Promise<any> {
  const res = await fetch(`${BOT_API(token)}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, allowed_updates: ["message", "callback_query"] }),
  });
  return res.json();
}
