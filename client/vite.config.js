import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Pages and Netlify take `_headers` straight from the build
// output, so emit the same policy the preview server uses — with connect-src
// matched to the VITE_SERVER_URL baked into the bundle. (Vercel reads
// vercel.json from the repo instead of the build output: copy this header
// block there with the same API origin when deploying there.)
function staticHostHeaders(headers) {
  return {
    name: 'purlway-static-host-headers',
    apply: 'build',
    generateBundle() {
      const lines = Object.entries(headers)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      this.emitFile({ type: 'asset', fileName: '_headers', source: `/*\n${lines}\n` });
    }
  };
}

// CSP + anti-framing for the SPA's serving layers (dev server and preview).
// The API/WS origin follows the same VITE_SERVER_URL the app itself uses.
// NOTE: a production host must send these headers as well — frame-ancestors
// cannot be set from an index.html meta tag.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl = process.env.VITE_SERVER_URL || env.VITE_SERVER_URL || 'http://localhost:5000';
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

  // Production policy: strict script-src plus the anti-framing set. Served by
  // `vite preview` and emitted into the build as dist/_headers.
  const prodHeaders = {
    ...baseHeaders,
    'Content-Security-Policy': csp("'self'")
  };

  return {
    plugins: [react(), staticHostHeaders(prodHeaders)],
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
      headers: prodHeaders
    },
    build: {
      rollupOptions: {
        output: {
          // Split the biggest vendors so the app shell isn't one giant chunk.
          // Vite 8 (Rolldown) requires the function form; the object form used
          // before the upgrade is rejected ("Expected Function").
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|loose-envify)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils|tslib)[\\/]/.test(id)) {
              return 'motion-vendor';
            }
            if (
              /[\\/]node_modules[\\/](socket\.io-client|engine\.io-client|socket\.io-parser|engine\.io-parser|debug|ms|ws|xmlhttprequest-ssl)[\\/]/.test(id) ||
              id.includes('node_modules/@socket.io/')
            ) {
              return 'socket-vendor';
            }
          }
        }
      }
    }
  };
});
