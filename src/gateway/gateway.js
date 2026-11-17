// API Gateway (documento 6.2 y 7.4): punto de entrada unico. Genera el correlationId,
// valida el token, autoriza por perfil y sede, limita el uso, audita, y enruta al
// orquestador y a los servicios. Tambien sirve la UI estatica.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { PORTS, SECURITY, flags, SIM, SPEED, baseUrl } from "../config.js";
import { emitirToken, verificarToken, autorizar } from "../shared/auth.js";
import { nuevoCorrelationId, nuevaClaveIdempotencia } from "../shared/ids.js";
import { log, reconstruir, ultimosLogs, bus } from "../shared/logger.js";
import { ErrorSOA } from "../shared/errors.js";
import * as metrics from "../shared/metrics.js";
import { estadoCircuitos, reiniciarCircuitos } from "../shared/httpClient.js";
import { estadoColas, verDLQ } from "../shared/broker.js";
import { llamar } from "../shared/httpClient.js";
import { registrarEncomienda } from "../orchestrator/registrar.js";
import { db, reiniciarDatos } from "../data/db.js";
import { USUARIOS, AGENCIAS, TARIFAS } from "../data/seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, "..", "ui");

// Limite de uso por consumidor (documento 10.7).
const ventanas = new Map();
function rateLimit(clave, { windowMs, max }) {
  const ahora = Date.now();
  const w = ventanas.get(clave) || { inicio: ahora, n: 0 };
  if (ahora - w.inicio > windowMs) {
    w.inicio = ahora;
    w.n = 0;
  }
  w.n++;
  ventanas.set(clave, w);
  return w.n <= max;
}

