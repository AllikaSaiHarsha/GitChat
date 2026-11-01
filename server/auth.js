import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';
import { isDbReady } from './db.js';

const JWT_EXPIRES = '7d';
const DEV_SECRET = 'dev-secret-change-me';
// Public placeholder from .env.example — using it verbatim is not a secret.
const PLACEHOLDER_SECRET = 'change-this-to-a-long-random-string';
// Fixed hash compared against when a password check cannot run for real
// (unknown account, missing room) so those paths cost the same as a real
// bcrypt compare and response timing does not leak existence.
const DUMMY_HASH = '$2a$10$rH2UozY7DGpzT8cFFjR3ROQuQ2mlLyWYWhfbR7.pq/RUO.oGYZaVC';
let warnedNoSecret = false;

// Read lazily: auth.js loads before dotenv.config() runs in index.js,
// so reading at import time would never see .env values.
function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s === PLACEHOLDER_SECRET) {
    // Fail closed in production: a known fallback secret would let anyone
    // forge a token for any account.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set to a strong random value in production');
    }
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn('[auth] JWT_SECRET not set - using insecure dev default. Set it in .env');
    }
    return DEV_SECRET;
  }
  return s;
}

// Startup guard for index.js: production must not boot without a real secret.
export function checkAuthConfig() {
  getSecret(); // throws in production when unset/placeholder; warns in dev
}

// Uniform-cost password check for paths where no real hash exists (unknown
// account, missing room). rooms.js reuses this for joins of missing rooms.
// Errors (e.g. non-string input) are swallowed: the caller still responds 401/404.
export async function dummyCompare(password) {
  await bcrypt.compare(typeof password === 'string' ? password : '', DUMMY_HASH).catch(() => {});
}

// In-memory users: username -> { username, passwordHash, createdAt }
// NOTE: wiped on server restart. Move to MongoDB for persistence.
const users = new Map();

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return 'username must be 3-20 chars: letters, numbers, underscore';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'password must be at least 6 chars';
  }
  // bcrypt only uses the first 72 bytes: cap explicitly so long passwords are
  // rejected instead of silently truncated.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'password must be at most 72 bytes';
  }
  return null;
}

export function signToken(username) {
  return jwt.sign({ username }, getSecret(), { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret(), { algorithms: ['HS256'] }); // throws on invalid/expired
}

export async function registerUser(username, password) {
  username = typeof username === 'string' ? username.trim() : username;
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
  username = typeof username === 'string' ? username.trim() : '';
  if (typeof password !== 'string') {
    await dummyCompare('');
    throw { status: 401, message: 'invalid username or password' };
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    await dummyCompare(password);
    throw { status: 401, message: 'invalid username or password' };
  }
  let hash = '';
  if (isDbReady()) {
    const u = await User.findOne({ username });
    if (!u) {
      // Same cost as the compare below: no account-existence timing oracle.
      await dummyCompare(password);
      throw { status: 401, message: 'invalid username or password' };
    }
    hash = u.passwordHash;
  } else {
    const u = users.get(username);
    if (!u) {
      // Same cost as the compare below: no account-existence timing oracle.
      await dummyCompare(password);
      throw { status: 401, message: 'invalid username or password' };
    }
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
