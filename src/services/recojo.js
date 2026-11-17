// Servicio Recojo a domicilio (negocio). Operaciones: solicitarRecojo, asignarMotorizado.
// Agenda el recojo y asigna motorizado (documento 7.2). Incluido para completar los ocho
// servicios del diseno; implementacion minima. Persiste en SQLite.
import { randomUUID } from "node:crypto";
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio } from "../shared/errors.js";
import { db } from "../data/db.js";

export function crearApp() {
  const app = crearServicio("recojo");

  app.post(
    "/solicitar",
    operacion("recojo", "solicitarRecojo", async (req, res, ctx) => {
      const { direccion, ventana = "manana (lunes a sabado)", telefono } = req.body || {};
      if (!direccion || !telefono) throw errorNegocio("RECOJO_INCOMPLETO", "Direccion y telefono son obligatorios.", { correlationId: ctx.correlationId });
      const id = "rec-" + randomUUID().slice(0, 8);
      db.recojo
        .prepare("INSERT INTO solicitudes (id, direccion, telefono, ventana, estado, motorizado, creada_en) VALUES (?,?,?,?,?,?,?)")
        .run(id, direccion, telefono, ventana, "Programado", null, new Date().toISOString());
      return { id, estado: "Programado", ventana, _detalle: `recojo ${id} programado` };
    })
  );

  app.post(
    "/asignar",
    operacion("recojo", "asignarMotorizado", async (req, res, ctx) => {
      const { id, motorizado } = req.body || {};
      const s = db.recojo.prepare("SELECT id FROM solicitudes WHERE id = ?").get(id);
      if (!s) throw errorNegocio("RECOJO_NO_ENCONTRADO", `No existe la solicitud ${id}.`, { correlationId: ctx.correlationId });
      const m = motorizado || "Motorizado Ica";
      db.recojo.prepare("UPDATE solicitudes SET motorizado = ?, estado = 'Asignado' WHERE id = ?").run(m, id);
      return { id, estado: "Asignado", motorizado: m };
    })
  );

  return app;
}
