// Servicio Encomiendas (negocio). Operaciones: crearEncomienda, anularEncomienda, obtenerEncomienda.
// Crea la orden y genera el codigo de rastreo (documento 7.2). RN-06: un unico identificador
// y un unico codigo de rastreo por envio. Aplica idempotencia (documento 9.3). Persiste en SQLite.
import { randomUUID } from "node:crypto";
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio } from "../shared/errors.js";
import { conIdempotencia } from "../shared/idempotency.js";
import { nuevoCodigoRastreo } from "../shared/ids.js";
import { db } from "../data/db.js";

export function crearApp() {
  const app = crearServicio("encomiendas");

  app.post(
    "/crear",
    operacion("encomiendas", "crearEncomienda", async (req, res, ctx) => {
      const { remitente, destinatario, origen, destino, bultos, peso, tarifa, modalidad, sede } = req.body || {};
      if (!destino || !origen || tarifa == null) {
        throw errorNegocio("DATOS_ORDEN_INCOMPLETOS", "Faltan datos obligatorios de la orden.", { correlationId: ctx.correlationId });
      }

      return conIdempotencia(db.encomiendas, ctx.idemKey, { remitente, destinatario, origen, destino, bultos, peso, tarifa }, ctx, async () => {
        const id = "enc-" + randomUUID().slice(0, 8);
        const codigoRastreo = nuevoCodigoRastreo();
        db.encomiendas
          .prepare(`INSERT INTO encomiendas
            (id, codigo_rastreo, remitente_json, destinatario_json, origen, destino, bultos, peso, tarifa, modalidad, sede, estado, correlation_id, creada_en)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, codigoRastreo, JSON.stringify(remitente || null), JSON.stringify(destinatario || null), origen, destino, bultos || 1, peso || 0, tarifa, modalidad || "agencia", sede || origen, "Registrada", ctx.correlationId, new Date().toISOString());
        return { id, codigoRastreo, estado: "Registrada", _detalle: `orden ${id} creada` };
      });
    })
  );

  // Cambia el estado de la orden (lo invoca el orquestador al avanzar el proceso).
  app.post(
    "/estado",
    operacion("encomiendas", "actualizarEstado", async (req, res, ctx) => {
      const { id, estado } = req.body || {};
      const enc = db.encomiendas.prepare("SELECT codigo_rastreo FROM encomiendas WHERE id = ?").get(id);
      if (!enc) throw errorNegocio("ENCOMIENDA_NO_ENCONTRADA", `No existe la encomienda ${id}.`, { correlationId: ctx.correlationId });
      db.encomiendas.prepare("UPDATE encomiendas SET estado = ? WHERE id = ?").run(estado, id);
      return { id, estado, codigoRastreo: enc.codigo_rastreo };
    })
  );

  // Compensacion (documento 9.5, paso 7C): anular la orden si el cobro no se regulariza.
  app.post(
    "/anular",
    operacion("encomiendas", "anularEncomienda", async (req, res, ctx) => {
      const { id, motivo } = req.body || {};
      const enc = db.encomiendas.prepare("SELECT codigo_rastreo FROM encomiendas WHERE id = ?").get(id);
      if (!enc) throw errorNegocio("ENCOMIENDA_NO_ENCONTRADA", `No existe la encomienda ${id}.`, { correlationId: ctx.correlationId });
      db.encomiendas.prepare("UPDATE encomiendas SET estado = 'Anulada', motivo_anulacion = ? WHERE id = ?").run(motivo || "compensacion por falla de cobro", id);
      return { id, estado: "Anulada", codigoRastreo: enc.codigo_rastreo, _detalle: `orden ${id} anulada (compensacion)` };
    })
  );

  app.get(
    "/:id",
    operacion("encomiendas", "obtenerEncomienda", async (req, res, ctx) => {
      const enc = db.encomiendas.prepare("SELECT * FROM encomiendas WHERE id = ?").get(req.params.id);
      if (!enc) throw errorNegocio("ENCOMIENDA_NO_ENCONTRADA", `No existe la encomienda ${req.params.id}.`, { correlationId: ctx.correlationId });
      return enc;
    })
  );

  return app;
}
