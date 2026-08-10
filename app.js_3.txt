// ============================================================
// Menopausa Sem Sofrimentos — Prontuário de Alunas
// Lógica principal do app (Fase 1 + ajustes v2)
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const EXAMES_PADRAO = [
  "TSH e T4 livre",
  "Glicemia de jejum",
  "Insulina de jejum",
  "Hemoglobina glicada",
  "HOMA-IR",
  "Vitamina B12",
  "Cortisol das 8h",
  "Vitamina D",
  "Ferritina",
];

const MESES_NOME = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

let state = {
  user: null,
  turmas: [],
  turmaAberta: null,      // turma cujo painel de alunas está aberto na sidebar
  alunas: [],              // alunas da turma aberta
  alunaAtual: null,        // aluna selecionada (ficha aberta)
  ultimasPesagens: {},     // aluna_id -> data do último peso registrado
  secaoAtiva: "turmas",    // turmas | calendario | clubinho
  calMes: undefined,       // mês em exibição no calendário (0-11)
  calAno: undefined,
  eventosMes: [],
  clubinhos: [],
  clubinhoAberto: null,
};

// ------------------------------------------------------------
// Helpers de UI
// ------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => document.querySelectorAll(sel);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function fmtData(d) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function addMeses(dataStr, meses) {
  const d = new Date(dataStr + "T00:00:00");
  d.setMonth(d.getMonth() + meses);
  return d;
}

// Acesso da aluna baseado nas datas da TURMA (início / fim opcional)
function acessoInfo(turma) {
  if (!turma || !turma.data_fim) {
    return { semPrazo: true, texto: "Sem prazo definido", atrasado: false, dataFim: null };
  }
  const dataFim = new Date(turma.data_fim + "T00:00:00");
  const agora = new Date();
  const diffMs = dataFim - agora;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDias < 0) {
    return { semPrazo: false, texto: `Acesso encerrado há ${Math.abs(diffDias)} dia(s)`, atrasado: true, dataFim };
  }
  const dMeses = Math.floor(diffDias / 30);
  const dDias = diffDias % 30;
  let texto = "";
  if (dMeses > 0) texto += `${dMeses} mês(es) `;
  texto += `${dDias} dia(s) restante(s) de acesso`;
  return { semPrazo: false, texto, atrasado: false, dataFim };
}

// Lembrete de pesagem baseado no intervalo de dias configurado na TURMA
function statusPesagemTurma(turma, ultimaData) {
  if (!turma?.intervalo_pesagem_dias || !turma?.data_inicio_acesso) return null;

  const inicio = new Date(turma.data_inicio_acesso + "T00:00:00");
  const hojeDate = new Date();
  hojeDate.setHours(0, 0, 0, 0);

  const diasDesdeInicio = Math.floor((hojeDate - inicio) / (1000 * 60 * 60 * 24));
  if (diasDesdeInicio < 0) return null;

  const intervalo = turma.intervalo_pesagem_dias;
  const resto = diasDesdeInicio % intervalo;
  const dataEsperada = new Date(hojeDate);
  dataEsperada.setDate(hojeDate.getDate() - resto);
  const dataEsperadaStr = dataEsperada.toISOString().slice(0, 10);

  const emDia = ultimaData && ultimaData >= dataEsperadaStr;
  if (emDia) return null;

  if (resto === 0) {
    return { tipo: "hoje", texto: "Pesagem é hoje" };
  }
  return { tipo: "atrasada", texto: `Pesagem atrasada (era dia ${fmtData(dataEsperadaStr)})` };
}

function toast(msg, isErro = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isErro ? " erro" : "");
  setTimeout(() => t.classList.remove("show"), 3500);
}

// ------------------------------------------------------------
// AUTENTICAÇÃO
// ------------------------------------------------------------
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await entrarApp();
  } else {
    mostrarLogin();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  hide($("#app"));
  show($("#tela-login"));
}

async function entrarApp() {
  hide($("#tela-login"));
  show($("#app"));
  $("#user-email").textContent = state.user.email;
  await carregarTurmas();
  mudarSecao("turmas");
  await carregarClubinhos(); // dispara o aviso de Clubinho não cadastrado, se for o caso
}

// ------------------------------------------------------------
// NAVEGAÇÃO PRINCIPAL: Turmas / Calendário / Clubinho
// ------------------------------------------------------------
function mudarSecao(secao) {
  state.secaoAtiva = secao;
  $all(".nav-botao").forEach(b => b.classList.toggle("ativo", b.dataset.secao === secao));

  hide($("#secao-clubinho"));
  hide($("#conteudo-calendario"));
  hide($("#conteudo-clubinho"));

  if (secao === "turmas") {
    show($("#secao-turmas"));
    mostrarPainelTurmas();
  } else {
    hide($("#secao-turmas"));
    hide($("#ficha-vazia"));
    hide($("#ficha-aluna"));

    if (secao === "calendario") {
      show($("#conteudo-calendario"));
      abrirCalendario();
    } else if (secao === "clubinho") {
      show($("#secao-clubinho"));
      show($("#conteudo-clubinho"));
      if (state.clubinhoAberto) show($("#clubinho-detalhe")); else show($("#clubinho-vazio"));
      carregarClubinhos();
    }
  }
}
$all(".nav-botao").forEach(btn => {
  btn.addEventListener("click", () => mudarSecao(btn.dataset.secao));
});

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const senha = $("#login-senha").value;
  const btn = $("#btn-login");
  btn.disabled = true;
  btn.textContent = "Entrando...";

  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });

  btn.disabled = false;
  btn.textContent = "Entrar";

  if (error) {
    $("#login-erro").textContent = "E-mail ou senha inválidos.";
    show($("#login-erro"));
    return;
  }
  state.user = data.user;
  await entrarApp();
});

$("#btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
});

// ------------------------------------------------------------
// TURMAS
// ------------------------------------------------------------
async function carregarTurmas() {
  const { data, error } = await sb.from("turmas").select("*").order("nome");
  if (error) { toast("Erro ao carregar turmas: " + error.message, true); return; }
  state.turmas = data || [];
  renderTurmasSelectAluna();
  if (state.turmaAberta) {
    // mantém a turma aberta atualizada (caso tenha sido editada)
    state.turmaAberta = state.turmas.find(t => t.id === state.turmaAberta.id) || null;
  }
}

function turmaPorId(id) {
  return state.turmas.find(t => t.id === id) || null;
}

