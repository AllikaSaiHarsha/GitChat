import mongoose from 'mongoose';

let ready = false;

export function isDbReady() {
  return ready && mongoose.connection.readyState === 1;
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
