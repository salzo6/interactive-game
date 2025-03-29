import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, useActionData, useNavigation } from '@remix-run/react';
// import { generate } from 'random-words'; // Remove this import
import { requireAdmin, createServerClient } from '~/lib/session.server';
import { generateGamePin } from '~/lib/utils'; // Import our utility function

export const meta: MetaFunction = () => [{ title: 'Host New Game - Live Quiz' }];

// Function to generate a unique 6-character uppercase game PIN using our utility
async function generateUniqueGamePin(supabase: ReturnType<typeof createServerClient>) {
  let pin: string;
  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loops

  // --- Add check here ---
  if (!supabase || typeof supabase.from !== 'function') {
      console.error('[generateUniqueGamePin] Invalid Supabase client received:', supabase);
      throw new Error('Database client is not available for generating PIN.');
  }
  // --- End check ---


  do {
    // Generate a random 6-character uppercase alphanumeric PIN using our utility
    pin = generateGamePin(6); // Use the utility function
    attempts++;

    // Check if the PIN already exists in the database
    const { data, error } = await supabase
      .from('games')
      .select('game_pin')
      .eq('game_pin', pin)
      .maybeSingle();

    if (error) {
      console.error('Error checking game PIN uniqueness:', error);
      throw new Error('Database error while generating game PIN.'); // Throw error on DB issue
    }

    if (!data) {
      return pin; // PIN is unique
    }

  } while (attempts < maxAttempts);

  // If we reach here, we failed to generate a unique PIN after several attempts
  console.error('Failed to generate a unique game PIN after multiple attempts.');
  throw new Error('Could not generate a unique game PIN. Please try again.');
}


export async function action({ request }: ActionFunctionArgs) {
  const adminUser = await requireAdmin(request); // Ensure user is logged in and is an admin
  console.log(`\n--- [host._index.tsx action] --- Admin ${adminUser.email} attempting to create game.`);

  // --- Add logging here ---
  let supabase;
  try {
    supabase = await createServerClient(request);
    console.log('[host._index.tsx action] Result of createServerClient:', supabase);
    // Explicitly check if 'from' method exists
    if (!supabase || typeof supabase.from !== 'function') {
        console.error('[host._index.tsx action] Error: createServerClient did not return a valid Supabase client.');
        console.error('[host._index.tsx action] Received:', supabase);
        return json({ error: 'Failed to initialize database connection.' }, { status: 500 });
    }
    console.log('[host._index.tsx action] Supabase client appears valid, proceeding...');
  } catch (clientError: any) {
      console.error('[host._index.tsx action] Error calling createServerClient:', clientError);
      return json({ error: `Failed to initialize database client: ${clientError.message}` }, { status: 500 });
  }
  // --- End logging ---


  try {
    const gamePin = await generateUniqueGamePin(supabase); // Pass the validated client
    console.log(`[host._index.tsx action] Generated unique PIN: ${gamePin}`);

    // Insert the new game, associating it with the host
    const { data: newGame, error: insertError } = await supabase
      .from('games')
      .insert({
        game_pin: gamePin,
        host_id: adminUser.id, // Set the host_id during creation
        status: 'lobby', // Initial status
      })
      .select('id, game_pin') // Select the ID and PIN of the new game
      .single();

    if (insertError) {
      console.error('[host._index.tsx action] Error inserting new game:', insertError);
       // Check for RLS violation specifically
       if (insertError.code === '42501') {
           console.error("[host._index.tsx action] RLS policy violation confirmed for game creation.");
           return json({ error: 'Failed to create game due to permission restrictions. Ensure admins have insert rights. (RLS)' }, { status: 403 });
       }
      return json({ error: `Database error creating game: ${insertError.message}` }, { status: 500 });
    }

    if (!newGame) {
        console.error('[host._index.tsx action] Game insert succeeded but no data returned.');
        return json({ error: 'Failed to create game. Could not retrieve game details after creation.' }, { status: 500 });
    }

    console.log(`[host._index.tsx action] Game created successfully. ID: ${newGame.id}, PIN: ${newGame.game_pin}`);
    // Redirect the host to their new game's hosting page using the PIN
    return redirect(`/host/${newGame.game_pin}`);

  } catch (error: any) {
    console.error('[host._index.tsx action] Error during game creation process:', error);
    // Check if the error originated from generateUniqueGamePin's client check
    if (error.message === 'Database client is not available for generating PIN.') {
        return json({ error: 'Failed to initialize database connection before generating PIN.' }, { status: 500 });
    }
    return json({ error: error.message || 'Failed to create game due to an unexpected error.' }, { status: 500 });
  }
}


export default function HostIndexPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isCreating = navigation.state === 'submitting';

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Host a New Game</h1>
      <p className="text-gray-600 dark:text-gray-400">Click the button below to create a new game lobby.</p>

      <Form method="post">
        <button
          type="submit"
          disabled={isCreating}
          className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-md shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 dark:focus:ring-offset-gray-800"
        >
          {isCreating ? 'Creating Game...' : 'Create New Game'}
        </button>
      </Form>

      {actionData?.error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Error: {actionData.error}
        </p>
      )}
    </div>
  );
}