function renderTurmasSelectAluna() {
  const sel = $("#aluna-turma");
  const atual = sel.value;
  sel.innerHTML = `<option value="">Sem turma</option>` +
    state.turmas.map(t => `<option value="${t.id}">${t.nome}</option>`).join("");
  if (atual) sel.value = atual;
}

// ------------------------------------------------------------
// NAVEGAÇÃO DA SIDEBAR: painel de turmas <-> painel da turma aberta
// ------------------------------------------------------------
function mostrarPainelTurmas() {
  state.turmaAberta = null;
  state.alunaAtual = null;
  $("#busca-global").value = "";
  hide($("#resultado-busca-global"));
  show($("#painel-turmas"));
  hide($("#painel-turma-aberta"));
  renderListaTurmas();
  hide($("#ficha-aluna"));
  show($("#ficha-vazia"));
}

async function abrirPainelTurma(turma) {
  state.turmaAberta = turma;
  $("#busca-global").value = "";
  hide($("#resultado-busca-global"));
  hide($("#painel-turmas"));
  show($("#painel-turma-aberta"));

  $("#turma-aberta-nome").textContent = turma.nome;
  const acesso = acessoInfo(turma);
  const periodoTexto = `Início: ${fmtData(turma.data_inicio_acesso)}` +
    (turma.data_fim ? ` · Fim: ${fmtData(turma.data_fim)}` : " · sem data de término") +
    (turma.intervalo_pesagem_dias ? ` · Pesagem a cada ${turma.intervalo_pesagem_dias} dias` : "");
  $("#turma-aberta-periodo").textContent = periodoTexto;

  await carregarAlunasDaTurma();
}

function renderListaTurmas() {
  const lista = $("#lista-turmas");
  if (state.turmas.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhuma turma cadastrada ainda.</p>`;
    return;
  }
  lista.innerHTML = state.turmas.map(t => {
    const periodo = `${fmtData(t.data_inicio_acesso)} — ${t.data_fim ? fmtData(t.data_fim) : "sem prazo"}`;
    return `
      <div class="item-turma" data-id="${t.id}">
        <div class="item-turma-nome">${t.nome}</div>
        <div class="item-turma-periodo">${periodo}</div>
      </div>
    `;
  }).join("");

  $all(".item-turma").forEach(el => {
    el.addEventListener("click", () => {
      const turma = turmaPorId(el.dataset.id);
      if (turma) abrirPainelTurma(turma);
    });
  });
}

$("#btn-voltar-turmas").addEventListener("click", mostrarPainelTurmas);

$("#btn-nova-turma").addEventListener("click", () => abrirFormTurma(null));
$("#btn-editar-turma").addEventListener("click", () => abrirFormTurma(state.turmaAberta));

function abrirFormTurma(turma) {
  $("#form-turma").reset();
  $("#turma-id").value = turma?.id || "";
  $("#modal-turma-titulo").textContent = turma ? "Editar turma" : "Nova turma";

  if (turma) {
    $("#turma-nome").value = turma.nome || "";
    $("#turma-data-inicio").value = turma.data_inicio_acesso || hoje();
    $("#turma-data-fim").value = turma.data_fim || "";
    $("#turma-intervalo-pesagem").value = turma.intervalo_pesagem_dias ?? "";
  } else {
    $("#turma-data-inicio").value = hoje();
  }
  show($("#modal-turma"));
}

$("#btn-fechar-modal-turma").addEventListener("click", () => hide($("#modal-turma")));
$("#btn-cancelar-turma").addEventListener("click", () => hide($("#modal-turma")));

$("#form-turma").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#turma-id").value;

  const payload = {
    nome: $("#turma-nome").value.trim(),
    data_inicio_acesso: $("#turma-data-inicio").value || hoje(),
    data_fim: $("#turma-data-fim").value || null,
    intervalo_pesagem_dias: $("#turma-intervalo-pesagem").value ? parseInt($("#turma-intervalo-pesagem").value, 10) : null,
  };

  let error, novaTurma;
  if (id) {
    ({ error } = await sb.from("turmas").update(payload).eq("id", id));
  } else {
    ({ data: novaTurma, error } = await sb.from("turmas").insert(payload).select().single());
  }

  if (error) { toast("Erro ao salvar turma: " + error.message, true); return; }
  toast("Turma salva com sucesso!");
  hide($("#modal-turma"));
  await carregarTurmas();

  if (id && state.turmaAberta?.id === id) {
    await abrirPainelTurma(turmaPorId(id));
  } else {
    renderListaTurmas();
  }
});

// ------------------------------------------------------------
// BUSCA GLOBAL (todas as turmas)
// ------------------------------------------------------------
let timeoutBusca = null;
$("#busca-global").addEventListener("input", (e) => {
  clearTimeout(timeoutBusca);
  const termo = e.target.value.trim();
  if (!termo) {
    hide($("#resultado-busca-global"));
    show($("#painel-turmas"));
    if (state.turmaAberta) { hide($("#painel-turmas")); show($("#painel-turma-aberta")); }
    return;
  }
  timeoutBusca = setTimeout(() => buscarAlunasGlobal(termo), 300);
});

async function buscarAlunasGlobal(termo) {
  hide($("#painel-turmas"));
  hide($("#painel-turma-aberta"));
  const resultado = $("#resultado-busca-global");
  show(resultado);

  const { data, error } = await sb.from("alunas")
    .select("*, turmas(nome)")
    .ilike("nome", `%${termo}%`)
    .order("nome");

  if (error) { toast("Erro na busca: " + error.message, true); return; }

  if (!data || data.length === 0) {
    resultado.innerHTML = `<p class="vazio">Nenhuma aluna encontrada.</p>`;
    return;
  }

  resultado.innerHTML = data.map(a => `
    <div class="item-aluna" data-id="${a.id}">
      <div class="item-aluna-nome">${a.nome}</div>
      <div class="item-aluna-meta">${a.turmas?.nome || "sem turma"}</div>
    </div>
  `).join("");

  $all("#resultado-busca-global .item-aluna").forEach(el => {
    el.addEventListener("click", async () => {
      const { data: alunaCompleta } = await sb.from("alunas").select("*, turmas(*)").eq("id", el.dataset.id).single();
      if (alunaCompleta?.turmas) {
        await abrirPainelTurma(alunaCompleta.turmas);
      }
      await abrirAluna(el.dataset.id);
    });
  });
}

// ------------------------------------------------------------
// LISTA DE ALUNAS (dentro da turma aberta)
// ------------------------------------------------------------
async function carregarAlunasDaTurma() {
  if (!state.turmaAberta) return;
  const { data, error } = await sb.from("alunas")
    .select("*, turmas(nome, data_inicio_acesso, data_fim, intervalo_pesagem_dias)")
    .eq("turma_id", state.turmaAberta.id)
    .order("nome");
  if (error) { toast("Erro ao carregar alunas: " + error.message, true); return; }
  state.alunas = data || [];
  await carregarUltimasPesagens();
  renderListaAlunas();
}

async function carregarUltimasPesagens() {
  const ids = state.alunas.map(a => a.id);
  state.ultimasPesagens = {};
  if (ids.length === 0) return;
  const { data, error } = await sb.from("pesos")
    .select("aluna_id, data")
    .in("aluna_id", ids)
    .order("data", { ascending: false });
  if (error) return;
  (data || []).forEach(p => {
    if (!state.ultimasPesagens[p.aluna_id]) state.ultimasPesagens[p.aluna_id] = p.data;
  });
}

function renderListaAlunas() {
  const lista = $("#lista-alunas");
  if (state.alunas.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhuma aluna nessa turma ainda.</p>`;
    return;
  }

  lista.innerHTML = state.alunas.map(a => {
    const acesso = acessoInfo(a.turmas);
    const badge = a.fase === "manutencao" ? '<span class="badge manutencao">Manutenção</span>' : "";
    const alerta = acesso.atrasado ? '<span class="badge atrasado">Acesso vencido</span>' : "";
    const pesagem = statusPesagemTurma(a.turmas, state.ultimasPesagens[a.id]);
    const badgePesagem = pesagem
      ? `<span class="badge ${pesagem.tipo === 'hoje' ? 'pesagem-hoje' : 'pesagem-atrasada'}">⚖️ ${pesagem.texto}</span>`
      : "";
    return `
      <div class="item-aluna ${state.alunaAtual?.id === a.id ? 'ativo' : ''}" data-id="${a.id}">
        <div class="item-aluna-nome">${a.nome}</div>
        <div class="item-aluna-meta">${acesso.texto}</div>
        <div class="item-aluna-badges">${badge}${alerta}${badgePesagem}</div>
      </div>
    `;
  }).join("");

  $all("#lista-alunas .item-aluna").forEach(el => {
    el.addEventListener("click", () => abrirAluna(el.dataset.id));
  });
}

