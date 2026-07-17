// Thin fetch wrapper around the control-plane API.
async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `${method} ${url} → ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => req('GET', '/api/health'),
  projects: () => req('GET', '/api/projects'),
  project: (name) => req('GET', `/api/projects/${encodeURIComponent(name)}`),
  promote: (id, target = 'production') =>
    req('POST', `/api/deployments/${encodeURIComponent(id)}/promote`, { target }),
  rollback: (name, target = 'production') =>
    req('POST', `/api/projects/${encodeURIComponent(name)}/rollback`, { target }),
};
