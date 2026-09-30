import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

import tailwind from "@tailwindcss/vite";

const URL_API_DOME_LAUNCHER_PADRAO = "https://api.domestudios.com.br";
const DISCORD_CLIENT_ID_PADRAO = "1380421346605138041";
const DISCORD_REDIRECT_URI_PADRAO = "https://domestudios.com.br/domelauncher";
const DISCORD_SCOPES_PADRAO = "identify";

function valorNaoVazio(...candidatos: Array<string | undefined>): string | null {
  for (const candidato of candidatos) {
    if (typeof candidato !== "string") continue;
    const valor = candidato.trim();
    if (valor.length > 0) return valor;
  }
  return null;
}

function removerBarraFinal(url: string): string {
  return url.replace(/\/+$/, "");
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const urlApi = valorNaoVazio(
    env.DOME_API_PUBLIC_URL,
    env.DOME_API_URL,
    env.VITE_DOME_API_PUBLIC_URL,
    env.VITE_DOME_API_URL,
    env.VITE_API_PUBLIC_URL
  );

  const clientId = valorNaoVazio(
    env.DOME_CLIENT_ID,
    env.DOME_APP_ID,
    env.DOME_DISCORD_CLIENT_ID,
    env.VITE_DOME_CLIENT_ID,
    env.VITE_DOME_APP_ID,
    env.VITE_DOME_DISCORD_CLIENT_ID
  );

  const redirectUri = valorNaoVazio(
    env.DOME_REDIRECT_URI,
    env.DOME_DISCORD_REDIRECT_URI,
    env.VITE_DOME_REDIRECT_URI,
    env.VITE_DOME_DISCORD_REDIRECT_URI
  );

  const scopes = valorNaoVazio(
    env.DOME_DISCORD_SCOPES,
    env.VITE_DOME_DISCORD_SCOPES
  );

  const configuracaoSocialPublica = {
    apiBaseUrl: removerBarraFinal(urlApi ?? URL_API_DOME_LAUNCHER_PADRAO),
    discordClientId: clientId ?? DISCORD_CLIENT_ID_PADRAO,
    discordRedirectUri: redirectUri ?? DISCORD_REDIRECT_URI_PADRAO,
    discordScopes: scopes ?? DISCORD_SCOPES_PADRAO,
  };

  return {
    plugins: [react(), tailwind()],
    define: {
      __DOME_CONFIGURACAO_SOCIAL__: JSON.stringify(configuracaoSocialPublica),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      warmup: {
        clientFiles: [
          "./src/main.tsx",
          "./src/App.tsx",
          "./src/iconesPixelados.tsx",
          "./src/components/HomePage.tsx",
          "./src/components/LibraryPage.tsx",
        ],
      },
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
