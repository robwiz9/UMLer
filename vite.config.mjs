import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * GitHub's OAuth endpoints do not send browser CORS headers. The device flow
 * needs no client secret, so a tiny same-origin relay is enough for the local
 * dev and preview servers. The same `/api/github/oauth/*` routes are implemented
 * as Vercel Functions for production; the REST API is called directly from the
 * browser.
 */
const githubOAuthPlugin = (clientId) => {
  const readBody = (request) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > 32 * 1024) {
          reject(new Error("Request body too large."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", reject);
    });

  const sendJson = (response, status, payload) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(payload));
  };

  const install = (middlewares) => {
    middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith("/api/github/oauth/")) {
        next();
        return;
      }

      if (pathname === "/api/github/oauth/config") {
        sendJson(response, 200, {
          clientId,
          proxy: true,
        });
        return;
      }

      const upstream =
        pathname === "/api/github/oauth/device-code"
          ? "https://github.com/login/device/code"
          : pathname === "/api/github/oauth/access-token"
            ? "https://github.com/login/oauth/access_token"
            : null;

      if (upstream === null || request.method !== "POST") {
        sendJson(response, 404, {
          error: "not_found",
          error_description: "Unknown GitHub OAuth endpoint.",
        });
        return;
      }

      void (async () => {
        try {
          const body = await readBody(request);
          const result = await fetch(upstream, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type":
                request.headers["content-type"] ??
                "application/x-www-form-urlencoded",
              "User-Agent": "UMLer",
            },
            body,
          });
          const text = await result.text();
          response.statusCode = result.status;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(text);
        } catch (error) {
          sendJson(response, 502, {
            error: "oauth_proxy_error",
            error_description:
              error instanceof Error
                ? error.message
                : "The GitHub OAuth request failed.",
          });
        }
      })();
    });
  };

  return {
    name: "umler-github-oauth",
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const clientId =
    env.GITHUB_OAUTH_CLIENT_ID ||
    env.VITE_GITHUB_CLIENT_ID ||
    process.env.GITHUB_OAUTH_CLIENT_ID ||
    "";

  return {
    plugins: [react(), githubOAuthPlugin(clientId)],
    server: {
      port: 5173,
      strictPort: false,
    },
  };
});
