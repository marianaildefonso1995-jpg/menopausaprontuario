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

let state = {
  user: null,
  turmas: [],
  turmaAberta: null,      // turma cujo painel de alunas está aberto na sidebar
  alunas: [],              // alunas da turma aberta
  alunaAtual: null,        // aluna selecionada (ficha aberta)
  ultimasPesagens: {},     // aluna_id -> data do último peso registrado
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
  mostrarPainelTurmas();
}

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
  await Promise.all([carregarPesos(), carregarPedidosExame(), carregarResultadosExame(), carregarReceitas(), carregarEntregas()]);
  show($("#ficha-aluna"));
  hide($("#ficha-vazia"));
  mudarAba("dados");
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

// Subabas dentro de Exames
function mudarSubaba(nome) {
  $all(".subaba-conteudo").forEach(el => hide(el));
  $all(".subaba-botao").forEach(el => el.classList.remove("ativo"));
  show($(`#subaba-${nome}`));
  $(`.subaba-botao[data-subaba="${nome}"]`).classList.add("ativo");
}
$all(".subaba-botao").forEach(btn => {
  btn.addEventListener("click", () => mudarSubaba(btn.dataset.subaba));
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
      </div>
    `).join("");

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
  toast("Peso registrado!");
  await carregarPesos();
});

// ------------------------------------------------------------
// EXAMES — PEDIDOS (checklist + cota de 4/ano)
// ------------------------------------------------------------
function renderChecklistExames() {
  const container = $("#checklist-exames");
  container.innerHTML = EXAMES_PADRAO.map((nome, i) => `
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

async function carregarPedidosExame() {
  const { data, error } = await sb.from("pedidos_exame")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar pedidos de exame: " + error.message, true); return; }
  renderPedidosExame(data || []);
}

function renderPedidosExame(pedidos) {
  const lista = $("#lista-pedidos");
  const a = state.alunaAtual;

  const anoAtual = anoDoPrograma(a.data_entrada, hoje());
  const pedidosAnoAtual = pedidos.filter(p => anoDoPrograma(a.data_entrada, p.data) === anoAtual).length;

  $("#cota-exames").textContent = `${pedidosAnoAtual} de 4 pedidos usados no ${anoAtual}º ano de programa`;
  $("#cota-exames").className = "cota" + (pedidosAnoAtual >= 4 ? " estourada" : "");

  if (pedidos.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum pedido de exame registrado ainda.</p>`;
    return;
  }

  lista.innerHTML = pedidos.map(p => `
    <div class="linha-exame">
      <div>
        <strong>${p.nome_exame}</strong>
        <span class="tag-status status-enviado">${p.status}</span>
      </div>
      <div class="linha-exame-meta">
        ${fmtData(p.data)} · ${anoDoPrograma(a.data_entrada, p.data)}º ano de programa
        ${p.observacao ? " · " + p.observacao : ""}
      </div>
    </div>
  `).join("");
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
  const payload = nomes.map(nome => ({
    aluna_id: state.alunaAtual.id,
    nome_exame: nome,
    data,
    status: "enviado",
  }));

  const { error } = await sb.from("pedidos_exame").insert(payload);
  if (error) { toast("Erro ao registrar pedido(s): " + error.message, true); return; }

  $("#form-pedido-exame").reset();
  toast(`${nomes.length} pedido(s) de exame registrado(s)!`);
  await carregarPedidosExame();
});

// ------------------------------------------------------------
// EXAMES — RESULTADOS (com anexo)
// ------------------------------------------------------------
async function carregarResultadosExame() {
  const { data, error } = await sb.from("resultados_exame")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar resultados: " + error.message, true); return; }
  renderResultadosExame(data || []);
}

function renderResultadosExame(resultados) {
  const lista = $("#lista-resultados");
  if (resultados.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum resultado registrado ainda.</p>`;
    return;
  }
  lista.innerHTML = resultados.map(r => `
    <div class="linha-exame">
      <div><strong>${r.nome_exame || "Resultado de exame"}</strong></div>
      <div class="linha-exame-meta">
        ${fmtData(r.data)}${r.observacao ? " · " + r.observacao : ""}
      </div>
      ${r.arquivo_url ? `<a href="${r.arquivo_url}" target="_blank" class="link-anexo">📎 Ver anexo</a>` : ""}
    </div>
  `).join("");
}

$("#form-resultado").addEventListener("submit", async (e) => {
  e.preventDefault();
  const arquivoInput = $("#resultado-arquivo");
  let arquivo_url = null;

  if (arquivoInput.files.length > 0) {
    const file = arquivoInput.files[0];
    const caminho = `${state.alunaAtual.id}/resultados/${Date.now()}_${file.name}`;
    const { error: erroUpload } = await sb.storage.from("anexos").upload(caminho, file);
    if (erroUpload) { toast("Erro ao enviar arquivo: " + erroUpload.message, true); return; }
    const { data: urlData } = await sb.storage.from("anexos").createSignedUrl(caminho, 60 * 60 * 24 * 365);
    arquivo_url = urlData?.signedUrl || null;
  }

  const payload = {
    aluna_id: state.alunaAtual.id,
    nome_exame: $("#resultado-nome").value.trim() || null,
    data: $("#resultado-data").value || hoje(),
    observacao: $("#resultado-obs").value.trim() || null,
    arquivo_url,
  };

  const { error } = await sb.from("resultados_exame").insert(payload);
  if (error) { toast("Erro ao salvar resultado: " + error.message, true); return; }
  $("#form-resultado").reset();
  toast("Resultado registrado!");
  await carregarResultadosExame();
});

// ------------------------------------------------------------
// EXAMES — RECEITA (o que foi receitado: suplementos, orientações)
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
      <div><strong>${r.item}</strong></div>
      <div class="linha-exame-meta">
        ${fmtData(r.data)}${r.observacao ? " · " + r.observacao : ""}
      </div>
    </div>
  `).join("");
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
    </div>
  `).join("");
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
  toast("Entrega registrada!");
  await carregarEntregas();
});

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
initAuth();
