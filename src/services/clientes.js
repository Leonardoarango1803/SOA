// Servicio Clientes (aplicacion). Operacion: buscarOCrearCliente.
// Datos maestros de remitentes y destinatarios (documento 7.2). RN-02: direccion,
// referencia y telefono del destinatario son obligatorios. Persiste en su propio SQLite.
import { randomUUID } from "node:crypto";
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio } from "../shared/errors.js";
import { db } from "../data/db.js";

export function crearApp() {
  const app = crearServicio("clientes");

  app.post(
    "/buscar-o-crear",
    operacion("clientes", "buscarOCrearCliente", async (req, res, ctx) => {
      const { nombre, documento, telefono, direccion, referencia } = req.body || {};

      // RN-02: datos obligatorios del destinatario.
      if (!nombre || !telefono || !direccion || !referencia) {
        throw errorNegocio("DATOS_CLIENTE_INCOMPLETOS", "Nombre, telefono, direccion y referencia del destinatario son obligatorios.", {
          correlationId: ctx.correlationId,
        });
      }

      // Reutiliza el cliente existente por documento o por telefono.
      const existente = db.clientes
        .prepare("SELECT * FROM clientes WHERE (documento IS NOT NULL AND documento = ?) OR telefono = ? LIMIT 1")
        .get(documento || null, telefono);
      if (existente) {
        return { ...existente, reutilizado: true, _detalle: `cliente reutilizado ${existente.id}` };
      }

      const id = "cli-" + randomUUID().slice(0, 8);
      db.clientes
        .prepare("INSERT INTO clientes (id, nombre, documento, telefono, direccion, referencia) VALUES (?,?,?,?,?,?)")
        .run(id, nombre, documento || null, telefono, direccion, referencia);
      return { id, nombre, documento: documento || null, telefono, direccion, referencia, reutilizado: false, _detalle: `cliente creado ${id}` };
    })
  );

  return app;
}