// ------------------------------------------------------------
// NOVA ALUNA
// ------------------------------------------------------------
$("#btn-nova-aluna").addEventListener("click", () => abrirFormAluna(null));

function abrirFormAluna(aluna) {
  $("#form-aluna").reset();
  $("#aluna-id").value = aluna?.id || "";
  $("#modal-aluna-titulo").textContent = aluna ? "Editar aluna" : "Nova aluna";
  renderTurmasSelectAluna();

  if (aluna) {
    $("#aluna-nome").value = aluna.nome || "";
    $("#aluna-email").value = aluna.email || "";
    $("#aluna-telefone").value = aluna.telefone || "";
    $("#aluna-turma").value = aluna.turma_id || "";
    $("#aluna-data-entrada").value = aluna.data_entrada || hoje();
    $("#aluna-peso-inicial").value = aluna.peso_inicial ?? "";
    $("#aluna-meta-peso").value = aluna.meta_peso ?? "";
    $("#aluna-objetivo").value = aluna.objetivo || "emagrecimento";
    $("#aluna-status").value = aluna.status || "ativa";
    $("#aluna-queixas").value = aluna.queixas_iniciais || "";
    $("#aluna-restricoes").value = aluna.restricoes || "";
  } else {
    $("#aluna-data-entrada").value = hoje();
    if (state.turmaAberta) $("#aluna-turma").value = state.turmaAberta.id;
  }

  show($("#modal-aluna"));
}

$("#btn-fechar-modal-aluna").addEventListener("click", () => hide($("#modal-aluna")));
$("#btn-cancelar-aluna").addEventListener("click", () => hide($("#modal-aluna")));

$("#form-aluna").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#aluna-id").value;

  const payload = {
    nome: $("#aluna-nome").value.trim(),
    email: $("#aluna-email").value.trim() || null,
    telefone: $("#aluna-telefone").value.trim() || null,
    turma_id: $("#aluna-turma").value || null,
    data_entrada: $("#aluna-data-entrada").value,
    peso_inicial: $("#aluna-peso-inicial").value ? parseFloat($("#aluna-peso-inicial").value) : null,
    meta_peso: $("#aluna-meta-peso").value ? parseFloat($("#aluna-meta-peso").value) : null,
    objetivo: $("#aluna-objetivo").value,
    status: $("#aluna-status").value,
    queixas_iniciais: $("#aluna-queixas").value.trim() || null,
    restricoes: $("#aluna-restricoes").value.trim() || null,
  };

  let error, novaAluna;
  if (id) {
    ({ error } = await sb.from("alunas").update(payload).eq("id", id));
  } else {
    ({ data: novaAluna, error } = await sb.from("alunas").insert(payload).select().single());
  }

  if (error) { toast("Erro ao salvar aluna: " + error.message, true); return; }

  toast("Aluna salva com sucesso!");
  hide($("#modal-aluna"));

  const turmaDestino = turmaPorId(payload.turma_id);
  if (turmaDestino) {
    await abrirPainelTurma(turmaDestino);
  }
  const idAberta = id || novaAluna?.id;
  if (idAberta) await abrirAluna(idAberta);
});

// ------------------------------------------------------------
// EXCLUIR ALUNA
// ------------------------------------------------------------
$("#btn-excluir-aluna").addEventListener("click", async () => {
  if (!state.alunaAtual) return;
  const confirmar = confirm(`Tem certeza que quer excluir "${state.alunaAtual.nome}"? Isso apaga também o histórico de peso, exames, receitas e entregas dela. Essa ação não pode ser desfeita.`);
  if (!confirmar) return;

  const { error } = await sb.from("alunas").delete().eq("id", state.alunaAtual.id);
  if (error) { toast("Erro ao excluir aluna: " + error.message, true); return; }

  toast("Aluna excluída.");
  state.alunaAtual = null;
  hide($("#ficha-aluna"));
  show($("#ficha-vazia"));
  if (state.turmaAberta) await carregarAlunasDaTurma();
});

