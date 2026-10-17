import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// CSP + anti-framing for the SPA's serving layers (dev server and preview).
// The API/WS origin follows the same VITE_SERVER_URL the app itself uses.
// NOTE: a production host must send these headers as well — frame-ancestors
// cannot be set from an index.html meta tag.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = env.VITE_SERVER_URL || 'http://localhost:5000';
  const wsUrl = serverUrl.replace(/^http/, 'ws');

  const csp = (scriptSrc) =>
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: http: https:", // remote message images; policy decision tracked in the audit (P3)
      "font-src 'self' data:",
      `connect-src 'self' ${serverUrl} ${wsUrl}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ');

  const baseHeaders = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      headers: {
        ...baseHeaders,
        // Dev injects an inline react-refresh preamble script, so dev keeps
        // 'unsafe-inline' for scripts; preview enforces the strict policy.
        'Content-Security-Policy': csp("'self' 'unsafe-inline'")
      }
    },
    preview: {
      headers: {
        ...baseHeaders,
        'Content-Security-Policy': csp("'self'")
      }
    },
    build: {
      rollupOptions: {
        output: {
          // Split the biggest vendors so the app shell isn't one giant chunk.
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'motion-vendor': ['framer-motion'],
            'socket-vendor': ['socket.io-client']
          }
        }
      }
    }
  };
});
