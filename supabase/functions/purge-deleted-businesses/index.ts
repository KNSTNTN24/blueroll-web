import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Runs daily via pg_cron -> net.http_post (see migration
// 20260712170000_purge_cron_via_edge_function.sql). Purges the physical
// storage blobs for businesses soft-deleted >30 days ago (via the Storage
// API, which deletes the S3 object AND the storage.objects metadata row
// together), then calls the DB function that purges the remaining rows +
// auth.users. Storage must be handled here, not in SQL: deleting
// storage.objects directly only removes metadata and orphans the blob.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PURGE_CRON_SECRET")!;

const BUCKETS = ["documents", "videos"] as const;
const RETENTION_DAYS = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const cutoffISO = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: businesses, error: bizErr } = await admin
      .from("businesses")
      .select("id")
      .lt("deleted_at", cutoffISO);
    if (bizErr) throw bizErr;

    let filesRemoved = 0;

    for (const { id } of businesses ?? []) {
      for (const bucket of BUCKETS) {
        const { data: objects, error: listErr } = await admin
          .schema("storage")
          .from("objects")
          .select("name")
          .eq("bucket_id", bucket)
          .like("name", `${id}/%`);
        if (listErr) throw listErr;

        const names = (objects ?? []).map((o) => o.name as string);
        if (names.length === 0) continue;

        const { error: removeErr } = await admin.storage
          .from(bucket)
          .remove(names);
        if (removeErr) throw removeErr;

        filesRemoved += names.length;
      }
    }

    const { error: purgeErr } = await admin.rpc("purge_deleted_businesses");
    if (purgeErr) throw purgeErr;

    return json({ businesses: businesses?.length ?? 0, filesRemoved });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
