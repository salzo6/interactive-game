/*
  # Initial Game Schema Setup

  This migration sets up the initial tables required for the quiz game.

  ## 1. New Tables

  - `games`: Stores information about each game session.
    - `id` (uuid): Primary key, automatically generated.
    - `game_pin` (text): The 6-character uppercase PIN for joining the game. Unique.
    - `host_id` (uuid): Foreign key referencing `auth.users(id)`. Stores the host user. (Nullable for now, set via WS).
    - `created_at` (timestamptz): Timestamp of when the game was created.
    - `status` (text): Current status of the game (e.g., 'lobby', 'active', 'finished'). Default 'lobby'.
    - `current_question_index` (int): Index of the currently active question. Default -1.
    - `quiz_id` (uuid): Foreign key referencing `quizzes(id)` (To be added later). Nullable for now.

  - `players`: Stores information about players in a specific game.
    - `id` (uuid): Primary key, automatically generated.
    - `game_id` (uuid): Foreign key referencing `games(id)`.
    - `nickname` (text): Player's chosen nickname for the game.
    - `score` (int): Player's current score. Default 0.
    - `joined_at` (timestamptz): Timestamp of when the player joined.

  - `questions`: Stores quiz questions and their answers. (Simplified for now)
     - `id` (uuid): Primary key, automatically generated.
     - `quiz_id` (uuid): Foreign key referencing `quizzes(id)` (To be added later). Nullable for now.
     - `question_text` (text): The text of the question. Not Null.
     - `options` (jsonb): JSON array of possible answer strings. e.g., ["Option A", "Option B"]. Not Null.
     - `correct_option_index` (int): The 0-based index of the correct answer within the `options` array. Not Null.
     - `order` (int): Order of the question within a quiz. Default 0.
     - `created_at` (timestamptz): Timestamp of creation.

  ## 2. Security

  - Enable Row Level Security (RLS) on all new tables.
  - Add basic policies (examples provided, adjust as needed):
    - `games`: Allow anyone to read (for joining), authenticated users to create, host to update.
    - `players`: Allow players in the same game to read, allow anyone to create (join), player to update own score (or maybe only server?).
    - `questions`: Allow authenticated users to read/create/update/delete (adjust based on quiz ownership later).

  ## 3. Indexes

  - Add indexes on `game_pin` for faster lookups.
  - Add indexes on foreign key columns (`game_id`, `host_id`, `quiz_id`).

*/

-- ==== GAMES ====

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_pin text UNIQUE NOT NULL CHECK (char_length(game_pin) = 6 AND game_pin = upper(game_pin)),
  host_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Link to Supabase auth user
  created_at timestamptz DEFAULT now() NOT NULL,
  status text NOT NULL DEFAULT 'lobby', -- e.g., 'lobby', 'active', 'finished'
  current_question_index int NOT NULL DEFAULT -1,
  quiz_id uuid -- Foreign key to quizzes table (to be added later)
  -- CONSTRAINT fk_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE SET NULL
);

-- Index for faster game lookup by PIN
CREATE INDEX IF NOT EXISTS idx_games_game_pin ON games(game_pin);
CREATE INDEX IF NOT EXISTS idx_games_host_id ON games(host_id);
CREATE INDEX IF NOT EXISTS idx_games_quiz_id ON games(quiz_id);


ALTER TABLE games ENABLE ROW LEVEL SECURITY;

-- Policies for games table (adjust as needed)
CREATE POLICY "Allow public read access to games"
  ON games
  FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated users to create games"
  ON games
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL); -- Simple check, host_id might be set later

CREATE POLICY "Allow host to update their game"
  ON games
  FOR UPDATE
  USING (auth.uid() = host_id);


-- ==== PLAYERS ====

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE, -- If game is deleted, remove players
  nickname text NOT NULL CHECK (char_length(nickname) > 0 AND char_length(nickname) <= 20),
  score int NOT NULL DEFAULT 0,
  joined_at timestamptz DEFAULT now() NOT NULL
);

-- Index for faster player lookup by game
CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id);


ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Policies for players table (adjust as needed)
CREATE POLICY "Allow players to see others in the same game"
  ON players
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM players p2
      WHERE p2.game_id = players.game_id
      -- AND p2.user_id = auth.uid() -- If players are linked to auth users
      -- For anonymous players, might need a different approach or allow broader read within a game context
    ) OR EXISTS ( -- Allow host to see players
       SELECT 1
       FROM games g
       WHERE g.id = players.game_id AND g.host_id = auth.uid()
    )
  );

CREATE POLICY "Allow anyone to join a game (create a player)"
  ON players
  FOR INSERT
  WITH CHECK (true); -- Further checks might be needed (e.g., game status is 'lobby')

-- Example: Allow players to update their own score (or maybe only server via service role key?)
-- CREATE POLICY "Allow players to update their own score"
--   ON players
--   FOR UPDATE
--   USING (auth.uid() = user_id); -- Requires linking players to auth.users


-- ==== QUESTIONS ==== (Simplified)

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid, -- Foreign key to quizzes table (to be added later)
  -- CONSTRAINT fk_quiz_questions FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL CHECK (char_length(question_text) > 0),
  options jsonb NOT NULL DEFAULT '[]'::jsonb, -- e.g., ["Option A", "Option B", "Option C", "Option D"]
  correct_option_index int NOT NULL CHECK (correct_option_index >= 0),
  "order" int NOT NULL DEFAULT 0, -- Order within the quiz
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Index for faster question lookup by quiz
CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id);


ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- Policies for questions table (adjust based on ownership/quiz logic)
CREATE POLICY "Allow authenticated users to manage questions"
  ON questions
  FOR ALL -- SELECT, INSERT, UPDATE, DELETE
  TO authenticated
  USING (true) -- Simplistic for now, refine with quiz ownership later
  WITH CHECK (true);
