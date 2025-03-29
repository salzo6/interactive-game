/*
      # Fix Player SELECT RLS Recursion

      This migration addresses the "infinite recursion detected" (42P17) error
      occurring during SELECT operations on the `players` table, specifically
      during the nickname uniqueness check.

      ## 1. Changes

      - **New Function:** `is_player_in_game(game_uuid uuid, user_uuid uuid)`
        - Creates a boolean SQL function.
        - Marked as `SECURITY DEFINER` to run with the definer's privileges, bypassing the calling user's RLS policies *within the function's execution*. This prevents recursion when the policy needs to check if the current user is already a player.
        - Safely checks if a given `user_uuid` exists in the `players` table for a specific `game_uuid`.
      - **Modified Table:** `players`
        - **Policy Update:** Drops the existing SELECT policy (`"Allow users to check nicknames and players/host to see players"`).
        - **Policy Creation:** Recreates the SELECT policy (`"Allow users to check nicknames and players/host to see players"`) using the new `is_player_in_game` function to determine if the current user is already a player in the game, thus avoiding the recursive check.

      ## 2. Security

      - Resolves the RLS recursion vulnerability.
      - Uses `SECURITY DEFINER` safely within a narrowly scoped function with a specific purpose.
      - Maintains the intended SELECT permissions:
        - Authenticated users can check players if the game is in 'lobby'.
        - Players already in the game can see other players.
        - The host can see players.

    */

    -- Step 1: Create the SECURITY DEFINER function to safely check player existence
    CREATE OR REPLACE FUNCTION public.is_player_in_game(game_uuid uuid, user_uuid uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE -- Function doesn't modify the database, helps optimizer
    SECURITY DEFINER
    -- Set a search path to prevent potential hijacking in more complex functions
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM public.players p
        WHERE p.game_id = game_uuid AND p.user_id = user_uuid
      );
    $$;

    -- Grant execute permission on the function to authenticated users
    GRANT EXECUTE ON FUNCTION public.is_player_in_game(uuid, uuid) TO authenticated;

    -- Step 2: Drop the old policy that caused recursion
    DROP POLICY IF EXISTS "Allow users to check nicknames and players/host to see players" ON public.players;

    -- Step 3: Recreate the SELECT policy using the helper function
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
        -- OR Allow players already in the game (checked via SECURITY DEFINER function)
        OR public.is_player_in_game(players.game_id, auth.uid()) -- Use the function here
        -- OR Allow the host of the game to see the players
        OR EXISTS (
           SELECT 1
           FROM public.games g
           WHERE g.id = players.game_id AND g.host_id = auth.uid()
        )
      );

    -- Add comments to trigger schema cache refresh
    COMMENT ON FUNCTION public.is_player_in_game(uuid, uuid) IS 'Checks if a user is a player in a specific game. SECURITY DEFINER to prevent RLS recursion. Cache refresh trigger.';
    COMMENT ON POLICY "Allow users to check nicknames and players/host to see players" ON public.players IS 'Updated policy using is_player_in_game function to prevent recursion. Cache refresh trigger.';