// ------------------------------------------------------------
// FICHA DA ALUNA (detalhe)
// ------------------------------------------------------------
async function abrirAluna(id) {
  const { data, error } = await sb.from("alunas")
    .select("*, turmas(nome, data_inicio_acesso, data_fim, intervalo_pesagem_dias)")
    .eq("id", id).single();
  if (error) { toast("Erro ao abrir aluna: " + error.message, true); return; }
  state.alunaAtual = data;
  renderListaAlunas();
  renderFichaAluna();
  await Promise.all([carregarPesos(), carregarPedidosExame(), carregarReceitas(), carregarEntregas()]);
  show($("#ficha-aluna"));
  hide($("#ficha-vazia"));
  mudarAba("dados");

  // datas dos formulários já vêm preenchidas com hoje, pra não precisar ficar selecionando
  $("#peso-data").value = hoje();
  $("#pedido-data").value = hoje();
  $("#receita-data").value = hoje();
  $("#entrega-data").value = hoje();
}

function renderFichaAluna() {
  const a = state.alunaAtual;
  const acesso = acessoInfo(a.turmas);

  $("#ficha-nome").textContent = a.nome;
  $("#ficha-turma").textContent = a.turmas?.nome || "sem turma";
  $("#ficha-status").textContent = a.status;
  $("#ficha-status").className = "badge status-" + a.status;
  $("#ficha-data-entrada").textContent = fmtData(a.data_entrada);
  $("#ficha-saida-prevista").textContent = acesso.semPrazo ? "Sem prazo definido" : acesso.dataFim.toLocaleDateString("pt-BR");
  $("#ficha-tempo-restante").textContent = acesso.texto;
  $("#ficha-tempo-restante").classList.toggle("atrasado", acesso.atrasado);

  $("#ficha-objetivo").textContent = a.objetivo;
  $("#ficha-peso-inicial").textContent = a.peso_inicial ? `${a.peso_inicial} kg` : "-";
  $("#ficha-meta-peso").textContent = a.meta_peso ? `${a.meta_peso} kg` : "-";
  $("#ficha-queixas").textContent = a.queixas_iniciais || "Nenhuma queixa registrada.";
  $("#ficha-restricoes").textContent = a.restricoes || "Nenhuma restrição registrada.";
  $("#ficha-evolucao").textContent = a.evolucao || "Sem observações de evolução.";

  const alertaFase = $("#alerta-fase-manutencao");
  if (a.fase === "manutencao") {
    alertaFase.textContent = `✅ Esta aluna já está na Fase de Manutenção (objetivo: ${a.objetivo}).`;
    show(alertaFase);
    alertaFase.className = "alerta info";
  } else {
    hide(alertaFase);
  }
}

$("#btn-editar-aluna").addEventListener("click", () => abrirFormAluna(state.alunaAtual));

$("#btn-editar-evolucao").addEventListener("click", async () => {
  const atual = state.alunaAtual.evolucao || "";
  const novo = prompt("Atualizar evolução da aluna:", atual);
  if (novo === null) return;
  const { error } = await sb.from("alunas").update({ evolucao: novo }).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro: " + error.message, true); return; }
  toast("Evolução atualizada.");
  await abrirAluna(state.alunaAtual.id);
});

// Abas dentro da ficha
function mudarAba(nome) {
  $all(".aba-conteudo").forEach(el => hide(el));
  $all(".aba-botao").forEach(el => el.classList.remove("ativo"));
  show($(`#aba-${nome}`));
  $(`.aba-botao[data-aba="${nome}"]`).classList.add("ativo");
}
$all(".aba-botao").forEach(btn => {
  btn.addEventListener("click", () => mudarAba(btn.dataset.aba));
});

// ------------------------------------------------------------
// PESO
// ------------------------------------------------------------
async function carregarPesos() {
  const { data, error } = await sb.from("pesos")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar peso: " + error.message, true); return; }
  renderPesos(data || []);
}

