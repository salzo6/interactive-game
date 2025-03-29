/*
      # Refine Player Insert Policy & Add User ID

      This migration updates the RLS policy for inserting into the `players` table
      and ensures the `user_id` column exists, linking players to authenticated users.
      It also adds a comment to trigger a schema cache refresh.

      ## 1. Changes

      - **Modified Table:** `players`
        - **Column Addition:** Conditionally adds the `user_id` column (UUID, references `auth.users`, nullable) if it doesn't already exist.
        - **Index Addition:** Adds an index on `user_id` if the column is added.
        - **Policy Update:** Drops the old `"Allow anyone to join a game (create a player)"` policy if it exists.
        - **Policy Creation:** Creates the `"Allow authenticated users to join lobby games"` policy. This policy checks:
          - The inserting user matches the `user_id` being inserted.
          - The target game exists and has status 'lobby'.
          - The inserting user is not the host of the game.
        - **Policy Update:** Drops and recreates the SELECT policy `"Allow players and host to see players in the same game"` to ensure it uses `user_id` correctly.
        - **Comment Added:** Adds a comment to `players.user_id` to help refresh the Supabase schema cache.


      ## 2. Security

      - Tightens security for joining games by requiring authentication, checking game status, and preventing hosts from joining their own games as players via this policy.
      - Links player entries to authenticated users via `user_id`.
      - Refines SELECT permissions based on `user_id` and host status.

    */

    -- Add user_id column to players table if it doesn't exist
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'players' AND column_name = 'user_id'
      ) THEN
        ALTER TABLE public.players ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_players_user_id ON public.players(user_id);
        RAISE NOTICE 'Column user_id added to public.players table.';
      ELSE
        RAISE NOTICE 'Column user_id already exists in public.players table.';
      END IF;
    END $$;


    -- Drop the old, overly permissive insert policy if it exists
    DROP POLICY IF EXISTS "Allow anyone to join a game (create a player)" ON public.players;

    -- Create a more specific policy for joining games
    -- Drop existing policy first to ensure it's updated
    DROP POLICY IF EXISTS "Allow authenticated users to join lobby games" ON public.players;
    CREATE POLICY "Allow authenticated users to join lobby games"
      ON public.players
      FOR INSERT
      TO authenticated -- Only applies to logged-in users
      WITH CHECK (
        -- Check 1: The user performing the insert matches the user_id being inserted
        auth.uid() = user_id AND
        -- Check 2: The game exists and is in the 'lobby' state
        EXISTS (
          SELECT 1
          FROM public.games g
          WHERE g.id = players.game_id AND g.status = 'lobby'
        ) AND
        -- Check 3: Ensure the user joining is not the host of the game
        NOT EXISTS (
            SELECT 1
            FROM public.games g
            WHERE g.id = players.game_id AND g.host_id = auth.uid()
        )
      );

    -- Update the SELECT policy to explicitly use user_id
    -- Drop existing select policy first to ensure it's updated
    DROP POLICY IF EXISTS "Allow players to see others in the same game" ON public.players;
    DROP POLICY IF EXISTS "Allow players and host to see players in the same game" ON public.players;

    CREATE POLICY "Allow players and host to see players in the same game"
      ON public.players
      FOR SELECT
      USING (
        -- Allow players in the game (linked by user_id) to see each other
        EXISTS (
          SELECT 1
          FROM public.players p2
          WHERE p2.game_id = players.game_id AND p2.user_id = auth.uid()
        )
        -- Allow the host of the game to see the players
        OR EXISTS (
           SELECT 1
           FROM public.games g
           WHERE g.id = players.game_id AND g.host_id = auth.uid()
        )
      );

    -- Add a comment to the user_id column to trigger schema cache refresh
    COMMENT ON COLUMN public.players.user_id IS 'Link to the authenticated user who joined as this player. Cache refresh trigger.';
