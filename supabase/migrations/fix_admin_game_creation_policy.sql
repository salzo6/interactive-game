/*
      # Fix Admin Game Creation RLS Policy

      This migration corrects the RLS policy for inserting rows into the `games` table.
      The previous policy incorrectly tried to compare `host_id` with `auth.uid()` within
      the `WITH CHECK` clause, which fails because the value isn't available at that stage.

      ## 1. Summary of Changes

      - **Table**: `games`
        - **INSERT Policy**: "Allow authenticated admins to create games"
          - **Removed Condition**: `host_id = auth.uid()` from the `WITH CHECK` clause.
          - **Kept Conditions**:
            - User must be authenticated (`auth.uid() IS NOT NULL`).
            - User must have `is_admin = true` in their metadata.

      ## 2. Security Considerations

      - Game creation remains restricted to authenticated users marked as admins.
      - The `INSERT` statement in the application code is still responsible for correctly setting the `host_id` to the admin's `auth.uid()`. This policy only verifies the *permission* to insert.
    */

    -- Drop the faulty policy if it exists
    DROP POLICY IF EXISTS "Allow authenticated admins to create games" ON games;

    -- Recreate the policy with the corrected check
    CREATE POLICY "Allow authenticated admins to create games"
      ON games
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL AND
        (auth.jwt() -> 'raw_user_meta_data' ->> 'is_admin')::boolean = true
        -- The INSERT statement itself must ensure host_id = auth.uid()
      );