function renderPesos(pesos) {
  const lista = $("#lista-pesos");
  const a = state.alunaAtual;

  const alertaMeta = $("#alerta-meta-peso");
  hide(alertaMeta);

  const alertaPesagem = $("#alerta-pesagem");
  const ultimaData = pesos[0]?.data || null;
  const pesagem = statusPesagemTurma(a.turmas, ultimaData);
  if (pesagem) {
    alertaPesagem.textContent = pesagem.tipo === "hoje"
      ? `⚖️ Hoje é dia de pesagem de ${a.nome} (turma ${a.turmas?.nome || ""}). Lembre ela de te enviar o peso!`
      : `⚖️ A pesagem de ${a.nome} está atrasada — ${pesagem.texto}.`;
    alertaPesagem.className = "alerta " + (pesagem.tipo === "hoje" ? "info" : "atencao");
    show(alertaPesagem);
  } else {
    hide(alertaPesagem);
  }

  if (pesos.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum peso registrado ainda.</p>`;
  } else {
    lista.innerHTML = pesos.map(p => `
      <div class="linha-peso">
        <span>${fmtData(p.data)}</span>
        <strong>${p.peso} kg</strong>
        <span class="obs">${p.observacao || ""}</span>
        <span class="acoes-linha">
          <button class="btn-icone editar-peso" data-id="${p.id}" title="Editar">✏️</button>
          <button class="btn-icone excluir excluir-peso" data-id="${p.id}" title="Excluir">🗑️</button>
        </span>
      </div>
    `).join("");

    $all(".editar-peso").forEach(btn => btn.addEventListener("click", () => editarPeso(btn.dataset.id, pesos)));
    $all(".excluir-peso").forEach(btn => btn.addEventListener("click", () => excluirPeso(btn.dataset.id)));

    if (a.meta_peso) {
      const pesoRecente = pesos[0].peso;
      const atingiu = a.objetivo === "hipertrofia"
        ? pesoRecente >= a.meta_peso
        : pesoRecente <= a.meta_peso;

      if (atingiu && a.fase !== "manutencao") {
        alertaMeta.innerHTML = `🎯 <strong>${a.nome}</strong> atingiu a meta de peso (${a.meta_peso} kg)! Considere mover para a <strong>Fase de Manutenção</strong>.
          <button id="btn-mover-manutencao" class="btn-mini">Mover para manutenção</button>`;
        show(alertaMeta);
        $("#btn-mover-manutencao").addEventListener("click", moverParaManutencao);
      }
    }
  }
}

async function editarPeso(id, pesos) {
  const p = pesos.find(x => x.id === id);
  if (!p) return;
  const novoPeso = prompt("Peso (kg):", p.peso);
  if (novoPeso === null) return;
  const novaObs = prompt("Observação:", p.observacao || "");
  const { error } = await sb.from("pesos").update({
    peso: parseFloat(novoPeso),
    observacao: novaObs?.trim() || null,
  }).eq("id", id);
  if (error) { toast("Erro ao editar peso: " + error.message, true); return; }
  toast("Peso atualizado!");
  await carregarPesos();
}

async function excluirPeso(id) {
  if (!confirm("Excluir esse registro de peso?")) return;
  const { error } = await sb.from("pesos").delete().eq("id", id);
  if (error) { toast("Erro ao excluir: " + error.message, true); return; }
  toast("Peso excluído.");
  await carregarPesos();
}

async function moverParaManutencao() {
  const { error } = await sb.from("alunas").update({ fase: "manutencao" }).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro: " + error.message, true); return; }
  toast("Aluna movida para Fase de Manutenção!");
  await abrirAluna(state.alunaAtual.id);
}

$("#form-peso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    aluna_id: state.alunaAtual.id,
    data: $("#peso-data").value || hoje(),
    peso: parseFloat($("#peso-valor").value),
    observacao: $("#peso-obs").value.trim() || null,
  };
  const { error } = await sb.from("pesos").insert(payload);
  if (error) { toast("Erro ao salvar peso: " + error.message, true); return; }
  $("#form-peso").reset();
  $("#peso-data").value = hoje();
  toast("Peso registrado!");
  await carregarPesos();
});

// ------------------------------------------------------------
// EXAMES — PEDIDOS agrupados em levas, com resultado e data de
// entrega editáveis direto em cada item (sem anexo de arquivo)
// ------------------------------------------------------------
function renderChecklistExames() {
  const container = $("#checklist-exames");
  container.innerHTML = EXAMES_PADRAO.map((nome) => `
    <label class="checklist-item">
      <input type="checkbox" name="exame-padrao" value="${nome}">
      ${nome}
    </label>
  `).join("");
}
renderChecklistExames();

function anoDoPrograma(dataEntrada, dataExame) {
  const entrada = new Date(dataEntrada + "T00:00:00");
  const exame = new Date(dataExame + "T00:00:00");
  let anos = exame.getFullYear() - entrada.getFullYear();
  const aniversarioEsteAno = new Date(exame.getFullYear(), entrada.getMonth(), entrada.getDate());
  if (exame < aniversarioEsteAno) anos -= 1;
  return anos + 1;
}

let levasAbertas = new Set();

async function carregarPedidosExame() {
  const { data, error } = await sb.from("pedidos_exame")
    .select("*, itens_pedido_exame(*)")
    .eq("aluna_id", state.alunaAtual.id)
    .order("created_at", { ascending: true });
  if (error) { toast("Erro ao carregar pedidos de exame: " + error.message, true); return; }
  renderPedidosExame(data || []);
}

function renderPedidosExame(pedidos) {
  const lista = $("#lista-pedidos");
  const a = state.alunaAtual;

  const anoAtual = anoDoPrograma(a.data_entrada, hoje());
  const pedidosAnoAtual = pedidos.filter(p => anoDoPrograma(a.data_entrada, p.data) === anoAtual).length;

  $("#cota-exames").textContent = `${pedidosAnoAtual} de 4 pedidos (levas) usados no ${anoAtual}º ano de programa`;
  $("#cota-exames").className = "cota" + (pedidosAnoAtual >= 4 ? " estourada" : "");

  if (pedidos.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum pedido de exame registrado ainda.</p>`;
    return;
  }

  // mostra as levas mais recentes primeiro, mas numeradas em ordem cronológica (1, 2, 3...)
  const numeradas = pedidos.map((p, i) => ({ ...p, numero: i + 1 }));
  const paraExibir = [...numeradas].reverse();

  lista.innerHTML = paraExibir.map(p => {
    const aberta = levasAbertas.has(p.id);
    const itens = p.itens_pedido_exame || [];
    return `
      <div class="leva-pedido">
        <div class="leva-pedido-header" data-id="${p.id}">
          <div>
            <span class="leva-pedido-titulo">Pedido de exame ${p.numero}</span>
            <span class="leva-pedido-sub">${fmtData(p.data)} · ${itens.length} exame(s) · ${anoDoPrograma(a.data_entrada, p.data)}º ano de programa</span>
          </div>
          <div class="leva-pedido-acoes">
            <button class="btn-icone excluir excluir-leva" data-id="${p.id}" title="Excluir leva inteira">🗑️</button>
            <span>${aberta ? "▲" : "▼"}</span>
          </div>
        </div>
        <div class="leva-pedido-itens ${aberta ? "" : "hidden"}" data-itens-de="${p.id}">
          ${itens.map(item => `
            <div class="item-exame" data-item-id="${item.id}">
              <span class="item-exame-nome">${item.nome_exame}</span>
              <input type="text" class="input-resultado" placeholder="Resultado (valor)" value="${item.resultado || ""}" data-id="${item.id}">
              <input type="date" class="input-data-entrega" value="${item.data_entrega || ""}" data-id="${item.id}">
              <button class="btn-icone excluir excluir-item-exame" data-id="${item.id}" title="Excluir exame">🗑️</button>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  $all(".leva-pedido-header").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".excluir-leva")) return;
      const id = el.dataset.id;
      if (levasAbertas.has(id)) levasAbertas.delete(id); else levasAbertas.add(id);
      renderPedidosExame(pedidos);
    });
  });

  $all(".excluir-leva").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Excluir essa leva de pedido e todos os exames dela?")) return;
      const { error } = await sb.from("pedidos_exame").delete().eq("id", btn.dataset.id);
      if (error) { toast("Erro ao excluir: " + error.message, true); return; }
      toast("Pedido excluído.");
      await carregarPedidosExame();
    });
  });

  $all(".excluir-item-exame").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Excluir esse exame da leva?")) return;
      const { error } = await sb.from("itens_pedido_exame").delete().eq("id", btn.dataset.id);
      if (error) { toast("Erro ao excluir: " + error.message, true); return; }
      toast("Exame excluído.");
      await carregarPedidosExame();
    });
  });

  $all(".input-resultado").forEach(input => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("blur", async () => {
      const { error } = await sb.from("itens_pedido_exame").update({ resultado: input.value.trim() || null }).eq("id", input.dataset.id);
      if (error) toast("Erro ao salvar resultado: " + error.message, true);
    });
  });

  $all(".input-data-entrega").forEach(input => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", async () => {
      const { error } = await sb.from("itens_pedido_exame").update({ data_entrega: input.value || null }).eq("id", input.dataset.id);
      if (error) toast("Erro ao salvar data de entrega: " + error.message, true);
      else toast("Data de entrega salva!");
    });
  });
}

