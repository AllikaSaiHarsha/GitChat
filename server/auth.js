import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';
import { isDbReady } from './db.js';

const JWT_EXPIRES = '7d';
let warnedNoSecret = false;

// Read lazily: auth.js loads before dotenv.config() runs in index.js,
// so reading at import time would never see .env values.
function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s && !warnedNoSecret) {
    warnedNoSecret = true;
    console.warn('[auth] JWT_SECRET not set - using insecure dev default. Set it in .env');
  }
  return s || 'dev-secret-change-me';
}

// In-memory users: username -> { username, passwordHash, createdAt }
// NOTE: wiped on server restart. Move to MongoDB for persistence.
const users = new Map();

export function validateCredentials(username, password) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
    return 'username must be 3-20 chars: letters, numbers, underscore';
  }
  if (!password || password.length < 6) {
    return 'password must be at least 6 chars';
  }
  return null;
}

export function signToken(username) {
  return jwt.sign({ username }, getSecret(), { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret()); // throws on invalid/expired
}

export async function registerUser(username, password) {
  username = (username || '').trim();
  const err = validateCredentials(username, password);
  if (err) throw { status: 400, message: err };
  const passwordHash = await bcrypt.hash(password, 10);
  if (isDbReady()) {
    try {
      await User.create({ username, passwordHash });
    } catch (e) {
      if (e.code === 11000) throw { status: 409, message: 'username taken' };
      throw e;
    }
  } else {
    if (users.has(username)) throw { status: 409, message: 'username taken' };
    users.set(username, { username, passwordHash, createdAt: new Date().toISOString() });
  }
  return { username, token: signToken(username) };
}

export async function loginUser(username, password) {
  username = (username || '').trim();
  let hash = '';
  if (isDbReady()) {
    const u = await User.findOne({ username });
    if (!u) throw { status: 401, message: 'invalid username or password' };
    hash = u.passwordHash;
  } else {
    const u = users.get(username);
    if (!u) throw { status: 401, message: 'invalid username or password' };
    hash = u.passwordHash;
  }
  const ok = await bcrypt.compare(password || '', hash);
  if (!ok) throw { status: 401, message: 'invalid username or password' };
  return { username, token: signToken(username) };
}

// Express middleware: requires `Authorization: Bearer <token>`
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

// Does an account with this exact username exist? (Used when a room admin
// adds members directly.) Falls back to the in-memory list without Mongo.
export async function userExists(username) {
  if (!username) return false;
  if (isDbReady()) {
    try {
      return !!(await User.exists({ username }));
    } catch {
      /* fall through to memory */
    }
  }
  return users.has(username);
}
