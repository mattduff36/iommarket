export function createClient(): never {
  throw new Error(
    "@supabase/supabase-js createClient was called without a test mock",
  );
}