export function crearApp() {
  const app = express();
  app.use(express.json());

  // correlationId por solicitud (documento 11.3): del cliente o generado por el gateway.
  app.use((req, res, next) => {
    req.correlationId = req.header("x-correlation-id") || nuevoCorrelationId();
    res.setHeader("x-correlation-id", req.correlationId);
    next();
  });

  // --- Rutas publicas (no requieren token) ---

  // Liveness para monitores de disponibilidad (UptimeRobot, etc.). Muy liviano: no toca la
  // base de datos ni escribe logs. En Render (plan free) sirve para evitar que el servicio se
  // duerma: configura un monitor HTTP(s) que consulte esta URL periodicamente.
  const arrancado = Date.now();
  const ping = (req, res) =>
    res.json({ ok: true, servicio: "soa-senor-de-luren", uptimeSeg: Math.round((Date.now() - arrancado) / 1000), ts: new Date().toISOString() });
  app.get("/ping", ping);
  app.get("/healthz", ping);

  // Datos para poblar la UI.
  app.get("/api/seed", (req, res) => {
    res.json({ usuarios: USUARIOS, agencias: AGENCIAS, tarifas: TARIFAS, simulado: SIM.nota });
  });

  // Login de demo: selecciona un usuario sembrado y emite su token (documento 10.2).
  app.post("/api/login", (req, res) => {
    const u = USUARIOS.find((x) => x.sub === req.body?.sub);
    if (!u) return res.status(401).json({ error: { codigo: "USUARIO_INVALIDO", mensaje: "Usuario no reconocido." } });
    const token = emitirToken(u);
    log({ correlationId: req.correlationId, servicio: "gateway", operacion: "login", resultado: "exito", sede: u.sede, usuario: u.sub, detalle: `token emitido para ${u.perfil}` });
    res.json({ token, usuario: u });
  });

  // Envios recientes (AYUDA SOLO PARA LA DEMO). En produccion el rastreo publico no listaria envios.
  app.get("/api/rastreo", async (req, res) => {
    try {
      const data = await llamar("trazabilidad", "/recientes", { method: "GET", correlationId: req.correlationId });
      res.json(data);
    } catch (err) {
      const e = err instanceof ErrorSOA ? err : new ErrorSOA({ codigo: "ERROR", mensaje: String(err) });
      res.status(e.httpStatus || 400).json(e.toBody());
    }
  });

  // Consulta publica de rastreo (documento 10.3: publico con codigo).
  app.get("/api/rastreo/:codigo", async (req, res) => {
    if (!rateLimit("rastreo:" + (req.ip || "x"), SECURITY.rastreoRateLimit)) {
      return res.status(429).json({ error: { codigo: "LIMITE_EXCEDIDO", mensaje: "Demasiadas consultas." } });
    }
    try {
      const data = await llamar("trazabilidad", `/estado/${encodeURIComponent(req.params.codigo)}`, { method: "GET", correlationId: req.correlationId });
      res.json(data);
    } catch (err) {
      const e = err instanceof ErrorSOA ? err : new ErrorSOA({ codigo: "ERROR", mensaje: String(err) });
      res.status(e.httpStatus || 400).json(e.toBody());
    }
  });

  // --- Monitoreo (documento 11) ---
  app.get("/api/monitor/metrics", (req, res) => {
    res.json({ ...metrics.snapshot(), circuitos: estadoCircuitos(), colasBroker: estadoColas() });
  });
  app.get("/api/monitor/logs", (req, res) => {
    const { correlationId, codigoRastreo } = req.query;
    if (correlationId || codigoRastreo) return res.json(reconstruir({ correlationId, codigoRastreo }));
    res.json(ultimosLogs(Number(req.query.n) || 200));
  });
  app.get("/api/monitor/dlq", (req, res) => res.json(verDLQ()));
  app.get("/api/monitor/proceso/:correlationId", (req, res) => {
    res.json(db.orquestador.prepare("SELECT * FROM procesos WHERE correlation_id = ?").get(req.params.correlationId) || { error: "sin estado" });
  });
  app.post("/api/monitor/reset-circuitos", (req, res) => {
    reiniciarCircuitos();
    res.json({ ok: true });
  });
  app.post("/api/monitor/reset", (req, res) => {
    reiniciarDatos();
    metrics.negocio.pendientesDePago = 0;
    metrics.negocio.comprobantesPendientes = 0;
    log({ correlationId: req.correlationId, servicio: "gateway", operacion: "reset", resultado: "info", detalle: "datos de la demo reiniciados" });
    res.json({ ok: true });
  });

  // Linea de tiempo en vivo (SSE): transmite cada paso de una operacion segun ocurre.
  app.get("/api/stream/:correlationId", (req, res) => {
    const cid = req.params.correlationId;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`: conectado a ${cid}\n\n`);
    const onLog = (registro) => {
      if (registro.correlationId !== cid) return;
      res.write(`data: ${JSON.stringify(registro)}\n\n`);
    };
    bus.on("log", onLog);
    const latido = setInterval(() => res.write(": latido\n\n"), 15000);
    req.on("close", () => {
      clearInterval(latido);
      bus.off("log", onLog);
    });
  });
  // Topologia del sistema: componentes y sus puertos (lo que se ve en la consola al arrancar).
  app.get("/api/monitor/sistema", (req, res) => {
    const nombres = ["tarifario", "clientes", "encomiendas", "cobros", "facturacion", "trazabilidad", "notificaciones", "recojo"];
    res.json({
      gateway: { nombre: "API Gateway", puerto: PORTS.gateway, rol: "gateway", descripcion: "Entrada unica: auth, autorizacion, correlationId, enrutamiento" },
      servicios: nombres.map((n) => ({ nombre: n, puerto: PORTS[n], rol: "servicio" })),
      speed: SPEED,
      sim: SIM.nota,
    });
  });

  app.get("/api/monitor/flags", (req, res) => res.json(flags));
  app.post("/api/monitor/flags", (req, res) => {
    for (const k of ["failCobros", "failSunat", "slowCobros"]) {
      if (typeof req.body?.[k] === "boolean") flags[k] = req.body[k];
    }
    log({ correlationId: req.correlationId, servicio: "gateway", operacion: "flags", resultado: "info", detalle: JSON.stringify(flags) });
    res.json(flags);
  });
  app.get("/api/monitor/health", async (req, res) => {
    const nombres = ["tarifario", "clientes", "encomiendas", "cobros", "facturacion", "trazabilidad", "notificaciones", "recojo"];
    const salud = {};
    await Promise.all(
      nombres.map(async (n) => {
        try {
          const r = await fetch(baseUrl(n) + "/health", { signal: AbortSignal.timeout(1500) });
          salud[n] = r.ok ? "vivo" : "degradado";
        } catch {
          salud[n] = "caido";
        }
      })
    );
    res.json(salud);
  });

  // --- Middleware de autenticacion para rutas protegidas ---
  function requiereToken(req, res, next) {
    const auth = req.header("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = verificarToken(token);
    if (!user) {
      log({ correlationId: req.correlationId, servicio: "gateway", operacion: "auth", resultado: "error", codigoError: "NO_AUTENTICADO", detalle: "token ausente o invalido" });
      return res.status(401).json({ error: { codigo: "NO_AUTENTICADO", mensaje: "Token ausente o invalido.", correlationId: req.correlationId } });
    }
    if (!rateLimit("u:" + user.sub, SECURITY.rateLimit)) {
      return res.status(429).json({ error: { codigo: "LIMITE_EXCEDIDO", mensaje: "Limite de uso excedido.", correlationId: req.correlationId } });
    }
    req.user = user;
    next();
  }

  // Autorizacion por operacion (documento 10.3). Audita el rechazo.
  function autoriza(operacion, recursoSedeFn) {
    return (req, res, next) => {
      const recursoSede = recursoSedeFn ? recursoSedeFn(req) : undefined;
      const r = autorizar(req.user.perfil, operacion, { tokenSede: req.user.sede, recursoSede });
      if (!r.ok) {
        log({ correlationId: req.correlationId, servicio: "gateway", operacion: "autorizar", resultado: "error", codigoError: "ACCESO_DENEGADO", sede: req.user.sede, usuario: req.user.sub, detalle: `${operacion}: ${r.motivo}` });
        return res.status(403).json({ error: { codigo: "ACCESO_DENEGADO", mensaje: r.motivo, correlationId: req.correlationId } });
      }
      next();
    };
  }

  // Paso 1-2 del proceso: el counter registra y el gateway autentica/autoriza.
  app.post("/api/encomiendas", requiereToken, autoriza("crearEncomienda", (req) => req.body?.sede), async (req, res) => {
    const idemKey = req.header("x-idempotency-key") || nuevaClaveIdempotencia();
    const ctx = { correlationId: req.correlationId, idemKey, perfil: req.user.perfil };
    log({ correlationId: req.correlationId, servicio: "gateway", operacion: "POST /api/encomiendas", resultado: "info", sede: req.user.sede, usuario: req.user.sub, idemKey, detalle: "solicitud de registro autorizada" });
    try {
      const payload = { destinatario: req.body.destinatario, remitente: req.body.remitente, envio: req.body.envio, pago: req.body.pago, sede: req.user.sede, usuario: req.user.sub, tipoCliente: req.body.tipoCliente };
      const resultado = await registrarEncomienda(payload, ctx);
      res.json(resultado);
    } catch (err) {
      const e = err instanceof ErrorSOA ? err : new ErrorSOA({ codigo: "ERROR_INTERNO", mensaje: String(err?.message || err), httpStatus: 500 });
      if (!e.correlationId) e.correlationId = req.correlationId;
      res.status(e.httpStatus || 400).json(e.toBody());
    }
  });

  // Cierre de caja.
  app.post("/api/cobros/cerrar", requiereToken, autoriza("cerrarCaja", (req) => req.body?.agencia), async (req, res) => {
    try {
      const data = await llamar("cobros", "/cerrar", { method: "POST", body: req.body, correlationId: req.correlationId });
      res.json(data);
    } catch (err) {
      const e = err instanceof ErrorSOA ? err : new ErrorSOA({ codigo: "ERROR", mensaje: String(err) });
      res.status(e.httpStatus || 400).json(e.toBody());
    }
  });

  // UI estatica.
  app.use(express.static(UI_DIR));
  app.get("/", (req, res) => res.sendFile(join(UI_DIR, "counter.html")));

  return app;
}

export function iniciarGateway() {
  return new Promise((resolve) => {
    crearApp().listen(PORTS.gateway, () => resolve(PORTS.gateway));
  });
}
