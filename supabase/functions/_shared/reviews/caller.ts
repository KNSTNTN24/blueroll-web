// supabase/functions/_shared/reviews/caller.ts
// Who is calling a reviews edge function: a signed-in, active member holding manage_reviews in their own business.
// The capability is checked with the caller's own JWT (has_capability reads auth.uid()), never from the request body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Caller } from "./connect.ts";

// deno-lint-ignore no-explicit-any
export async function reviewsCaller(admin: any, supabaseUrl: string, anonKey: string, jwt: string): Promise<Caller | null> {
  if (!jwt) return null;
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: me, error } = await admin.from("profiles").select("business_id, full_name").eq("id", u.user.id).is("removed_at", null).maybeSingle();
  if (error) throw error;
  if (!me?.business_id) return null;
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: ok, error: capErr } = await asUser.rpc("can_manage_reviews", { b: me.business_id });
  if (capErr) throw capErr;
  return ok ? { profile_id: u.user.id, business_id: me.business_id, name: String(me.full_name ?? "").trim() || "Manager" } : null;
}
