// storage.js (OFICIAL)
// Responsável por: localStorage, CRUD pedidos/propostas, controle de status, regras de fechamento

(function () {
  const cfg = window.APP_CONFIG;

  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix = "ID") {
    return (
      prefix +
      "_" +
      Date.now().toString(36).toUpperCase() +
      "_" +
      Math.random().toString(36).slice(2, 7).toUpperCase()
    );
  }

  function loadDB() {
    try {
      const raw = localStorage.getItem(cfg.STORAGE_KEY);
      if (!raw) return { pedidos: [], propostas: [] };
      const db = JSON.parse(raw);
      return {
        pedidos: Array.isArray(db.pedidos) ? db.pedidos : [],
        propostas: Array.isArray(db.propostas) ? db.propostas : [],
      };
    } catch {
      return { pedidos: [], propostas: [] };
    }
  }

  function saveDB(db) {
    localStorage.setItem(cfg.STORAGE_KEY, JSON.stringify(db));
  }

  // Status:
  // pedido.status: "ABERTO" | "FECHADO" | "EXPIRADO"
  // proposta.status: "ATIVA" | "CANCELADA" | "VENCIDA" | "ACEITA"

  function criarPedido(payload) {
    const db = loadDB();

    const prazoHoras = Number(payload.prazoHoras || cfg.PRAZO_PADRAO_HORAS_PROPOSTAS);
    const criadoEm = nowISO();
    const expiraEm = new Date(Date.now() + prazoHoras * 60 * 60 * 1000).toISOString();

    const pedido = {
      id: uid("PED"),
      clienteNome: String(payload.clienteNome || "").trim(),
      clienteTelefone: String(payload.clienteTelefone || "").trim(),
      titulo: String(payload.titulo || "").trim(),
      descricao: String(payload.descricao || "").trim(),
      endereco: String(payload.endereco || "").trim(),
      prazoHoras,
      criadoEm,
      expiraEm,
      status: "ABERTO",
      propostaAceitaId: null,
    };

    db.pedidos.unshift(pedido);
    saveDB(db);
    return pedido;
  }

  function listarPedidos() {
    const db = loadDB();
    return db.pedidos;
  }

  function obterPedido(pedidoId) {
    const db = loadDB();
    return db.pedidos.find((p) => p.id === pedidoId) || null;
  }

  function listarPropostasPorPedido(pedidoId) {
    const db = loadDB();
    return db.propostas.filter((pr) => pr.pedidoId === pedidoId);
  }

  function obterProposta(propostaId) {
    const db = loadDB();
    return db.propostas.find((pr) => pr.id === propostaId) || null;
  }

  function atualizarStatusPorTempo() {
    // Marca pedidos expirados e propostas vencidas
    const db = loadDB();
    const agora = Date.now();

    let mudou = false;

    for (const ped of db.pedidos) {
      if (ped.status === "ABERTO") {
        const exp = new Date(ped.expiraEm).getTime();
        if (agora > exp) {
          ped.status = "EXPIRADO";
          mudou = true;
        }
      }
    }

    for (const pr of db.propostas) {
      const ped = db.pedidos.find((p) => p.id === pr.pedidoId);
      if (!ped) continue;

      if (pr.status === "ATIVA") {
        if (ped.status === "EXPIRADO") {
          pr.status = "VENCIDA";
          mudou = true;
        }
        if (ped.status === "FECHADO" && ped.propostaAceitaId !== pr.id) {
          pr.status = "CANCELADA";
          mudou = true;
        }
      }
    }

    if (mudou) saveDB(db);
    return mudou;
  }

 function enviarProposta(pedidoId, payload) {
  const db = loadDB();

  // 1) Pedido precisa existir
  const pedido = db.pedidos.find((p) => p.id === pedidoId);
  if (!pedido) throw new Error("Pedido não encontrado.");

  // 2) Pedido precisa estar ABERTO
  if (pedido.status !== "ABERTO") {
    throw new Error("Este pedido não está ABERTO para receber propostas.");
  }

  // 3) Prazo precisa estar válido e não expirado
  const expira = new Date(pedido.expiraEm).getTime();
  if (!isFinite(expira) || Date.now() > expira) {
    pedido.status = "EXPIRADO";
    saveDB(db);
    throw new Error("Prazo expirou. Pedido marcado como EXPIRADO.");
  }

  // 4) Validar prestador e valor
  const prestadorNome = String(payload?.prestadorNome ?? "").trim();
  const prestadorTelefone = String(payload?.prestadorTelefone ?? "").trim();
  const valorProposto = Number(payload?.valorProposto);

  if (!prestadorNome) throw new Error("Informe o nome do prestador.");
  if (!isFinite(valorProposto) || valorProposto <= 0) throw new Error("Valor proposto inválido.");

  const observacao = String(payload?.observacao ?? "").trim();

  // 5) Criar proposta ATIVA
  const proposta = {
    id: uid("PR"),
    pedidoId,
    prestadorNome,
    prestadorTelefone,
    valorProposto,
    observacao,
    status: "ATIVA",
    criadoEm: nowISO(),
    atualizadoEm: nowISO(),
  };

  db.propostas.push(proposta);
  saveDB(db);
  return proposta;
}

  function listarPropostasPorPrestador(nomeCompleto) {
  const db = loadDB();

  const nomeNormalizado = String(nomeCompleto || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!nomeNormalizado) return [];

  return db.propostas.filter(pr => {
    const nomeSalvo = String(pr.prestadorNome || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    return nomeSalvo === nomeNormalizado;
  });
}

function editarProposta(propostaId, payload) {
  const db = loadDB();

  const proposta = db.propostas.find((pr) => pr.id === propostaId);
  if (!proposta) throw new Error("Proposta não encontrada.");

  const pedido = db.pedidos.find((p) => p.id === proposta.pedidoId);
  if (!pedido) throw new Error("Pedido não encontrado para esta proposta.");

  // Só pode editar se estiver ATIVA e pedido ABERTO
  if (proposta.status !== "ATIVA") throw new Error("Só é possível editar proposta ATIVA.");
  if (pedido.status !== "ABERTO") throw new Error("Só é possível editar proposta com pedido ABERTO.");

  // Se expirou, marca e bloqueia
  const expira = new Date(pedido.expiraEm).getTime();
  if (!isFinite(expira) || Date.now() > expira) {
    pedido.status = "EXPIRADO";
    proposta.status = "VENCIDA";
    proposta.atualizadoEm = nowISO();
    saveDB(db);
    throw new Error("Prazo expirou. Pedido EXPIRADO e proposta VENCIDA.");
  }

  const novoValor = Number(payload?.valorProposto);
  if (!isFinite(novoValor) || novoValor <= 0) throw new Error("Novo valor inválido.");

  const novaObs = String(payload?.observacao ?? "").trim();

  proposta.valorProposto = novoValor;
  proposta.observacao = novaObs;
  proposta.atualizadoEm = nowISO();

  saveDB(db);
  return proposta;
}

function cancelarProposta(propostaId) {
  const db = loadDB();

  const proposta = db.propostas.find((pr) => pr.id === propostaId);
  if (!proposta) throw new Error("Proposta não encontrada.");

  const pedido = db.pedidos.find((p) => p.id === proposta.pedidoId);
  if (!pedido) throw new Error("Pedido não encontrado para esta proposta.");

  // Só pode cancelar se estiver ATIVA e pedido ABERTO
  if (proposta.status !== "ATIVA") throw new Error("Só é possível cancelar proposta ATIVA.");
  if (pedido.status !== "ABERTO") throw new Error("Só é possível cancelar enquanto o pedido estiver ABERTO.");

  // Se expirou, marca e bloqueia (mantém regra consistente)
  const expira = new Date(pedido.expiraEm).getTime();
  if (!isFinite(expira) || Date.now() > expira) {
    pedido.status = "EXPIRADO";
    proposta.status = "VENCIDA";
    proposta.atualizadoEm = nowISO();
    saveDB(db);
    throw new Error("Prazo expirou. Pedido EXPIRADO e proposta VENCIDA.");
  }

  proposta.status = "CANCELADA";
  proposta.atualizadoEm = nowISO();

  saveDB(db);
  return proposta;
}

  function aceitarProposta(pedidoId, propostaId) {
  const db = loadDB();

  // 1) Pedido precisa existir
  const pedido = db.pedidos.find((p) => p.id === pedidoId);
  if (!pedido) throw new Error("Pedido não encontrado.");

  // 2) Bloqueios de status
  if (pedido.status === "FECHADO") throw new Error("Pedido já está fechado.");
  if (pedido.status !== "ABERTO") throw new Error("Pedido não está disponível para aceite.");

  // 3) Se prazo expirou (ou data inválida), expira e bloqueia
  const expira = new Date(pedido.expiraEm).getTime();
  if (!isFinite(expira) || Date.now() > expira) {
    pedido.status = "EXPIRADO";
    saveDB(db);
    throw new Error("Prazo expirou. Pedido marcado como EXPIRADO.");
  }

  // 4) Proposta precisa existir e ser do pedido
  const proposta = db.propostas.find((pr) => pr.id === propostaId);
  if (!proposta) throw new Error("Proposta não encontrada.");
  if (proposta.pedidoId !== pedidoId) throw new Error("Proposta não pertence a este pedido.");

  // 5) Só aceita proposta ATIVA
  if (proposta.status !== "ATIVA") throw new Error("Proposta não está ativa para aceite.");

  // 6) Fechar pedido e registrar vencedora
  pedido.status = "FECHADO";
  pedido.propostaAceitaId = proposta.id;

  // 7) Marcar vencedora como ACEITA e cancelar TODAS as outras do pedido
  for (const pr of db.propostas) {
    if (pr.pedidoId !== pedidoId) continue;

    if (pr.id === proposta.id) pr.status = "ACEITA";
    else pr.status = "CANCELADA";

    pr.atualizadoEm = nowISO();
  }

  saveDB(db);

  // ✅ mantém o “final” que o seu app já usa
  return { pedido, proposta };
}

  // Expor API
  window.DB = {
    uid,
    loadDB,
    saveDB,
    criarPedido,
    listarPedidos,
    obterPedido,
    listarPropostasPorPedido,
    listarPropostasPorPrestador,
    obterProposta,
    enviarProposta,
    editarProposta,
    cancelarProposta,
    aceitarProposta,
    atualizarStatusPorTempo,
    
  };
})();