$("#form-pedido-exame").addEventListener("submit", async (e) => {
  e.preventDefault();

  const marcados = Array.from($all('#checklist-exames input:checked')).map(el => el.value);
  const outros = $("#pedido-outros").value.split(",").map(s => s.trim()).filter(Boolean);
  const nomes = [...marcados, ...outros];

  if (nomes.length === 0) {
    toast("Marque pelo menos um exame ou preencha o campo 'Outros'.", true);
    return;
  }

  const data = $("#pedido-data").value || hoje();

  const { data: novoPedido, error: erroPedido } = await sb.from("pedidos_exame")
    .insert({ aluna_id: state.alunaAtual.id, data })
    .select().single();
  if (erroPedido) { toast("Erro ao registrar pedido: " + erroPedido.message, true); return; }

  const itens = nomes.map(nome => ({ pedido_id: novoPedido.id, nome_exame: nome }));
  const { error: erroItens } = await sb.from("itens_pedido_exame").insert(itens);
  if (erroItens) { toast("Erro ao registrar exames do pedido: " + erroItens.message, true); return; }

  $("#form-pedido-exame").reset();
  $("#pedido-data").value = hoje();
  toast(`Pedido registrado com ${nomes.length} exame(s)!`);
  await carregarPedidosExame();
});

// ------------------------------------------------------------
// RECEITA (o que foi receitado: suplementos, orientações)
// ------------------------------------------------------------
async function carregarReceitas() {
  const { data, error } = await sb.from("receitas")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar receitas: " + error.message, true); return; }
  renderReceitas(data || []);
}

function renderReceitas(receitas) {
  const lista = $("#lista-receitas");
  if (receitas.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhuma receita registrada ainda.</p>`;
    return;
  }
  lista.innerHTML = receitas.map(r => `
    <div class="linha-exame">
      <div>
        <strong>${r.item}</strong>
        <span class="acoes-linha">
          <button class="btn-icone editar-receita" data-id="${r.id}" title="Editar">✏️</button>
          <button class="btn-icone excluir excluir-receita" data-id="${r.id}" title="Excluir">🗑️</button>
        </span>
      </div>
      <div class="linha-exame-meta">
        ${fmtData(r.data)}${r.observacao ? " · " + r.observacao : ""}
      </div>
    </div>
  `).join("");

  $all(".editar-receita").forEach(btn => btn.addEventListener("click", () => editarReceita(btn.dataset.id, receitas)));
  $all(".excluir-receita").forEach(btn => btn.addEventListener("click", () => excluirReceita(btn.dataset.id)));
}

async function editarReceita(id, receitas) {
  const r = receitas.find(x => x.id === id);
  if (!r) return;
  const novoItem = prompt("O que foi receitado:", r.item);
  if (novoItem === null) return;
  const novaObs = prompt("Observação:", r.observacao || "");
  const { error } = await sb.from("receitas").update({
    item: novoItem.trim(),
    observacao: novaObs?.trim() || null,
  }).eq("id", id);
  if (error) { toast("Erro ao editar receita: " + error.message, true); return; }
  toast("Receita atualizada!");
  await carregarReceitas();
}

async function excluirReceita(id) {
  if (!confirm("Excluir essa receita?")) return;
  const { error } = await sb.from("receitas").delete().eq("id", id);
  if (error) { toast("Erro ao excluir: " + error.message, true); return; }
  toast("Receita excluída.");
  await carregarReceitas();
}

$("#form-receita").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    aluna_id: state.alunaAtual.id,
    item: $("#receita-item").value.trim(),
    data: $("#receita-data").value || hoje(),
    observacao: $("#receita-obs").value.trim() || null,
  };
  const { error } = await sb.from("receitas").insert(payload);
  if (error) { toast("Erro ao salvar receita: " + error.message, true); return; }
  $("#form-receita").reset();
  $("#receita-data").value = hoje();
  toast("Receita registrada!");
  await carregarReceitas();
});

// ------------------------------------------------------------
// ENTREGAS
// ------------------------------------------------------------
async function carregarEntregas() {
  const { data, error } = await sb.from("entregas")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data_entrega", { ascending: false });
  if (error) { toast("Erro ao carregar entregas: " + error.message, true); return; }
  renderEntregas(data || []);
}

function renderEntregas(entregas) {
  const lista = $("#lista-entregas");
  if (entregas.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhuma entrega registrada ainda.</p>`;
    return;
  }
  lista.innerHTML = entregas.map(en => `
    <div class="linha-entrega">
      <span>${fmtData(en.data_entrega)}</span>
      <strong>${en.item}</strong>
      <span class="obs">${en.observacao || ""}</span>
      <span class="acoes-linha">
        <button class="btn-icone editar-entrega" data-id="${en.id}" title="Editar">✏️</button>
        <button class="btn-icone excluir excluir-entrega" data-id="${en.id}" title="Excluir">🗑️</button>
      </span>
    </div>
  `).join("");

  $all(".editar-entrega").forEach(btn => btn.addEventListener("click", () => editarEntrega(btn.dataset.id, entregas)));
  $all(".excluir-entrega").forEach(btn => btn.addEventListener("click", () => excluirEntrega(btn.dataset.id)));
}

async function editarEntrega(id, entregas) {
  const en = entregas.find(x => x.id === id);
  if (!en) return;
  const novoItem = prompt("O que foi entregue:", en.item);
  if (novoItem === null) return;
  const novaObs = prompt("Observação:", en.observacao || "");
  const { error } = await sb.from("entregas").update({
    item: novoItem.trim(),
    observacao: novaObs?.trim() || null,
  }).eq("id", id);
  if (error) { toast("Erro ao editar entrega: " + error.message, true); return; }
  toast("Entrega atualizada!");
  await carregarEntregas();
}

async function excluirEntrega(id) {
  if (!confirm("Excluir essa entrega?")) return;
  const { error } = await sb.from("entregas").delete().eq("id", id);
  if (error) { toast("Erro ao excluir: " + error.message, true); return; }
  toast("Entrega excluída.");
  await carregarEntregas();
}

$("#form-entrega").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    aluna_id: state.alunaAtual.id,
    item: $("#entrega-item").value.trim(),
    data_entrega: $("#entrega-data").value || hoje(),
    observacao: $("#entrega-obs").value.trim() || null,
  };
  const { error } = await sb.from("entregas").insert(payload);
  if (error) { toast("Erro ao salvar entrega: " + error.message, true); return; }
  $("#form-entrega").reset();
  $("#entrega-data").value = hoje();
  toast("Entrega registrada!");
  await carregarEntregas();
});

