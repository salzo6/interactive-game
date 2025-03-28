/*
  # Update RLS Policy for Game Creation

  This migration updates the Row Level Security policy for the `games` table
  to allow anonymous users (public/anon role) to insert new game records.
  This is necessary because users create games from the index page before
  potentially authenticating as a host.

  ## 1. Changes

  - **Modified Table**: `games`
    - **Policy Change**: Updated the INSERT policy.
      - Dropped the old policy "Allow authenticated users to create games".
      - Created a new policy "Allow anonymous users to create games".
      - Changed target role from `authenticated` to `anon`.
      - Simplified `WITH CHECK` clause to `true`.

*/

-- Drop the existing policy first (use IF EXISTS to avoid errors if it was already removed)
DROP POLICY IF EXISTS "Allow authenticated users to create games" ON games;

-- Create the new policy allowing anonymous inserts
CREATE POLICY "Allow anonymous users to create games"
  ON games
  FOR INSERT
  TO anon -- Allow anonymous users (using the anon key)
  WITH CHECK (true); -- Allow any insert that satisfies table constraints
