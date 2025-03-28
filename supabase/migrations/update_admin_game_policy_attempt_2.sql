/*
  # Update Admin Game Creation RLS Policy (Attempt 2)

  This migration attempts to fix the RLS policy for inserting rows into the `games` table
  by changing how the admin status is accessed from the JWT. Instead of using
  `raw_user_meta_data`, it uses `user_metadata`.

  ## 1. Summary of Changes

  - **Table**: `games`
    - **INSERT Policy**: "Allow authenticated admins to create games"
      - **Modified Condition**: Changed `auth.jwt() -> 'raw_user_meta_data' ->> 'is_admin'` to `auth.jwt() -> 'user_metadata' ->> 'is_admin'`.
      - **Kept Conditions**:
        - User must be authenticated (`auth.uid() IS NOT NULL`).

  ## 2. Security Considerations

  - Game creation remains restricted to authenticated users marked as admins.
  - The `INSERT` statement in the application code is still responsible for correctly setting the `host_id`.
*/

-- Drop the existing policy
DROP POLICY IF EXISTS "Allow authenticated admins to create games" ON games;

-- Recreate the policy using 'user_metadata'
CREATE POLICY "Allow authenticated admins to create games"
  ON games
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true
  );

-- Update the SELECT policy name for consistency (Optional but good practice)
-- Drop the old SELECT policy if it exists with the potentially different name
DROP POLICY IF EXISTS "Allow public read access to games" ON games;
DROP POLICY IF EXISTS "Allow authenticated users to read games" ON games;


-- Recreate the SELECT policy with a clear name
CREATE POLICY "Allow authenticated users to read games"
  ON games
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);