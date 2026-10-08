const TOKEN_KEY = 'notely:token';
const USER_KEY = 'notely:user';

// Get token from localStorage (Supabase token or custom JWT)
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Get user from localStorage
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

// Set session - stores token and user in localStorage
// Token can be Supabase JWT or custom JWT
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Clear session - removes from localStorage
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// API client
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) {
      clearSession();
      // Note: navigation handled by component, not here
    }
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}