// app.js (OFICIAL - V1)
// Interface, render, eventos, cálculos de taxas (usando config), atualização visual
// V1: cancelar proposta (mais rápido/seguro) — sem editar (deixa pra V2)

(function () {
  const cfg = window.APP_CONFIG;
  if (!cfg) {
    console.error("APP_CONFIG não encontrado. Verifique se config.js carrega antes do app.js.");
    return;
  }
  if (!window.DB) {
    console.error("window.DB não encontrado. Verifique se storage.js carrega antes do app.js.");
    return;
  }

  const $$ = (s) => document.querySelectorAll(s);

  // IDS (batendo com o SEU index.html)
  const IDS = {
    tabCliente: "tab-cliente",
    tabPrestador: "tab-prestador",

    // Cliente
    formPedido: "formPedido",
    cNome: "c_nome",
    cTel: "c_tel",
    pTitulo: "p_titulo",
    pDesc: "p_desc",
    pEnd: "p_end",
    pPrazo: "p_prazo",
    listaPedidosCliente: "listaPedidosCliente",
    boxPedidoSelecionado: "boxPedidoSelecionado",
    listaPropostasCliente: "listaPropostasCliente",

    // Prestador
    formProposta: "formProposta",
    prNome: "pr_nome",
    prTel: "pr_tel",
    prPedidoSelect: "pr_pedidoSelect",
    prValor: "pr_valor",
    prObs: "pr_obs",
    boxTaxasPrestador: "boxTaxasPrestador",
    listaPedidosPrestador: "listaPedidosPrestador",

    // Minhas propostas (filtro)
    filtroPrestadorNome: "filtroPrestadorNome",
    filtroPrestadorTel: "filtroPrestadorTel", // ✅ ADICIONADO (tem no seu HTML)
    listaMinhasPropostas: "listaMinhasPropostas",

    // Rodapé
    rodapeVersao: "rodapeVersao",
  };

  function byId(id) {
    const el = document.getElementById(id);
    if (!el) console.error(`[ERRO DE ID] Não encontrei no HTML o id: #${id}`);
    return el;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function moedaBR(v) {
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function fmtData(iso) {
    try {
      return new Date(iso).toLocaleString("pt-BR");
    } catch {
      return String(iso || "");
    }
  }

  // Taxas transparentes (com chave para ligar/desligar taxa do prestador)
function calcTaxas(valorBase) {
  const valor = Number(valorBase || 0);

  const taxaCliente = valor * cfg.TAXA_CLIENTE;
  const totalCliente = valor + taxaCliente;

  // ✅ Prestador: liga/desliga via config.js
  const cobrarPrestador = cfg.COBRAR_TAXA_PRESTADOR === true;
  const taxaPrestador = cobrarPrestador ? (valor * cfg.TAXA_PRESTADOR) : 0;
  const liquidoPrestador = valor - taxaPrestador;

  return { valor, taxaCliente, totalCliente, taxaPrestador, liquidoPrestador, cobrarPrestador };
}

  // Normalização (melhor para nomes e filtros)
  function normTxt(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "); // colapsa espaços
  }
  function normTel(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  // Pega todas as propostas (sem depender de DB.listarPropostas)
  function getTodasPropostas() {
    const pedidos = window.DB.listarPedidos ? window.DB.listarPedidos() : [];
    const arr = [];
    for (const p of pedidos) {
      const props = window.DB.listarPropostasPorPedido ? window.DB.listarPropostasPorPedido(p.id) : [];
      for (const pr of props) arr.push(pr);
    }
    return arr;
  }

  // ============================
  // Tabs
  // ============================
  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tab = btn.dataset.tab;
      byId(IDS.tabCliente)?.classList.toggle("hidden", tab !== "cliente");
      byId(IDS.tabPrestador)?.classList.toggle("hidden", tab !== "prestador");

      renderTudo();
    });
  });

  // ============================
  // Inicial
  // ============================
  const elPrazo = byId(IDS.pPrazo);
  if (elPrazo) elPrazo.value = cfg.PRAZO_PADRAO_HORAS_PROPOSTAS;

  const elRodape = byId(IDS.rodapeVersao);
  if (elRodape) {
    elRodape.textContent = `Mão de Obra V1 • Offline (localStorage) • v${cfg.APP_VERSION}`;
  }

  let pedidoSelecionadoId = null;

  // ============================
  // CLIENTE: criar pedido
  // ============================
  byId(IDS.formPedido)?.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const pedido = window.DB.criarPedido({
        clienteNome: byId(IDS.cNome)?.value,
        clienteTelefone: byId(IDS.cTel)?.value,
        titulo: byId(IDS.pTitulo)?.value,
        descricao: byId(IDS.pDesc)?.value,
        endereco: byId(IDS.pEnd)?.value,
        prazoHoras: byId(IDS.pPrazo)?.value,
      });

      pedidoSelecionadoId = pedido.id;

      byId(IDS.formPedido)?.reset();
      if (byId(IDS.pPrazo)) byId(IDS.pPrazo).value = cfg.PRAZO_PADRAO_HORAS_PROPOSTAS;

      renderTudo();
      alert("Pedido criado e aberto para propostas!");
    } catch (err) {
      alert(err?.message || "Erro ao criar pedido.");
    }
  });

  // ============================
  // PRESTADOR: box de taxas
  // ============================
 function atualizarBoxTaxasPrestador() {
  const box = byId(IDS.boxTaxasPrestador);
  if (!box) return;

  const valor = byId(IDS.prValor)?.value;
  const selPedidoId = byId(IDS.prPedidoSelect)?.value;

  if (!selPedidoId) {
    box.innerHTML = `<div class="muted small">Selecione um pedido e digite um valor para ver as taxas.</div>`;
    return;
  }

  const t = calcTaxas(valor);

  // ✅ Controle simples: se TAXA_PRESTADOR for 0, não mostra taxa prestador
  const cobrarPrestador = cfg.COBRAR_TAXA_PRESTADOR === true;

 box.innerHTML = `
  <div class="pills">
  <span class="pill ok">Total do serviço: <strong>${moedaBR(t.valor)}</strong></span>
  </div>
`;
}

  byId(IDS.prValor)?.addEventListener("input", atualizarBoxTaxasPrestador);
  byId(IDS.prPedidoSelect)?.addEventListener("change", atualizarBoxTaxasPrestador);

  // ============================
  // PRESTADOR: enviar proposta
  // ============================
  byId(IDS.formProposta)?.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const pedidoId = byId(IDS.prPedidoSelect)?.value;

      window.DB.enviarProposta(pedidoId, {
        prestadorNome: byId(IDS.prNome)?.value,
        prestadorTelefone: byId(IDS.prTel)?.value,
        valorProposto: byId(IDS.prValor)?.value,
        observacao: byId(IDS.prObs)?.value,
      });

      byId(IDS.formProposta)?.reset();
      atualizarBoxTaxasPrestador();
      renderTudo();
      alert("Proposta enviada! (privada — somente o cliente vê)");
    } catch (err) {
      alert(err?.message || "Erro ao enviar proposta.");
    }
  });

  // ============================
  // RENDER: pedidos do cliente
  // ============================
  function renderPedidosCliente() {
    window.DB.atualizarStatusPorTempo();
    const pedidos = window.DB.listarPedidos();

    const box = byId(IDS.listaPedidosCliente);
    if (!box) return;

    box.innerHTML = "";

    if (!pedidos.length) {
      box.innerHTML = `<div class="item"><p class="muted">Nenhum pedido criado ainda.</p></div>`;
      return;
    }

    for (const p of pedidos) {
      const pillClass = p.status === "FECHADO" ? "ok" : p.status === "EXPIRADO" ? "danger" : "warn";
      const propostas = window.DB.listarPropostasPorPedido(p.id);
      const totalPropostas = propostas.length;

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="itemtop">
          <div>
            <h3>${escapeHtml(p.titulo)} <span class="pill ${pillClass}">${escapeHtml(p.status)}</span></h3>
            <div class="pills">
              <span class="pill">ID: ${escapeHtml(p.id)}</span>
              <span class="pill">Criado: ${escapeHtml(fmtData(p.criadoEm))}</span>
              <span class="pill">Expira: ${escapeHtml(fmtData(p.expiraEm))}</span>
              <span class="pill">Propostas: <strong>${totalPropostas}</strong></span>
            </div>
            <p class="muted small" style="margin:10px 0 0;">
              <strong>Cliente:</strong> ${escapeHtml(p.clienteNome)} • <strong>Endereço:</strong> ${escapeHtml(p.endereco)}
            </p>
          </div>
          <div class="itemactions">
            <button class="btn" data-action="selecionar" data-id="${p.id}">Ver propostas</button>
          </div>
        </div>
      `;

      if (pedidoSelecionadoId === p.id) div.style.borderColor = "rgba(74,163,255,.65)";
      box.appendChild(div);
    }
  }

  // ============================
  // RENDER: propostas do pedido selecionado (cliente)
  // ============================
  function renderPropostasCliente() {
    const boxSel = byId(IDS.boxPedidoSelecionado);
    const list = byId(IDS.listaPropostasCliente);
    if (!boxSel || !list) return;

    list.innerHTML = "";

    if (!pedidoSelecionadoId) {
      boxSel.textContent = "Selecione um pedido para ver as propostas.";
      return;
    }

    const pedido = window.DB.obterPedido(pedidoSelecionadoId);
    if (!pedido) {
      boxSel.textContent = "Pedido não encontrado.";
      return;
    }

    const propostas = window.DB.listarPropostasPorPedido(pedidoSelecionadoId);

    boxSel.innerHTML = `
      <div class="pills">
        <span class="pill">Pedido: <strong>${escapeHtml(pedido.titulo)}</strong></span>
        <span class="pill">${escapeHtml(pedido.status)}</span>
      </div>
      <p class="muted small" style="margin:10px 0 0;">
        Propostas são privadas. Cliente aceita apenas 1 proposta. Ao aceitar, o pedido FECHA e as demais são canceladas.
      </p>
    `;

    if (!propostas.length) {
      list.innerHTML = `<div class="item"><p class="muted">Ainda não há propostas para este pedido.</p></div>`;
      return;
    }

    for (const pr of propostas) {
      const t = calcTaxas(pr.valorProposto);
      const prClass = pr.status === "ACEITA" ? "ok" : pr.status === "ATIVA" ? "warn" : "danger";
      const podeAceitar = pedido.status === "ABERTO" && pr.status === "ATIVA";

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="itemtop">
          <div>
            <h3>${escapeHtml(pr.prestadorNome)} <span class="pill ${prClass}">${escapeHtml(pr.status)}</span></h3>

            <div class="pills">
             <span class="pill ok">Total do serviço: <strong>${moedaBR(t.valor)}</strong></span>
            </div>
            <p class="muted small" style="margin:10px 0 0;">
              <strong>Obs:</strong> ${escapeHtml(pr.observacao || "—")}
            </p>
          </div>

          <div class="itemactions">
            ${
              podeAceitar
                ? `<button class="btn primary" data-action="aceitarProposta" data-proposta="${pr.id}">Aceitar proposta</button>`
                : ""
            }
          </div>
        </div>
      `;
      list.appendChild(div);
    }
  }

  // ============================
  // RENDER: pedidos abertos (prestador)
  // ============================
  function renderPedidosPrestador() {
    window.DB.atualizarStatusPorTempo();
    const pedidos = window.DB.listarPedidos();

    const abertos = pedidos.filter((p) => p.status === "ABERTO" && Date.now() <= new Date(p.expiraEm).getTime());

    const list = byId(IDS.listaPedidosPrestador);
    if (!list) return;

    list.innerHTML = "";

    if (!abertos.length) {
      list.innerHTML = `<div class="item"><p class="muted">Nenhum pedido aberto no momento.</p></div>`;
      return;
    }

    for (const p of abertos) {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="itemtop">
          <div>
            <h3>${escapeHtml(p.titulo)} <span class="pill warn">ABERTO</span></h3>
            <div class="pills">
              <span class="pill">Expira: <strong>${escapeHtml(fmtData(p.expiraEm))}</strong></span>
              <span class="pill">Endereço: ${escapeHtml(p.endereco)}</span>
            </div>
            <p class="muted small" style="margin:10px 0 0;">
              <strong>Descrição:</strong> ${escapeHtml(p.descricao || "—")}
            </p>
          </div>
        </div>
      `;
      list.appendChild(div);
    }
  }

  // ============================
  // RENDER: select pedidos abertos (prestador)
  // ============================
  function renderSelectPedidosPrestador() {
    window.DB.atualizarStatusPorTempo();
    const pedidos = window.DB.listarPedidos();

    const abertos = pedidos.filter((p) => p.status === "ABERTO" && Date.now() <= new Date(p.expiraEm).getTime());

    const sel = byId(IDS.prPedidoSelect);
    if (!sel) return;

    sel.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Selecione um pedido...";
    sel.appendChild(opt0);

    for (const p of abertos) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.titulo} (expira ${new Date(p.expiraEm).toLocaleString("pt-BR")})`;
      sel.appendChild(opt);
    }
  }

  // ============================
  // RENDER: minhas propostas (prestador) — nome e/ou telefone
  // ============================
  function renderMinhasPropostas() {
    window.DB.atualizarStatusPorTempo();

    const box = byId(IDS.listaMinhasPropostas);
    if (!box) return;

    const nome = normTxt(byId(IDS.filtroPrestadorNome)?.value);
    const tel = normTel(byId(IDS.filtroPrestadorTel)?.value);

    if (!nome && !tel) {
      box.innerHTML = `Digite seu <strong>nome</strong> ou <strong>telefone</strong> para ver suas propostas.`;
      return;
    }

    const todas = getTodasPropostas();

    const minhas = todas.filter((p) => {
      const pNome = normTxt(p.prestadorNome);
      const pTel = normTel(p.prestadorTelefone);

      const okNome = nome ? (pNome === nome) : true;
      const okTel = tel ? (pTel === tel) : true;

      return okNome && okTel;
    });

    if (!minhas.length) {
      box.innerHTML = `<div class="item"><p class="muted">Nenhuma proposta encontrada para esse filtro.</p></div>`;
      return;
    }

    box.innerHTML = "";

    for (const pr of minhas) {
      const ped = window.DB.obterPedido(pr.pedidoId);

      const pedidoAberto = ped && ped.status === "ABERTO";
      const dentroPrazo = ped && Date.now() <= new Date(ped.expiraEm).getTime();
      const podeCancelar = pr.status === "ATIVA" && pedidoAberto && dentroPrazo;

      const t = calcTaxas(pr.valorProposto);

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="itemtop">
          <div>
            <h3>${escapeHtml(ped ? ped.titulo : "(Pedido removido)")}</h3>

        <div class="pills">
          <span class="pill ok">Total do serviço: <strong>${moedaBR(t.valor)}</strong></span>
        </div>


            <p class="muted small" style="margin:10px 0 0;">
              <strong>Telefone:</strong> ${escapeHtml(pr.prestadorTelefone || "—")}<br/>
              <strong>Obs:</strong> ${escapeHtml(pr.observacao || "—")}<br/>
              <strong>Expira:</strong> ${ped ? escapeHtml(fmtData(ped.expiraEm)) : "—"}
            </p>
          </div>

          <div class="itemactions">
            ${
              podeCancelar
                ? `<button class="btn" data-action="cancelarProposta" data-proposta="${pr.id}">Cancelar proposta</button>`
                : ""
            }
          </div>
        </div>
      `;
      box.appendChild(div);
    }
  }

  // ============================
  // Filtro prestador: salvar + renderizar
  // ============================
  function salvarFiltroPrestador() {
    try {
      localStorage.setItem(
        "MO_PRESTADOR_FILTRO",
        JSON.stringify({
          nome: byId(IDS.filtroPrestadorNome)?.value || "",
          tel: byId(IDS.filtroPrestadorTel)?.value || "",
        })
      );
    } catch {}
  }

  byId(IDS.filtroPrestadorNome)?.addEventListener("input", () => {
    salvarFiltroPrestador();
    renderMinhasPropostas();
  });
  byId(IDS.filtroPrestadorTel)?.addEventListener("input", () => {
    salvarFiltroPrestador();
    renderMinhasPropostas();
  });

  // ============================
  // EVENTOS (1 ÚNICO listener)
  // ============================
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;

    // 1) Cliente: selecionar pedido (aceita variações)
   if (action === "selecionar" || action === "verPropostas" || action === "ver_propostas" || action === "verProposta") {
  const id =
    btn.dataset.id ||
    btn.dataset.pedidoId ||
    btn.dataset.pedido ||
    btn.getAttribute("data-id");

  if (!id) return;

  pedidoSelecionadoId = id;

  // Atualiza só as propostas do pedido selecionado
  renderPropostasCliente();
  return;
}

    // 2) Cliente: aceitar proposta
    if (action === "aceitarProposta") {
      const propostaId = btn.dataset.proposta;
      const pedidoId = pedidoSelecionadoId;

      if (!pedidoId) return alert("Selecione um pedido primeiro (clique em 'Ver propostas').");
      if (!propostaId) return alert("Proposta inválida.");

      const ok = confirm("Aceitar esta proposta? Isso FECHA o pedido e cancela as outras.");
      if (!ok) return;

      try {
        window.DB.aceitarProposta(pedidoId, propostaId);
        pedidoSelecionadoId = pedidoId;
        renderTudo();
        alert("Proposta aceita. Pedido FECHADO!");
      } catch (err) {
        alert(err?.message || "Erro ao aceitar proposta.");
      }
      return;
    }

    // 3) Prestador: cancelar proposta
    if (action === "cancelarProposta") {
      const propostaId = btn.dataset.proposta;
      if (!propostaId) return alert("Proposta inválida.");

      const ok = confirm("Cancelar esta proposta? Você poderá enviar outra.");
      if (!ok) return;

      try {
        window.DB.cancelarProposta(propostaId);
        renderTudo();
        alert("Proposta cancelada.");
      } catch (err) {
        alert(err?.message || "Erro ao cancelar proposta.");
      }
      return;
    }
  });

  // ============================
  // Render geral
  // ============================
  function renderTudo() {
    renderPedidosCliente();
    renderPropostasCliente();
    renderPedidosPrestador();
    renderSelectPedidosPrestador();
    atualizarBoxTaxasPrestador();
    renderMinhasPropostas();
  }

  // ============================
  // Restaurar filtro prestador
  // ============================
  try {
    const raw = localStorage.getItem("MO_PRESTADOR_FILTRO");
    if (raw) {
      const data = JSON.parse(raw);
      const n = byId(IDS.filtroPrestadorNome);
      const t = byId(IDS.filtroPrestadorTel);
      if (n && data.nome) n.value = data.nome;
      if (t && data.tel) t.value = data.tel;
    }
  } catch {}

  // ===============================
// LIMPAR DADOS DE TESTE
// ===============================
const btnLimpar = document.getElementById("btnLimparDados");

if (btnLimpar) {
  btnLimpar.addEventListener("click", function () {
    const confirmar = confirm("Tem certeza que deseja apagar TODOS os pedidos e propostas?");
    if (!confirmar) return;

    localStorage.removeItem(window.APP_CONFIG.STORAGE_KEY);
    location.reload();
  });
}

// ============================
// MODAL TERMOS (ABRIR/FECHAR)
// ============================
(function setupModalTermos() {
  const modal = document.getElementById("modalTermos");
  const abrir = document.getElementById("abrirTermos");
  const fechar = document.getElementById("btnFecharTermos");

  if (!modal || !abrir || !fechar) return;

  function abrirModal() {
    modal.classList.remove("hidden");
  }
  function fecharModal() {
    modal.classList.add("hidden");
  }

  abrir.addEventListener("click", abrirModal);
  fechar.addEventListener("click", fecharModal);

  // fecha clicando fora do conteúdo
  modal.addEventListener("click", (e) => {
    if (e.target === modal) fecharModal();
  });

 // fecha no ESC
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharModal();
});
})();

// Start
renderTudo();
})();