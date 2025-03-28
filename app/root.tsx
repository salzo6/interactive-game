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
  const user = await getUser(request);
  // Pass Supabase env vars needed for client-side Supabase initialization
  return json({
    user,
    ENV: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    },
  });
}


export function Layout({ children }: { children: React.ReactNode }) {
  const { user, ENV } = useLoaderData<typeof loader>();

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
           {children}
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

export default function App() {
  return <Outlet />;
}

// Add a client-side listener for Supabase auth changes
// This keeps the client session in sync if it changes in another tab, etc.
// Needs to be placed in a component rendered on the client, like entry.client.tsx or here if careful
// For simplicity, let's add it to entry.client.tsx later if needed.
