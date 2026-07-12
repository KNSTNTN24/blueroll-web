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

type StorageAdmin = ReturnType<typeof createClient>["storage"];

// This project's PostgREST config does not expose the `storage` schema
// (db_schema = "public,graphql_public"), so `admin.schema('storage')` 404s.
// Walk the Storage API's own list() endpoint instead — it's authoritative
// for what remove() can delete and works regardless of PostgREST exposure.
// list() only returns the immediate children of a path (subfolders come
// back as entries with id === null), so recurse into those to also catch
// nested objects like "<business_id>/checklist-photos/x.jpg".
async function listAllUnderPrefix(
  storage: StorageAdmin,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await storage.from(bucket).list(prefix, {
    limit: 1000,
  });
  if (error) throw error;

  const names: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      names.push(...(await listAllUnderPrefix(storage, bucket, path)));
    } else {
      names.push(path);
    }
  }
  return names;
}

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
        const names = await listAllUnderPrefix(admin.storage, bucket, id);
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
