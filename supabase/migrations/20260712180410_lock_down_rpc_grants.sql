-- Lock down EXECUTE grants on two SECURITY DEFINER functions that were
-- reachable by anon/authenticated but should not be:
--
-- 1. consume_trial(text, uuid) is only ever called nested, from inside
--    setup_business (also SECURITY DEFINER, owned by postgres) — it runs as
--    the owner and does not need a direct grant. Exposed to authenticated/anon
--    it is an abuse vector: anyone could burn or revoke another business's
--    free trial by calling it with an arbitrary email/business_id pair.
--
-- 2. purge_deleted_businesses() is a destructive hard-delete, only meant to
--    be invoked from the cron/edge path as service_role. Exposed to anon/
--    authenticated, any caller could trigger a permanent data purge.
--
-- Both functions are owned by postgres, so revoking public/anon/authenticated
-- execute does not affect: (a) setup_business calling consume_trial internally
-- (the owner always retains implicit EXECUTE on functions it owns), and
-- (b) the service_role/cron/edge path calling purge_deleted_businesses
-- (service_role keeps its explicit grant, untouched by this revoke).

revoke execute on function public.consume_trial(text, uuid) from public, anon, authenticated;

revoke execute on function public.purge_deleted_businesses() from public, anon, authenticated;
