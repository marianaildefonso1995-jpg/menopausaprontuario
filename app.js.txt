// ============================================================
// Menopausa Sem Sofrimentos — Prontuário de Alunas
// Lógica principal do app (Fase 1)
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = {
  user: null,
  turmas: [],
  alunas: [],
  turmaFiltro: "todas",
  busca: "",
  alunaAtual: null, // objeto aluna selecionada
  ultimasPesagens: {}, // aluna_id -> data do último peso registrado
};

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Retorna null se está tudo em dia, ou {tipo: 'hoje'|'atrasada', texto} se precisa de lembrete
function statusPesagem(diaPesagemNome, ultimaData) {
  if (!diaPesagemNome) return null;
  const diaIndex = DIAS_SEMANA.indexOf(diaPesagemNome);
  if (diaIndex === -1) return null;

  const agora = new Date();
  const hojeIndex = agora.getDay();
  const diasDesdeUltimaOcorrencia = (hojeIndex - diaIndex + 7) % 7;
  const dataEsperada = new Date(agora);
  dataEsperada.setDate(agora.getDate() - diasDesdeUltimaOcorrencia);
  const dataEsperadaStr = dataEsperada.toISOString().slice(0, 10);

  const emDia = ultimaData && ultimaData >= dataEsperadaStr;
  if (emDia) return null;

  if (hojeIndex === diaIndex) {
    return { tipo: "hoje", texto: "Pesagem é hoje" };
  }
  return { tipo: "atrasada", texto: `Pesagem atrasada (dia: ${diaPesagemNome})` };
}

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

// Calcula o acesso da aluna com base nas regras da TURMA dela (vitalício ou X anos,
// contando a partir da data de início de acesso da turma).
function acessoInfo(turma) {
  if (!turma || turma.tipo_acesso === "vitalicio" || !turma.duracao_anos) {
    return { vitalicio: true, texto: "Acesso vitalício", atrasado: false, dataExpiracao: null };
  }
  const meses = Math.round(parseFloat(turma.duracao_anos) * 12);
  const dataExpiracao = addMeses(turma.data_inicio_acesso, meses);
  const agora = new Date();
  const diffMs = dataExpiracao - agora;
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDias < 0) {
    return { vitalicio: false, texto: `Acesso encerrado há ${Math.abs(diffDias)} dia(s)`, atrasado: true, dataExpiracao };
  }
  const dMeses = Math.floor(diffDias / 30);
  const dDias = diffDias % 30;
  let texto = "";
  if (dMeses > 0) texto += `${dMeses} mês(es) `;
  texto += `${dDias} dia(s) restante(s) de acesso`;
  return { vitalicio: false, texto, atrasado: false, dataExpiracao };
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
  await carregarAlunas();
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
  renderTurmasFiltro();
  renderTurmasSelectAluna();
}

function turmaPorId(id) {
  return state.turmas.find(t => t.id === id) || null;
}

function renderTurmasFiltro() {
  const sel = $("#filtro-turma");
  sel.innerHTML = `<option value="todas">Todas as turmas</option>` +
    state.turmas.map(t => `<option value="${t.id}">${t.nome}</option>`).join("");
}

function renderTurmasSelectAluna() {
  const sel = $("#aluna-turma");
  sel.innerHTML = `<option value="">Sem turma</option>` +
    state.turmas.map(t => `<option value="${t.id}">${t.nome}</option>`).join("");
}

$("#btn-nova-turma").addEventListener("click", () => abrirFormTurma(null));

$("#btn-editar-turma").addEventListener("click", () => {
  if (state.turmaFiltro === "todas") { toast("Selecione uma turma específica no filtro pra editar.", true); return; }
  const turma = turmaPorId(state.turmaFiltro);
  if (!turma) return;
  abrirFormTurma(turma);
});

function abrirFormTurma(turma) {
  $("#form-turma").reset();
  $("#turma-id").value = turma?.id || "";
  $("#modal-turma-titulo").textContent = turma ? "Editar turma" : "Nova turma";

  if (turma) {
    $("#turma-nome").value = turma.nome || "";
    $("#turma-tipo-acesso").value = turma.tipo_acesso || "vitalicio";
    $("#turma-duracao-anos").value = turma.duracao_anos ?? "";
    $("#turma-data-inicio").value = turma.data_inicio_acesso || hoje();
  } else {
    $("#turma-tipo-acesso").value = "vitalicio";
    $("#turma-data-inicio").value = hoje();
  }
  atualizarVisibilidadeDuracaoAnos();
  show($("#modal-turma"));
}

