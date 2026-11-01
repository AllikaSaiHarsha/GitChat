import mongoose from 'mongoose';

let ready = false;

export function isDbReady() {
  return ready && mongoose.connection.readyState === 1;
}

// Distinguish intentional in-memory mode from a configured database outage.
// Volatile writes are acceptable in the former, but must not masquerade as
// durable success in the latter.
export function isDbConfigured() {
  return Boolean(process.env.MONGO_URI?.trim());
}

export async function connectDb(uri) {
  if (!uri) {
    console.log('[db] MONGO_URI not set - using in-memory storage');
    return false;
  }
  try {
    await mongoose.connect(uri);
    ready = true;
    console.log('[db] MongoDB connected');
    return true;
  } catch (e) {
    console.log('[db] MongoDB failed, using in-memory storage:', e.message);
    return false;
  }
}
