/*
      # Refresh Players Schema Cache

      This migration adds a comment to the `user_id` column in the `players` table.
      Its primary purpose is to trigger a refresh of the Supabase schema cache,
      which might resolve issues where recently added columns (like `user_id`)
      are not recognized by the API layer or RLS policies.

      ## 1. Changes

      - **Modified Table:** `players`
        - Added a comment to the `user_id` column.

      ## 2. Security

      - No direct security changes. This aims to fix potential RLS issues caused by an outdated schema cache.

    */

    COMMENT ON COLUMN public.players.user_id IS 'Link to the authenticated user who joined as this player.';