// ------------------------------------------------------------
// CALENDÁRIO GERAL
// ------------------------------------------------------------
function corUrgencia(dataStr) {
  const hojeD = new Date();
  hojeD.setHours(0, 0, 0, 0);
  const d = new Date(dataStr + "T00:00:00");
  const dias = Math.round((d - hojeD) / (1000 * 60 * 60 * 24));
  if (dias < 0) return "passado";
  if (dias <= 5) return "vermelho";
  if (dias <= 15) return "amarelo";
  return "verde";
}

async function abrirCalendario() {
  if (state.calMes === undefined) {
    const agora = new Date();
    state.calMes = agora.getMonth();
    state.calAno = agora.getFullYear();
  }
  await carregarEventosDoMes();
}

$("#btn-mes-anterior").addEventListener("click", async () => {
  state.calMes--;
  if (state.calMes < 0) { state.calMes = 11; state.calAno--; }
  await carregarEventosDoMes();
});
$("#btn-mes-seguinte").addEventListener("click", async () => {
  state.calMes++;
  if (state.calMes > 11) { state.calMes = 0; state.calAno++; }
  await carregarEventosDoMes();
});

async function carregarEventosDoMes() {
  const inicioMes = `${state.calAno}-${String(state.calMes + 1).padStart(2, "0")}-01`;
  const fimMes = new Date(state.calAno, state.calMes + 1, 0).toISOString().slice(0, 10);

  const { data, error } = await sb.from("eventos_calendario")
    .select("*, turmas(nome)")
    .gte("data", inicioMes)
    .lte("data", fimMes)
    .order("data");
  if (error) { toast("Erro ao carregar eventos: " + error.message, true); return; }
  state.eventosMes = data || [];
  renderGradeCalendario();
  await carregarProximosEventos();
}

function renderGradeCalendario() {
  $("#calendario-titulo-mes").textContent = `${MESES_NOME[state.calMes]} ${state.calAno}`;
  const grade = $("#grade-calendario");
  const nomesDias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  let html = nomesDias.map(n => `<div class="dia-semana">${n}</div>`).join("");

  const primeiroDia = new Date(state.calAno, state.calMes, 1);
  const diaSemanaInicio = primeiroDia.getDay();
  const totalDias = new Date(state.calAno, state.calMes + 1, 0).getDate();
  const hojeStr = hoje();

  const eventosPorDia = {};
  (state.eventosMes || []).forEach(ev => {
    (eventosPorDia[ev.data] ||= []).push(ev);
  });

  for (let i = 0; i < diaSemanaInicio; i++) {
    html += `<div class="dia-calendario fora-do-mes"></div>`;
  }
  for (let dia = 1; dia <= totalDias; dia++) {
    const dataStr = `${state.calAno}-${String(state.calMes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const evs = eventosPorDia[dataStr] || [];
    const bolinhas = evs.map(ev => `<span class="bolinha ${corUrgencia(ev.data)}" title="${ev.titulo}"></span>`).join("");
    html += `
      <div class="dia-calendario ${dataStr === hojeStr ? "hoje" : ""}" data-data="${dataStr}">
        <div class="dia-numero">${dia}</div>
        <div class="dia-bolinhas">${bolinhas}</div>
      </div>
    `;
  }
  grade.innerHTML = html;

  $all(".dia-calendario[data-data]").forEach(el => {
    el.addEventListener("click", () => abrirFormEvento(null, el.dataset.data));
  });
}

async function carregarProximosEventos() {
  const { data, error } = await sb.from("eventos_calendario")
    .select("*, turmas(nome)")
    .gte("data", hoje())
    .order("data")
    .limit(30);
  if (error) { toast("Erro ao carregar próximos eventos: " + error.message, true); return; }
  renderListaEventos(data || []);
}

function renderListaEventos(eventos) {
  const lista = $("#lista-eventos");
  if (eventos.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum compromisso agendado.</p>`;
    return;
  }
  lista.innerHTML = eventos.map(ev => `
    <div class="linha-evento">
      <span class="bolinha ${corUrgencia(ev.data)}"></span>
      <div class="linha-evento-info">
        <div class="linha-evento-titulo">${ev.titulo}</div>
        <div class="linha-evento-meta">${fmtData(ev.data)}${ev.turmas ? " · " + ev.turmas.nome : ""}</div>
      </div>
      <span class="acoes-linha">
        <button class="btn-icone editar-evento" data-id="${ev.id}" title="Editar">✏️</button>
        <button class="btn-icone excluir excluir-evento" data-id="${ev.id}" title="Excluir">🗑️</button>
      </span>
    </div>
  `).join("");

  $all(".editar-evento").forEach(btn => btn.addEventListener("click", () => {
    const ev = eventos.find(e => e.id === btn.dataset.id);
    if (ev) abrirFormEvento(ev);
  }));
  $all(".excluir-evento").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Excluir esse evento?")) return;
    const { error } = await sb.from("eventos_calendario").delete().eq("id", btn.dataset.id);
    if (error) { toast("Erro ao excluir: " + error.message, true); return; }
    toast("Evento excluído.");
    await carregarEventosDoMes();
  }));
}

function renderTurmasSelectEvento() {
  const sel = $("#evento-turma");
  const atual = sel.value;
  sel.innerHTML = `<option value="">Sem turma vinculada</option>` +
    state.turmas.map(t => `<option value="${t.id}">${t.nome}</option>`).join("");
  if (atual) sel.value = atual;
}

function abrirFormEvento(evento, dataPreSelecionada) {
  $("#form-evento").reset();
  $("#evento-id").value = evento?.id || "";
  $("#modal-evento-titulo").textContent = evento ? "Editar evento" : "Novo evento";
  renderTurmasSelectEvento();

  if (evento) {
    $("#evento-titulo").value = evento.titulo || "";
    $("#evento-data").value = evento.data || "";
    $("#evento-turma").value = evento.turma_id || "";
  } else {
    $("#evento-data").value = dataPreSelecionada || hoje();
  }
  show($("#modal-evento"));
}

$("#btn-novo-evento").addEventListener("click", () => abrirFormEvento(null));
$("#btn-fechar-modal-evento").addEventListener("click", () => hide($("#modal-evento")));
$("#btn-cancelar-evento").addEventListener("click", () => hide($("#modal-evento")));

$("#form-evento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#evento-id").value;
  const payload = {
    titulo: $("#evento-titulo").value.trim(),
    data: $("#evento-data").value,
    turma_id: $("#evento-turma").value || null,
  };
  let error;
  if (id) {
    ({ error } = await sb.from("eventos_calendario").update(payload).eq("id", id));
  } else {
    ({ error } = await sb.from("eventos_calendario").insert(payload));
  }
  if (error) { toast("Erro ao salvar evento: " + error.message, true); return; }
  toast("Evento salvo!");
  hide($("#modal-evento"));
  await carregarEventosDoMes();
});

