// Persistencia con SQLite usando el modulo NATIVO de Node (node:sqlite), sin dependencias
// nuevas ni compilacion. "Esquema por servicio" (documento 6.2): cada servicio tiene su
// PROPIO archivo de base de datos y solo accede a el; representa la autonomia de datos y la
// cuenta propia por servicio del diseno SOA.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLIENTES_EJEMPLO } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Directorio de las bases SQLite. Configurable para apuntar a un disco persistente en la
// nube (p. ej. SOA_DB_DIR=/var/data en Render). Por defecto, local junto al codigo.
const DIR = process.env.SOA_DB_DIR || join(__dirname, "db");
mkdirSync(DIR, { recursive: true });

const abrir = (svc) => new DatabaseSync(join(DIR, `${svc}.db`));

// Una base de datos por servicio.
export const db = {
  clientes: abrir("clientes"),
  encomiendas: abrir("encomiendas"),
  cobros: abrir("cobros"),
  facturacion: abrir("facturacion"),
  trazabilidad: abrir("trazabilidad"),
  notificaciones: abrir("notificaciones"),
  recojo: abrir("recojo"),
  orquestador: abrir("orquestador"),
};

// Tabla de idempotencia comun a los servicios con efectos (documento 9.3).
const DDL_IDEMPOTENCIA = `
  CREATE TABLE IF NOT EXISTS idempotencia (
    clave TEXT PRIMARY KEY,
    huella TEXT NOT NULL,
    respuesta_json TEXT NOT NULL,
    creado_en TEXT NOT NULL
  );`;

export function inicializarEsquemas() {
  db.clientes.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY, nombre TEXT, documento TEXT, telefono TEXT,
      direccion TEXT, referencia TEXT
    );`);

  db.encomiendas.exec(`
    CREATE TABLE IF NOT EXISTS encomiendas (
      id TEXT PRIMARY KEY, codigo_rastreo TEXT UNIQUE, remitente_json TEXT,
      destinatario_json TEXT, origen TEXT, destino TEXT, bultos INTEGER, peso REAL,
      tarifa REAL, modalidad TEXT, sede TEXT, estado TEXT, correlation_id TEXT,
      motivo_anulacion TEXT, creada_en TEXT
    );
    ${DDL_IDEMPOTENCIA}`);

  db.cobros.exec(`
    CREATE TABLE IF NOT EXISTS cobros (
      id_cobro TEXT PRIMARY KEY, id_encomienda TEXT, monto REAL, medio TEXT,
      agencia TEXT, turno TEXT, registrado_en TEXT,
      UNIQUE (id_encomienda, turno)
    );
    ${DDL_IDEMPOTENCIA}`);

  db.facturacion.exec(`
    CREATE TABLE IF NOT EXISTS comprobantes (
      id TEXT PRIMARY KEY, id_encomienda TEXT, id_cobro TEXT, tipo TEXT, serie TEXT,
      numero INTEGER, monto REAL, estado TEXT, motivo TEXT, emitido_en TEXT
    );
    ${DDL_IDEMPOTENCIA}`);

  db.trazabilidad.exec(`
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, codigo_rastreo TEXT, estado TEXT,
      sede TEXT, usuario TEXT, fecha TEXT, correlation_id TEXT
    );`);

  db.notificaciones.exec(`
    CREATE TABLE IF NOT EXISTS avisos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, canal TEXT, destinatario TEXT, mensaje TEXT,
      codigo_rastreo TEXT, correlation_id TEXT, estado TEXT, enviado_en TEXT
    );`);

  db.recojo.exec(`
    CREATE TABLE IF NOT EXISTS solicitudes (
      id TEXT PRIMARY KEY, direccion TEXT, telefono TEXT, ventana TEXT,
      estado TEXT, motorizado TEXT, creada_en TEXT
    );`);

  db.orquestador.exec(`
    CREATE TABLE IF NOT EXISTS procesos (
      correlation_id TEXT PRIMARY KEY, paso TEXT, estado TEXT, id_encomienda TEXT,
      codigo_rastreo TEXT, sede TEXT, usuario TEXT, actualizado TEXT
    );`);
}

// Siembra clientes de ejemplo si la tabla esta vacia.
export function sembrarClientes() {
  const n = db.clientes.prepare("SELECT COUNT(*) AS c FROM clientes").get().c;
  if (n > 0) return;
  const ins = db.clientes.prepare("INSERT INTO clientes (id, nombre, documento, telefono, direccion, referencia) VALUES (?,?,?,?,?,?)");
  for (const c of CLIENTES_EJEMPLO) ins.run(c.id, c.nombre, c.documento, c.telefono, c.direccion, c.referencia);
}

// Limpia todas las tablas (boton de reinicio para la demo).
export function reiniciarDatos() {
  db.encomiendas.exec("DELETE FROM encomiendas; DELETE FROM idempotencia;");
  db.cobros.exec("DELETE FROM cobros; DELETE FROM idempotencia;");
  db.facturacion.exec("DELETE FROM comprobantes; DELETE FROM idempotencia;");
  db.trazabilidad.exec("DELETE FROM eventos;");
  db.notificaciones.exec("DELETE FROM avisos;");
  db.recojo.exec("DELETE FROM solicitudes;");
  db.orquestador.exec("DELETE FROM procesos;");
}
