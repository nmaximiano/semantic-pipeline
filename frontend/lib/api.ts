import { supabase } from "./supabase";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}
