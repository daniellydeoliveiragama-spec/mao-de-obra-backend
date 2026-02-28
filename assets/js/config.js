// Configurações globais (OFICIAL) — NÃO hardcode no app
window.APP_CONFIG = {
  // Taxas (percentual)
  TAXA_CLIENTE: 0.10,     // 10% (cobra do cliente, mas você não mostra na tela)
  TAXA_PRESTADOR: 0.03,   // 3% (desligável)

  // Liga/desliga taxa do prestador (pra você poder voltar depois)
  COBRAR_TAXA_PRESTADOR: false, // false = não cobra / true = cobra

  // Padrões
  PRAZO_PADRAO_HORAS_PROPOSTAS: 24,

  // Storage (V1 local)
  STORAGE_KEY: "maoDeObraV1_db",

  // Provedor de dados (para evolução sem quebrar)
  // "local" agora, depois vira "supabase"
  DATA_PROVIDER: "local",

  // Versão
  APP_VERSION: "1.0.1",
};