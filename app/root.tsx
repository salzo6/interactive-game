import {
  Form,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import "./tailwind.css";
import { getUser } from "./lib/session.server"; // Import getUser

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

// Loader to get user data for the root layout
export async function loader({ request }: LoaderFunctionArgs) {
  console.log("--- [root.tsx loader] --- Start");
  let user = null; // Initialize user
  try {
    console.log("[root.tsx loader] Attempting to fetch user...");
    user = await getUser(request);
    console.log("[root.tsx loader] User fetched:", user ? { id: user.id, email: user.email, metadata: user.user_metadata } : 'null');

    // --- NEW: Check if process.env exists ---
    console.log("[root.tsx loader] Checking if process.env exists...");
    if (typeof process === 'undefined' || typeof process.env === 'undefined') {
        console.error("[root.tsx loader] CRITICAL ERROR: process or process.env is undefined!");
        throw new Error("Server environment configuration error: process.env is undefined.");
    }
    console.log("[root.tsx loader] process.env seems to exist. Type:", typeof process.env);
    // --- End Check ---

    console.log("[root.tsx loader] Accessing environment variables..."); // Renamed log slightly
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    console.log("[root.tsx loader] Accessed env vars (values hidden for security)."); // Log after access attempt

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[root.tsx loader] ERROR: Supabase env vars missing server-side!");
      // Log which specific var is missing if possible
      if (!supabaseUrl) console.error("[root.tsx loader] VITE_SUPABASE_URL is missing or empty.");
      if (!supabaseAnonKey) console.error("[root.tsx loader] VITE_SUPABASE_ANON_KEY is missing or empty.");
      throw new Error("Server configuration error: Supabase environment variables are missing.");
    }
     console.log("[root.tsx loader] Supabase env vars validated."); // Renamed log

    const responseData = {
      user,
      ENV: {
        VITE_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
      },
    };

    console.log("[root.tsx loader] Preparing JSON response data:", {
        userId: responseData.user?.id,
        userEmail: responseData.user?.email,
        envKeys: Object.keys(responseData.ENV)
    });

    try {
        const jsonResponse = json(responseData);
        console.log("--- [root.tsx loader] --- End Success (JSON serialization successful)");
        return jsonResponse;
    } catch (serializationError) {
        console.error("--- [root.tsx loader] --- ERROR during JSON serialization:", serializationError);
        console.error("[root.tsx loader] Data structure causing serialization error:", JSON.stringify(responseData, null, 2));
        return json({ error: "Failed to serialize root data." }, { status: 500 });
    }

  } catch (error) {
    console.error("--- [root.tsx loader] --- ERROR (Outer Catch):", error);
     return json({ error: `Failed to load root data: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}

// Combine Layout logic directly into the default export App component
export default function App() {
  const loaderData = useLoaderData<typeof loader>();

   // Handle potential error state from the loader
  if (loaderData && 'error' in loaderData) {
    return (
      <html lang="en" className="h-full">
        <head>
          <title>Error</title>
          <Meta />
          <Links />
        </head>
        <body className="h-full flex items-center justify-center bg-red-100">
          <div className="text-center p-8 bg-white shadow-md rounded">
            <h1 className="text-2xl font-bold text-red-700">Application Error</h1>
            <p className="text-red-600 mt-2">{loaderData.error}</p>
            <p className="mt-4 text-sm text-gray-600">Please check the server logs for more details.</p>
          </div>
          <Scripts />
        </body>
      </html>
    );
  }

  // Handle case where loaderData might be unexpectedly null/undefined
   if (!loaderData) {
     return (
       <html lang="en" className="h-full">
         <head>
           <title>Loading Error</title>
           <Meta />
           <Links />
         </head>
         <body className="h-full flex items-center justify-center bg-yellow-100">
           <div className="text-center p-8 bg-white shadow-md rounded">
             <h1 className="text-2xl font-bold text-yellow-700">Loading Error</h1>
             <p className="text-yellow-600 mt-2">Failed to load application data. Please try refreshing.</p>
           </div>
           <Scripts />
         </body>
       </html>
     );
   }


  // Destructure safely now that we know 'error' isn't present and loaderData exists
  const { user, ENV } = loaderData;


  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="h-full bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
        <header className="bg-white dark:bg-gray-800 shadow-sm">
          <nav className="container mx-auto px-4 py-3 flex justify-between items-center">
            <a href="/" className="text-xl font-bold text-blue-600 dark:text-blue-400">
              Live Quiz
            </a>
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  <span className="text-sm">Welcome, {user.email} {user.user_metadata?.is_admin ? '(Admin)' : ''}</span>
                  <Form action="/logout" method="post">
                    <button
                      type="submit"
                      className="rounded bg-red-500 px-3 py-1 text-sm font-medium text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
                    >
                      Logout
                    </button>
                  </Form>
                </>
              ) : (
                <>
                  <a href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">Login</a>
                  <a href="/signup" className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-500">Sign Up</a>
                </>
              )}
            </div>
          </nav>
        </header>

        <main className="container mx-auto p-4">
           <Outlet /> {/* Render the matched child route component here */}
        </main>

        {/* Pass env vars to the client */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(ENV)}`,
          }}
        />

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
