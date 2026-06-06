#!/usr/bin/env node

console.error([
  "Script legado desativado.",
  "Use a tela /dashboard/imports e selecione 'Metas e compras'.",
  "O fluxo atual exige preview, confirmação explícita, import_batch_id e não cria categorias automaticamente.",
].join("\n"));

process.exit(1);
