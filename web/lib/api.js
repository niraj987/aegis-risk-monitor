async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg ?? String(item)).join(", ")
      : detail || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

export const api = {
  overview: () => request("/api/overview?history=60", { cache: "no-store" }),
  run: () => request("/api/run", { method: "POST", body: "{}" }),
  stress: (shockPct) => request(`/api/stress?shock=${encodeURIComponent(shockPct)}`, { cache: "no-store" }),
  updatePortfolio: (holdings) =>
    request("/api/portfolio", { method: "PUT", body: JSON.stringify({ holdings }) }),
  updateLimits: (limits) =>
    request("/api/limits", { method: "PUT", body: JSON.stringify(limits) }),
  reviewAlert: (id, status) =>
    request(`/api/alerts/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status, reviewer: "Portfolio Manager" }),
    }),
};