// ------------------------------------------------------------
// CLUBINHO DA MENOPAUSA
// ------------------------------------------------------------
function clubinhoNome(c) {
  return `Clubinho ${MESES_NOME[c.mes - 1]} ${c.ano}`;
}

async function carregarClubinhos() {
  const { data, error } = await sb.from("clubinho").select("*").order("ano").order("mes");
  if (error) { toast("Erro ao carregar Clubinho: " + error.message, true); return; }
  state.clubinhos = data || [];
  renderListaClubinhos();
  verificarAvisoClubinho();
}

function renderListaClubinhos() {
  const lista = $("#lista-clubinhos");
  const agora = new Date();
  const futurosEAtual = state.clubinhos.filter(c =>
    c.ano > agora.getFullYear() || (c.ano === agora.getFullYear() && c.mes >= agora.getMonth() + 1)
  );

  if (futurosEAtual.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum Clubinho cadastrado ainda.</p>`;
    return;
  }
  lista.innerHTML = futurosEAtual.map(c => {
    const cor = c.data ? corUrgencia(c.data) : null;
    return `
      <div class="item-turma" data-id="${c.id}">
        <div class="item-turma-nome">${clubinhoNome(c)} ${cor ? `<span class="bolinha ${cor} item-clubinho-badge"></span>` : ""}</div>
        <div class="item-turma-periodo">${c.tema || "Tema não definido"}${c.data ? " · " + fmtData(c.data) : ""}</div>
      </div>
    `;
  }).join("");

  $all("#lista-clubinhos .item-turma").forEach(el => {
    el.addEventListener("click", () => abrirClubinho(state.clubinhos.find(c => c.id === el.dataset.id)));
  });
}

function abrirClubinho(c) {
  if (!c) return;
  state.clubinhoAberto = c;
  hide($("#clubinho-vazio"));
  show($("#clubinho-detalhe"));
  $("#clubinho-titulo-mes").textContent = clubinhoNome(c);
  $("#clubinho-data").textContent = c.data ? fmtData(c.data) : "Não definida";
  $("#clubinho-tema").textContent = c.tema || "Não definido";
  $("#clubinho-convidado").textContent = c.convidado || "-";
}

$("#btn-novo-clubinho").addEventListener("click", () => abrirFormClubinho(null));
$("#btn-editar-clubinho").addEventListener("click", () => abrirFormClubinho(state.clubinhoAberto));

function abrirFormClubinho(c) {
  $("#form-clubinho").reset();
  $("#clubinho-id").value = c?.id || "";
  $("#modal-clubinho-titulo").textContent = c ? "Editar Clubinho" : "Novo Clubinho";

  if (c) {
    $("#clubinho-mes-ref").value = `${c.ano}-${String(c.mes).padStart(2, "0")}`;
    $("#clubinho-data-input").value = c.data || "";
    $("#clubinho-tema-input").value = c.tema || "";
    $("#clubinho-convidado-input").value = c.convidado || "";
  } else {
    const agora = new Date();
    $("#clubinho-mes-ref").value = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  }
  show($("#modal-clubinho"));
}

$("#btn-fechar-modal-clubinho").addEventListener("click", () => hide($("#modal-clubinho")));
$("#btn-cancelar-clubinho").addEventListener("click", () => hide($("#modal-clubinho")));

$("#form-clubinho").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#clubinho-id").value;
  const [anoStr, mesStr] = $("#clubinho-mes-ref").value.split("-");

  const payload = {
    ano: parseInt(anoStr, 10),
    mes: parseInt(mesStr, 10),
    data: $("#clubinho-data-input").value || null,
    tema: $("#clubinho-tema-input").value.trim() || null,
    convidado: $("#clubinho-convidado-input").value.trim() || null,
  };

  let error;
  if (id) {
    ({ error } = await sb.from("clubinho").update(payload).eq("id", id));
  } else {
    ({ error } = await sb.from("clubinho").insert(payload));
  }
  if (error) { toast("Erro ao salvar Clubinho: " + error.message, true); return; }
  toast("Clubinho salvo!");
  hide($("#modal-clubinho"));
  await carregarClubinhos();
  if (id && state.clubinhoAberto?.id === id) {
    abrirClubinho(state.clubinhos.find(c => c.id === id));
  }
});

$("#btn-excluir-clubinho").addEventListener("click", async () => {
  if (!state.clubinhoAberto) return;
  if (!confirm(`Excluir o ${clubinhoNome(state.clubinhoAberto)}?`)) return;
  const { error } = await sb.from("clubinho").delete().eq("id", state.clubinhoAberto.id);
  if (error) { toast("Erro ao excluir: " + error.message, true); return; }
  toast("Clubinho excluído.");
  state.clubinhoAberto = null;
  hide($("#clubinho-detalhe"));
  show($("#clubinho-vazio"));
  await carregarClubinhos();
});

$("#btn-historico-clubinho").addEventListener("click", () => {
  const agora = new Date();
  const passados = state.clubinhos.filter(c =>
    c.ano < agora.getFullYear() || (c.ano === agora.getFullYear() && c.mes < agora.getMonth() + 1)
  );
  const lista = $("#lista-historico-clubinho");
  if (passados.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum Clubinho passado registrado ainda.</p>`;
  } else {
    lista.innerHTML = passados.slice().reverse().map(c => `
      <div class="item-turma">
        <div class="item-turma-nome">${clubinhoNome(c)}</div>
        <div class="item-turma-periodo">${c.tema || "Tema não definido"}${c.convidado ? " · " + c.convidado : ""}${c.data ? " · " + fmtData(c.data) : ""}</div>
      </div>
    `).join("");
  }
  show($("#modal-historico-clubinho"));
});
$("#btn-fechar-historico-clubinho").addEventListener("click", () => hide($("#modal-historico-clubinho")));

function verificarAvisoClubinho() {
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  const ultimoDiaMes = new Date(anoAtual, mesAtual, 0).getDate();
  const diasRestantesMes = ultimoDiaMes - agora.getDate();

  const jaTemEsteMes = state.clubinhos.some(c => c.ano === anoAtual && c.mes === mesAtual);

  if (!jaTemEsteMes && diasRestantesMes <= 10) {
    toast(`⚠️ Faltam ${diasRestantesMes} dia(s) pro fim do mês e o Clubinho de ${MESES_NOME[mesAtual - 1]} ainda não foi cadastrado!`, true);
  }
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
initAuth();
