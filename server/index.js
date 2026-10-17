import dotenv from 'dotenv';
import { createApp } from './app.js';
import { connectDb } from './db.js';
import { checkAuthConfig } from './auth.js';

dotenv.config();

// Refuse to start in production with a missing/placeholder JWT secret.
checkAuthConfig();

// Last line of defense: payloads are validated and contained at the request
// and socket edges, but nothing should ever take down the single shared
// process (that would drop every connected user at once). Use a supervisor
// in production so real crashes still get restarted.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err?.stack || err);
});

const PORT = process.env.PORT || 5000;

const { server } = createApp();

await connectDb(process.env.MONGO_URI);

server.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});
