// Helpers comunes de la UI (vanilla, sin framework).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || "idem-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export function nuevoCorrelationId() {
  return "corr-" + ((crypto.randomUUID && crypto.randomUUID()) || Date.now() + "-" + Math.random().toString(16).slice(2));
}

export async function api(path, { method = "GET", body, token, idemKey, correlationId } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (idemKey) headers["x-idempotency-key"] = idemKey;
  if (correlationId) headers["x-correlation-id"] = correlationId;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data, correlationId: res.headers.get("x-correlation-id") };
}

export function badgeEstado(estado) {
  const e = (estado || "").toLowerCase();
  let cls = "b-info";
  if (e === "facturada" || e === "cobrada" || e === "entregada") cls = "b-ok";
  else if (e === "anulada") cls = "b-err";
  else if (e.includes("pendiente")) cls = "b-warn";
  return `<span class="badge ${cls}">${estado || "-"}</span>`;
}

// Resalta la barra de navegacion segun la pagina actual.
export function marcarNav() {
  const aqui = location.pathname.split("/").pop() || "counter.html";
  $$("nav a").forEach((a) => {
    if (a.getAttribute("href") === aqui) a.classList.add("activo");
  });
}
