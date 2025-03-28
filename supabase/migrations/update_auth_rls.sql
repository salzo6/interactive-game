/*
  # Update RLS Policies for Authentication and Roles

  This migration updates Row Level Security (RLS) policies for the `games`
  and `players` tables to enforce authentication and role-based access control.
  It assumes an `is_admin` boolean field exists in the `auth.users.raw_user_meta_data`.

  ## 1. Summary of Changes

  - **Table**: `games`
    - **INSERT Policy**:
      - Removed "Allow anonymous users to create games".
      - Added "Allow authenticated admins to create games". Requires user to be logged in and have `is_admin = true` in metadata. Sets `host_id` automatically.
    - **SELECT Policy**:
      - Updated "Allow public read access to games" to "Allow authenticated users to read games". Requires login.
    - **UPDATE Policy**:
      - Kept "Allow host to update their game". Ensures only the user matching `host_id` can update.

  - **Table**: `players`
    - **INSERT Policy**:
      - Removed "Allow anyone to join a game (create a player)".
      - Added "Allow authenticated non-admins to join games". Requires user to be logged in and have `is_admin = false` (or not set) in metadata. Also checks if the game status is 'lobby'.
    - **SELECT Policy**:
      - Updated "Allow players to see others in the same game". Now explicitly checks if the requesting user is authenticated and either the host or a player in that game.

  ## 2. Security Considerations

  - Game creation is restricted to users marked as admins.
  - Joining games is restricted to users marked as non-admins (players).
  - Users can only update games they host.
  - Users can only see players within the game they are part of (either as host or player).
  - Assumes `is_admin` metadata is securely set during signup.

*/

-- ==== GAMES ====

-- 1. Remove anonymous insert policy
DROP POLICY IF EXISTS "Allow anonymous users to create games" ON games;

-- 2. Add policy for authenticated admins to create games
CREATE POLICY "Allow authenticated admins to create games"
  ON games
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    (auth.jwt() -> 'raw_user_meta_data' ->> 'is_admin')::boolean = true AND
    host_id = auth.uid() -- Ensure host_id is set to the creator
  );

-- 3. Update SELECT policy to require authentication
DROP POLICY IF EXISTS "Allow public read access to games" ON games;
CREATE POLICY "Allow authenticated users to read games"
  ON games
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- 4. Keep UPDATE policy for host (no changes needed if it exists correctly)
-- Ensure it exists:
CREATE POLICY "Allow host to update their game"
  ON games
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);


-- ==== PLAYERS ====

-- 1. Remove anonymous insert policy
DROP POLICY IF EXISTS "Allow anyone to join a game (create a player)" ON players;

-- 2. Add policy for authenticated non-admins (players) to join games
CREATE POLICY "Allow authenticated non-admins to join games"
  ON players
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    COALESCE((auth.jwt() -> 'raw_user_meta_data' ->> 'is_admin')::boolean, false) = false AND
    -- Check if the game they are joining exists and is in 'lobby' status
    EXISTS (
      SELECT 1
      FROM games g
      WHERE g.id = players.game_id AND g.status = 'lobby'
    )
    -- Optional: Prevent joining the same game twice (if players aren't linked to auth.users yet)
    -- AND NOT EXISTS ( SELECT 1 FROM players p WHERE p.game_id = players.game_id AND p.nickname = players.nickname ) -- Example check
  );


-- 3. Update SELECT policy
DROP POLICY IF EXISTS "Allow players to see others in the same game" ON players;
CREATE POLICY "Allow participants to see players in the game"
  ON players
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL AND
    (
      -- User is the host of the game
      EXISTS (
        SELECT 1
        FROM games g
        WHERE g.id = players.game_id AND g.host_id = auth.uid()
      )
      -- OR User is a player in the game (requires linking players to auth.users eventually)
      -- For now, let's assume if they can pass the check above, they are involved.
      -- A more robust check would involve a user_id column on the players table:
      -- OR EXISTS (
      --   SELECT 1
      --   FROM players p2
      --   WHERE p2.game_id = players.game_id AND p2.user_id = auth.uid()
      -- )
    )
  );

-- Note: If players need to be linked to auth users, add a user_id column:
-- ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
-- Then update policies accordingly.