/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional: absent when no .env is present — App.tsx falls back at runtime.
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
