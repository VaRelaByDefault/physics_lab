const BASE = "";

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, opts);
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  catalog:       ()         => request("GET",    "/api/catalog"),
  listProjects:  ()         => request("GET",    "/api/projects"),
  getProject:    (id)       => request("GET",    `/api/projects/${id}`),
  createProject: (payload)  => request("POST",   "/api/projects", payload),
  saveProject:   (id, data) => request("PUT",    `/api/projects/${id}`, data),
  deleteProject: (id)       => request("DELETE", `/api/projects/${id}`),
  simulate:      (project)  => request("POST",   "/api/simulate", project),
};