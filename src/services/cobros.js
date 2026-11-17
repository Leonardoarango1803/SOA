// Servicio Cobros y caja (negocio). Operaciones: registrarCobro, cerrarCaja.
// Registra el cobro del flete y consolida el cierre diario (documento 7.2). Persiste en SQLite.
// Incluye el interruptor de falla de la demo (flags.failCobros / flags.slowCobros).
import { randomUUID } from "node:crypto";
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio, errorTecnico } from "../shared/errors.js";
import { conIdempotencia } from "../shared/idempotency.js";
import { db } from "../data/db.js";
import { flags } from "../config.js";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearApp() {
  const app = crearServicio("cobros");

  app.post(
    "/registrar",
    operacion("cobros", "registrarCobro", async (req, res, ctx) => {
      const { idEncomienda, monto, tarifa, medio = "efectivo", agencia, turno = "manana" } = req.body || {};

      // Interruptor de demora (dispara timeouts y backoff del httpClient).
      if (flags.slowCobros) await dormir(7000);

      // Interruptor de falla (demo de compensacion 7C): error tecnico reintentable.
      if (flags.failCobros) {
        throw errorTecnico("COBRO_NO_DISPONIBLE", "Servicio de cobros no disponible (falla simulada).", { correlationId: ctx.correlationId });
      }

      // Regla: el monto debe igualar la tarifa cotizada (documento 9.6, error de negocio).
      if (tarifa != null && Number(monto) !== Number(tarifa)) {
        throw errorNegocio("MONTO_DISTINTO_TARIFA", `El monto ${monto} no coincide con la tarifa ${tarifa}.`, { correlationId: ctx.correlationId });
      }

      return conIdempotencia(db.cobros, ctx.idemKey, { idEncomienda, monto, turno, agencia }, ctx, async () => {
        // Unicidad: un cobro por encomienda y turno (documento 9.3).
        const existente = db.cobros.prepare("SELECT id_cobro FROM cobros WHERE id_encomienda = ? AND turno = ?").get(idEncomienda, turno);
        if (existente) return { idCobro: existente.id_cobro, estado: "Cobrada", _detalle: "cobro ya existente (unicidad)" };

        const idCobro = "cob-" + randomUUID().slice(0, 8);
        db.cobros
          .prepare("INSERT INTO cobros (id_cobro, id_encomienda, monto, medio, agencia, turno, registrado_en) VALUES (?,?,?,?,?,?,?)")
          .run(idCobro, idEncomienda, Number(monto), medio, agencia, turno, new Date().toISOString());
        return { idCobro, estado: "Cobrada", _detalle: `cobro ${idCobro} registrado` };
      });
    })
  );

  // Cierre y consolidacion de caja (documento 7.2).
  app.post(
    "/cerrar",
    operacion("cobros", "cerrarCaja", async (req, res, ctx) => {
      const { agencia, turno } = req.body || {};
      const fila = db.cobros
        .prepare(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total FROM cobros
          WHERE (? IS NULL OR agencia = ?) AND (? IS NULL OR turno = ?)`)
        .get(agencia || null, agencia || null, turno || null, turno || null);
      return { agencia: agencia || "todas", turno: turno || "todos", cantidad: fila.cantidad, total: Math.round(fila.total * 100) / 100, moneda: "PEN" };
    })
  );

  return app;
}
