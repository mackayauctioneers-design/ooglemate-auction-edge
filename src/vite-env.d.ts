/// <reference types="vite/client" />

// Build-time constants injected by Vite
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_CARBITRAGE_API_BASE?: string;
  readonly VITE_CARBITRAGE_AUTH_SUPABASE_URL?: string;
  readonly VITE_CARBITRAGE_AUTH_SUPABASE_KEY?: string;
}
