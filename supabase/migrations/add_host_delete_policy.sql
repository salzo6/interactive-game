/*
  # Allow Host to Delete Game

  This migration adds a Row Level Security (RLS) policy to allow the
  authenticated user who is the host of a game to delete that game record.

  ## 1. Summary of Changes

  - **Table**: `games`
    - **New Policy**: "Allow host to delete their own game"
      - **Operation**: `DELETE`
      - **Applies To**: `authenticated` users
      - **Condition**: The authenticated user's ID (`auth.uid()`) must match the `host_id` column of the game row being deleted.

  ## 2. Security Considerations

  - This policy ensures that only the user designated as the host can delete the game.
  - Deletion is a destructive operation. The application logic (WebSocket handler) triggers this based on the host disconnecting.
*/

-- Drop policy if it exists to ensure idempotency
DROP POLICY IF EXISTS "Allow host to delete their own game" ON games;

-- Create the policy
CREATE POLICY "Allow host to delete their own game"
  ON games
  FOR DELETE
  TO authenticated
  USING (auth.uid() = host_id);
