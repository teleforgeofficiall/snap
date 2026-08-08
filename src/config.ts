export interface Env {
  BOT_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ADMIN_IDS: string;
}

export const ADMIN_IDS: string[] = [];

export function loadAdminIds(adminIdsStr: string): string[] {
  return adminIdsStr.split(",").map((id) => id.trim());
}

export const BOT_API = (token: string) =>
  `https://api.telegram.org/bot${token}`;
