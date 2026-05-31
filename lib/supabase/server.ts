import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from Server Component; ignore if middleware handles refresh
          }
        },
      },
    },
  );
}

// Admin client for privileged ops (RLS bypass — use sparingly)
import { createClient as createAdminBase } from '@supabase/supabase-js';
export function createAdminClient() {
  return createAdminBase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false },
      // Next.js caches global fetch in Server Components, which made Supabase
      // reads serve stale results (e.g. home-page counts frozen at 0 from the
      // first render before any data existed). Force every admin query fresh.
      global: { fetch: (url: any, opts: any) => fetch(url, { ...opts, cache: 'no-store' }) },
    },
  );
}
