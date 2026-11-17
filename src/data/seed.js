// Datos de prueba: agencias, usuarios por perfil, tarifas y clientes de ejemplo.
// La siembra de clientes en SQLite se hace en db.js (sembrarClientes).

// Sedes/agencias de la empresa (documento 2.1).
export const AGENCIAS = ["Lima", "Ica", "Palpa", "Nazca", "Chimbote"];

// Usuarios por perfil para la demo. La contrasena no se usa: el login de demo
// solo selecciona el usuario y emite un token con su perfil y sede (documento 10.2).
export const USUARIOS = [
  { sub: "c-ica", nombre: "Counter Ica", perfil: "counter", sede: "Ica" },
  { sub: "c-lima", nombre: "Counter Lima", perfil: "counter", sede: "Lima" },
  { sub: "j-ica", nombre: "Jefe de agencia Ica", perfil: "jefe_agencia", sede: "Ica" },
  { sub: "m-ica", nombre: "Motorizado Ica", perfil: "motorizado", sede: "Ica" },
  { sub: "admin", nombre: "Administracion central", perfil: "admin_central", sede: "Lima" },
  { sub: "b2b-oneberry", nombre: "One Berry (B2B)", perfil: "b2b", sede: "Lima" },
];

// Tarifario (documento RN-03): tarifa base desde S/ 9.00 segun peso, volumen, destino y modalidad.
export const TARIFAS = {
  base: 9.0,
  porKg: 1.5,
  porVolumen: 8.0, // por m3
  porDestino: { Lima: 0, Ica: 6, Palpa: 9, Nazca: 12, Chimbote: 10 },
  recargoDomicilio: 5.0,
  descuentoB2B: 0.1,
  vigenciaDias: 7,
};

// Clientes de ejemplo (datos ficticios).
export const CLIENTES_EJEMPLO = [
  { id: "cli-001", nombre: "Comercial San Jose", documento: "20100000001", telefono: "987654321", direccion: "Av. Grau 123, Ica", referencia: "Frente al parque" },
  { id: "cli-002", nombre: "Maria Quispe", documento: "41222333", telefono: "912345678", direccion: "Jr. Lima 456, Nazca", referencia: "Puerta azul" },
];
