// Servicio Facturacion electronica (aplicacion). Operaciones: emitirComprobante, encolarEmision.
// Emite comprobantes ante SUNAT/OSE (SIMULADO, documento 7.2). Si SUNAT/OSE no responde,
// la emision se difiere sin perder el envio (RN-05, paso 8D). Persiste en SQLite.
import { randomUUID } from "node:crypto";
import { crearServicio, operacion } from "../shared/service.js";
import { errorTecnico } from "../shared/errors.js";
import { conIdempotencia } from "../shared/idempotency.js";
import { db } from "../data/db.js";
import { flags } from "../config.js";

export function crearApp() {
  const app = crearServicio("facturacion");

  app.post(
    "/emitir",
    operacion("facturacion", "emitirComprobante", async (req, res, ctx) => {
      const { idEncomienda, idCobro, cliente, tipo = "boleta", monto } = req.body || {};

      // SUNAT/OSE no disponible (SIMULADO): error tecnico reintentable.
      if (flags.failSunat) {
        throw errorTecnico("SUNAT_NO_DISPONIBLE", "SUNAT/OSE no responde (simulado).", { correlationId: ctx.correlationId });
      }

      return conIdempotencia(db.facturacion, ctx.idemKey, { idEncomienda, idCobro, monto }, ctx, async () => {
        // Unicidad: un comprobante por cobro.
        const previo = db.facturacion.prepare("SELECT serie, numero FROM comprobantes WHERE id_cobro = ? AND estado = 'Facturada'").get(idCobro);
        if (previo) return { serie: previo.serie, numero: previo.numero, estado: "Facturada", _detalle: "comprobante ya emitido (unicidad)" };

        const serie = tipo === "factura" ? "F001" : "B001";
        const maxNum = db.facturacion.prepare("SELECT COALESCE(MAX(numero), 1000) AS m FROM comprobantes").get().m;
        const numero = maxNum + 1;
        db.facturacion
          .prepare("INSERT INTO comprobantes (id, id_encomienda, id_cobro, tipo, serie, numero, monto, estado, emitido_en) VALUES (?,?,?,?,?,?,?,?,?)")
          .run("fac-" + randomUUID().slice(0, 8), idEncomienda, idCobro, tipo, serie, numero, monto, "Facturada", new Date().toISOString());
        return { serie, numero, estado: "Facturada", _detalle: `comprobante ${serie}-${numero} emitido` };
      });
    })
  );

  // Diferir la emision (documento paso 8D): queda "Comprobante pendiente" en cola diferida.
  app.post(
    "/encolar",
    operacion("facturacion", "encolarEmision", async (req, res, ctx) => {
      const { idEncomienda, idCobro, motivo } = req.body || {};
      db.facturacion
        .prepare("INSERT INTO comprobantes (id, id_encomienda, id_cobro, estado, motivo, emitido_en) VALUES (?,?,?,?,?,?)")
        .run("facp-" + randomUUID().slice(0, 8), idEncomienda, idCobro, "Comprobante pendiente", motivo || "SUNAT/OSE no disponible", new Date().toISOString());
      return { estado: "Comprobante pendiente", _detalle: `emision diferida para ${idEncomienda}` };
    })
  );

  return app;
}
