/*
      # Update Player SELECT Policy for Nickname Check

      This migration refines the Row Level Security (RLS) SELECT policy on the `players` table.

      ## 1. Changes

      - **Modified Table:** `players`
      - **Policy Update:** Drops the existing SELECT policy (`"Allow players and host to see players in the same game"`).
      - **Policy Creation:** Creates a new SELECT policy (`"Allow users to check nicknames and players/host to see players"`) with updated logic:
        - Allows any authenticated user to query the `players` table *if* the corresponding game is in the 'lobby' state. This is necessary for the pre-join nickname uniqueness check.
        - Continues to allow players already in the game (matched by `user_id`) to see other players in the same game.
        - Continues to allow the host of the game to see the players.

      ## 2. Security

      - Securely enables the nickname check during the joining process for games in the 'lobby' state without exposing player lists unnecessarily once the game starts.
      - Maintains existing read permissions for joined players and hosts.

    */

    -- Drop the existing SELECT policy first to avoid conflicts
    DROP POLICY IF EXISTS "Allow players and host to see players in the same game" ON public.players;

    -- Create the updated SELECT policy
    CREATE POLICY "Allow users to check nicknames and players/host to see players"
      ON public.players
      FOR SELECT
      USING (
        -- Allow any authenticated user to check players IF the game is in lobby (for nickname check)
        (
          auth.role() = 'authenticated' AND
          EXISTS (
            SELECT 1
            FROM public.games g
            WHERE g.id = players.game_id AND g.status = 'lobby'
          )
        )
        -- OR Allow players already in the game (linked by user_id) to see each other
        OR EXISTS (
          SELECT 1
          FROM public.players p2
          WHERE p2.game_id = players.game_id AND p2.user_id = auth.uid()
        )
        -- OR Allow the host of the game to see the players
        OR EXISTS (
           SELECT 1
           FROM public.games g
           WHERE g.id = players.game_id AND g.host_id = auth.uid()
        )
      );

    -- Add a comment to trigger schema cache refresh
    COMMENT ON POLICY "Allow users to check nicknames and players/host to see players" ON public.players IS 'Updated policy allowing nickname checks in lobby and standard player/host visibility. Cache refresh trigger.';
