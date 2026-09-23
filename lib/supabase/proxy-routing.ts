export function shouldBypassSupabaseSessionRefresh(pathname: string) {
  return pathname === "/auth/callback";
}
