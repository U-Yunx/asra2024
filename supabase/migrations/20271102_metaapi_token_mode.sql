-- v2.9 — Admin-configurable MetaApi token mode for the MT4/5 bridge.
--
-- The broker-mt bridge can trade through the user's own MetaApi token or the
-- platform-wide METAAPI_TOKEN secret. This adds a platform setting that decides
-- which one is used for live trading:
--
--   mode 'user'    (default) — each user's own saved token is used first,
--                              falling back to the platform's general token
--                              when the user hasn't added one.
--   mode 'general'            — every connection trades through the platform's
--                              general MetaApi token; per-user tokens are
--                              ignored (their saved values stay encrypted at
--                              rest on broker_connections and are simply not
--                              read while this mode is active).
--
-- The mode string itself is not a secret, so it lives in the public-readable
-- `settings` table (admin-write RLS already enforced by the existing
-- "settings: admin write" policy). The general MetaApi token stays a Supabase
-- Edge Function secret (METAAPI_TOKEN) — it is never stored in the database
-- and never reaches the browser, exactly like per-user tokens.

insert into public.settings (key, value, updated_at)
values ('metaapi_token_mode', '{"mode":"user"}'::jsonb, now())
on conflict (key) do nothing;