function atualizarVisibilidadeDuracaoAnos() {
  const ehPorTempo = $("#turma-tipo-acesso").value === "tempo";
  $("#campo-duracao-anos").classList.toggle("hidden", !ehPorTempo);
}
$("#turma-tipo-acesso").addEventListener("change", atualizarVisibilidadeDuracaoAnos);

$("#btn-fechar-modal-turma").addEventListener("click", () => hide($("#modal-turma")));
$("#btn-cancelar-turma").addEventListener("click", () => hide($("#modal-turma")));

$("#form-turma").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#turma-id").value;
  const tipoAcesso = $("#turma-tipo-acesso").value;

  const payload = {
    nome: $("#turma-nome").value.trim(),
    tipo_acesso: tipoAcesso,
    duracao_anos: tipoAcesso === "tempo" && $("#turma-duracao-anos").value
      ? parseFloat($("#turma-duracao-anos").value)
      : null,
    data_inicio_acesso: $("#turma-data-inicio").value || hoje(),
  };

  let error;
  if (id) {
    ({ error } = await sb.from("turmas").update(payload).eq("id", id));
  } else {
    ({ error } = await sb.from("turmas").insert(payload));
  }

  if (error) { toast("Erro ao salvar turma: " + error.message, true); return; }
  toast("Turma salva com sucesso!");
  hide($("#modal-turma"));
  await carregarTurmas();
  await carregarAlunas();
});

$("#filtro-turma").addEventListener("change", (e) => {
  state.turmaFiltro = e.target.value;
  carregarAlunas();
});

// ------------------------------------------------------------
// LISTA DE ALUNAS
// ------------------------------------------------------------
$("#busca-aluna").addEventListener("input", (e) => {
  state.busca = e.target.value.toLowerCase();
  renderListaAlunas();
});

async function carregarAlunas() {
  let query = sb.from("alunas").select("*, turmas(nome, tipo_acesso, duracao_anos, data_inicio_acesso)").order("nome");
  if (state.turmaFiltro !== "todas") {
    query = query.eq("turma_id", state.turmaFiltro);
  }
  const { data, error } = await query;
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
  if (error) return; // não bloqueia a lista por causa disso
  (data || []).forEach(p => {
    if (!state.ultimasPesagens[p.aluna_id]) state.ultimasPesagens[p.aluna_id] = p.data;
  });
}

