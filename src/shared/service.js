// Utilidades comunes para construir cada servicio como un listener HTTP propio.
import express from "express";
import { ErrorSOA } from "./errors.js";
import { log } from "./logger.js";

export function crearServicio(nombre) {
  const app = express();
  app.use(express.json());
  // Comprobacion de salud (documento 11.5).
  app.get("/health", (req, res) => {
    res.json({ servicio: nombre, vivo: true, ts: new Date().toISOString() });
  });
  app.locals.nombre = nombre;
  return app;
}

// Extrae el contexto propagado en los encabezados (documento 11.3).
export function contexto(req) {
  return {
    correlationId: req.header("x-correlation-id") || null,
    idemKey: req.header("x-idempotency-key") || null,
    perfil: req.header("x-perfil") || null,
  };
}

// Envuelve un handler async: mide duracion, registra log y traduce errores al formato comun.
export function operacion(servicio, operacionNombre, handler) {
  return async (req, res) => {
    const ctx = contexto(req);
    const inicio = Date.now();
    try {
      const resultado = await handler(req, res, ctx);
      if (res.headersSent) return;
      log({
        correlationId: ctx.correlationId,
        servicio,
        operacion: operacionNombre,
        resultado: "exito",
        duracionMs: Date.now() - inicio,
        idemKey: ctx.idemKey,
        codigoRastreo: resultado?.codigoRastreo || req.body?.codigoRastreo || null,
        detalle: resultado?._detalle || null,
      });
      if (resultado && resultado._detalle) delete resultado._detalle;
      res.json(resultado);
    } catch (err) {
      const e = err instanceof ErrorSOA ? err : new ErrorSOA({ codigo: "ERROR_INTERNO", mensaje: String(err?.message || err), httpStatus: 500, tipo: "tecnico-permanente" });
      if (!e.correlationId) e.correlationId = ctx.correlationId;
      log({
        correlationId: ctx.correlationId,
        servicio,
        operacion: operacionNombre,
        resultado: "error",
        codigoError: e.codigo,
        reintentable: e.reintentable,
        duracionMs: Date.now() - inicio,
        idemKey: ctx.idemKey,
        detalle: e.message,
      });
      res.status(e.httpStatus || 400).json(e.toBody());
    }
  };
}

export { express };
