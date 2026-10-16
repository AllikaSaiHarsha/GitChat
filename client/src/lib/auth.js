const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';
const KEY = 'chat_token';

export const getToken = () => localStorage.getItem(KEY) || '';
export const setToken = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

async function post(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

export async function register(username, password) {
  const data = await post('/api/auth/register', { username, password });
  setToken(data.token);
  return data;
}

export async function login(username, password) {
  const data = await post('/api/auth/login', { username, password });
  setToken(data.token);
  return data;
}

export async function fetchMe(token) {
  const res = await fetch(`${SERVER_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    // 401 means the token really is invalid; anything else (5xx, proxy errors)
    // is transient and shouldn't sign the user out.
    const err = new Error(res.status === 401 ? 'invalid session' : `session check failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchHistory(room, token) {
  const res = await fetch(`${SERVER_URL}/api/messages/${encodeURIComponent(room)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error('history failed');
  return res.json();
}

export async function fetchActivity(room, token) {
  const res = await fetch(`${SERVER_URL}/api/stats/activity?room=${encodeURIComponent(room)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('activity failed');
  return res.json();
}

async function authedPost(path, body, token) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

// Rooms the user is a member of (server truth; #general is always included).
export async function fetchRooms(token) {
  const res = await fetch(`${SERVER_URL}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('rooms failed');
  const data = await res.json();
  return data.rooms || [];
}

// Create a room with its (required) join password.
export async function createRoom(name, password, token) {
  return authedPost('/api/rooms/create', { name, password }, token);
}

// Join with the room password — only needed the first time.
export async function joinRoom(name, password, token) {
  return authedPost('/api/rooms/join', { name, password }, token);
}

// Member roster + who created the room (the creator is its admin).
export async function fetchMembers(room, token) {
  const res = await fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(room)}/members`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'members failed');
  return data;
}

// Admin only: add a member by username.
export async function addMember(room, username, token) {
  return authedPost(`/api/rooms/${encodeURIComponent(room)}/members`, { username }, token);
}

// Admin only: remove a member.
export async function removeMember(room, username, token) {
  const res = await fetch(
    `${SERVER_URL}/api/rooms/${encodeURIComponent(room)}/members/${encodeURIComponent(username)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'remove failed');
  return data;
}

// Leave a room on your own — membership is dropped, so the room's password
// is needed again to rejoin.
export async function leaveRoom(room, token) {
  return authedPost(`/api/rooms/${encodeURIComponent(room)}/leave`, {}, token);
}