function renderListaAlunas() {
  const lista = $("#lista-alunas");
  const filtradas = state.alunas.filter(a =>
    a.nome.toLowerCase().includes(state.busca)
  );

  if (filtradas.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhuma aluna encontrada.</p>`;
    return;
  }

  lista.innerHTML = filtradas.map(a => {
    const acesso = acessoInfo(a.turmas);
    const badge = a.fase === "manutencao" ? '<span class="badge manutencao">Manutenção</span>' : "";
    const alerta = acesso.atrasado ? '<span class="badge atrasado">Acesso vencido</span>' : "";
    const pesagem = statusPesagem(a.dia_pesagem, state.ultimasPesagens[a.id]);
    const badgePesagem = pesagem
      ? `<span class="badge ${pesagem.tipo === 'hoje' ? 'pesagem-hoje' : 'pesagem-atrasada'}">⚖️ ${pesagem.texto}</span>`
      : "";
    return `
      <div class="item-aluna ${state.alunaAtual?.id === a.id ? 'ativo' : ''}" data-id="${a.id}">
        <div class="item-aluna-nome">${a.nome}</div>
        <div class="item-aluna-meta">${a.turmas?.nome || "sem turma"} · ${acesso.texto}</div>
        <div class="item-aluna-badges">${badge}${alerta}${badgePesagem}</div>
      </div>
    `;
  }).join("");

  $all(".item-aluna").forEach(el => {
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
    $("#aluna-dia-pesagem").value = aluna.dia_pesagem || "";
    $("#aluna-queixas").value = aluna.queixas_iniciais || "";
    $("#aluna-restricoes").value = aluna.restricoes || "";
  } else {
    $("#aluna-data-entrada").value = hoje();
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
    dia_pesagem: $("#aluna-dia-pesagem").value || null,
    queixas_iniciais: $("#aluna-queixas").value.trim() || null,
    restricoes: $("#aluna-restricoes").value.trim() || null,
  };

  let error;
  if (id) {
    ({ error } = await sb.from("alunas").update(payload).eq("id", id));
  } else {
    ({ error } = await sb.from("alunas").insert(payload));
  }

  if (error) { toast("Erro ao salvar aluna: " + error.message, true); return; }

  toast("Aluna salva com sucesso!");
  hide($("#modal-aluna"));
  await carregarAlunas();
  if (id) await abrirAluna(id);
});

// ------------------------------------------------------------
// FICHA DA ALUNA (detalhe)
// ------------------------------------------------------------
async function abrirAluna(id) {
  const { data, error } = await sb.from("alunas").select("*, turmas(nome, tipo_acesso, duracao_anos, data_inicio_acesso)").eq("id", id).single();
  if (error) { toast("Erro ao abrir aluna: " + error.message, true); return; }
  state.alunaAtual = data;
  renderListaAlunas();
  renderFichaAluna();
  await Promise.all([carregarPesos(), carregarExames(), carregarEntregas()]);
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
  $("#ficha-saida-prevista").textContent = acesso.vitalicio ? "Vitalício" : acesso.dataExpiracao.toLocaleDateString("pt-BR");
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
  const pesagem = statusPesagem(a.dia_pesagem, ultimaData);
  if (pesagem) {
    alertaPesagem.textContent = pesagem.tipo === "hoje"
      ? `⚖️ Hoje é dia de pesagem de ${a.nome}. Lembre ela de te enviar o peso!`
      : `⚖️ A pesagem de ${a.nome} está atrasada (dia fixo: ${a.dia_pesagem}).`;
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
// EXAMES (com cota de 4/ano e upload de anexo)
// ------------------------------------------------------------
async function carregarExames() {
  const { data, error } = await sb.from("exames")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar exames: " + error.message, true); return; }
  renderExames(data || []);
}

function anoDoPrograma(dataEntrada, dataExame) {
  const entrada = new Date(dataEntrada + "T00:00:00");
  const exame = new Date(dataExame + "T00:00:00");
  let anos = exame.getFullYear() - entrada.getFullYear();
  const aniversarioEsteAno = new Date(exame.getFullYear(), entrada.getMonth(), entrada.getDate());
  if (exame < aniversarioEsteAno) anos -= 1;
  return anos + 1; // "1º ano de programa", "2º ano", etc.
}

function renderExames(exames) {
  const lista = $("#lista-exames");
  const a = state.alunaAtual;

  // Conta quantos "pedidos" foram feitos no ano de programa atual
  const anoAtual = anoDoPrograma(a.data_entrada, hoje());
  const pedidosAnoAtual = exames.filter(ex =>
    ex.tipo === "pedido" && anoDoPrograma(a.data_entrada, ex.data) === anoAtual
  ).length;

  $("#cota-exames").textContent = `${pedidosAnoAtual} de 4 pedidos usados no ${anoAtual}º ano de programa`;
  $("#cota-exames").className = "cota" + (pedidosAnoAtual >= 4 ? " estourada" : "");

  if (exames.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum exame registrado ainda.</p>`;
    return;
  }

  lista.innerHTML = exames.map(ex => `
    <div class="linha-exame">
      <div>
        <strong>${ex.nome_exame}</strong>
        <span class="tag-tipo">${ex.tipo}</span>
        <span class="tag-status status-${ex.status}">${ex.status}</span>
      </div>
      <div class="linha-exame-meta">
        ${fmtData(ex.data)} · ${anoDoPrograma(a.data_entrada, ex.data)}º ano de programa
        ${ex.observacao ? " · " + ex.observacao : ""}
      </div>
      ${ex.arquivo_url ? `<a href="${ex.arquivo_url}" target="_blank" class="link-anexo">📎 Ver anexo</a>` : ""}
    </div>
  `).join("");
}

$("#form-exame").addEventListener("submit", async (e) => {
  e.preventDefault();
  const arquivoInput = $("#exame-arquivo");
  let arquivo_url = null;

  if (arquivoInput.files.length > 0) {
    const file = arquivoInput.files[0];
    const caminho = `${state.alunaAtual.id}/${Date.now()}_${file.name}`;
    const { error: erroUpload } = await sb.storage.from("anexos").upload(caminho, file);
    if (erroUpload) { toast("Erro ao enviar arquivo: " + erroUpload.message, true); return; }
    const { data: urlData } = await sb.storage.from("anexos").createSignedUrl(caminho, 60 * 60 * 24 * 365);
    arquivo_url = urlData?.signedUrl || null;
  }

  const payload = {
    aluna_id: state.alunaAtual.id,
    tipo: $("#exame-tipo").value,
    nome_exame: $("#exame-nome").value.trim(),
    data: $("#exame-data").value || hoje(),
    status: $("#exame-status").value,
    observacao: $("#exame-obs").value.trim() || null,
    arquivo_url,
  };

  const { error } = await sb.from("exames").insert(payload);
  if (error) { toast("Erro ao salvar exame: " + error.message, true); return; }
  $("#form-exame").reset();
  toast("Exame registrado!");
  await carregarExames();
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
