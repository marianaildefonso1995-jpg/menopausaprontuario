// ============================================================
// Menopausa Sem Sofrimentos — Prontuário de Alunas
// Lógica principal do app (Fase 1 + ajustes v2)
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const COTA_EXAMES_POR_ANO = 4;
const DIAS_AVISO_ACESSO_VENCENDO = 7;

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
  questionarioAtual: null,
  vgPainel: "pendencias",  // painel aberto na Visão Geral: pendencias | turmas | alunas
  vgTurmas: [],            // turmas ativas com contagem de alunas (pro painel da Visão Geral)
  vgAlunas: [],            // alunas ativas com os alertas de cada uma
  vgFiltroPendencia: "todas",
  vgBuscaAlunas: "",
  vgPendencias: [],
  mostrandoResolvidas: false,
  planosAluna: [],         // histórico de planos alimentares da aluna aberta
  planoCalculado: null,    // resultado do cálculo que está na tela agora
  segurancaPlano: null,    // alertas de medicação/condição encontrados
  ultimoPesoFicha: null,   // peso mais recente da aluna, pra preencher o plano
  alimentos: [],           // biblioteca de alimentos (tabela alimentos do Supabase)
  cardapio: {},            // escolhas de alimento por refeição/opção no plano atual
  cardapioAssinatura: "",  // metas que geraram o cardápio atual (pra refazer quando mudam)
  anexos: {},              // anexos da aluna aberta, agrupados por categoria:registro
  diaAberto: null,         // dia do calendário que está aberto embaixo da grade
  verEventosPassados: false, // lista lateral mostrando eventos que já aconteceram
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
    return { tipo: "hoje", texto: "Pesagem é hoje", ciclo: dataEsperadaStr };
  }
  return { tipo: "atrasada", texto: `Pesagem atrasada (era dia ${fmtData(dataEsperadaStr)})`, ciclo: dataEsperadaStr };
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
// quando a pessoa clica no link do e-mail de recuperação, o Supabase devolve ela
// pro site com "type=recovery" no endereço — é assim que sabemos que ela veio
// redefinir a senha, e não fazer login normal
function veioDoLinkDeRecuperacao() {
  return (window.location.hash || "").includes("type=recovery");
}

async function initAuth() {
  const recuperando = veioDoLinkDeRecuperacao();
  const { data: { session } } = await sb.auth.getSession();

  if (recuperando) {
    mostrarFormNovaSenha();
  } else if (session) {
    state.user = session.user;
    await entrarApp();
  } else {
    mostrarLogin();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      mostrarLogin();
    } else if (event === "PASSWORD_RECOVERY") {
      mostrarFormNovaSenha();
    }
  });
}

function mostrarLogin() {
  hide($("#app"));
  show($("#tela-login"));
  show($("#form-login"));
  hide($("#form-nova-senha"));
}

function mostrarFormNovaSenha() {
  hide($("#app"));
  show($("#tela-login"));
  hide($("#form-login"));
  show($("#form-nova-senha"));
}

// ---- Esqueci minha senha: manda o e-mail com o link de recuperação ----
$("#btn-esqueci-senha").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  const erro = $("#login-erro");
  const aviso = $("#login-aviso");
  hide(erro); hide(aviso);

  if (!email) {
    erro.textContent = "Escreva seu e-mail no campo acima e clique aqui de novo.";
    show(erro);
    $("#login-email").focus();
    return;
  }

  const btn = $("#btn-esqueci-senha");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  // o link do e-mail traz a pessoa de volta pra esta mesma página
  const voltarPara = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: voltarPara });

  btn.disabled = false;
  btn.textContent = "Esqueci minha senha";

  if (error) {
    erro.textContent = "Não consegui enviar o e-mail: " + error.message;
    show(erro);
    return;
  }

  aviso.textContent = `Enviamos um link para ${email}. Abra o e-mail e clique no link pra criar uma senha nova (confira o spam se não aparecer em alguns minutos).`;
  show(aviso);
});

// ---- Salvar a nova senha depois de voltar pelo link do e-mail ----
$("#form-nova-senha").addEventListener("submit", async (e) => {
  e.preventDefault();
  const senha = $("#nova-senha").value;
  const senha2 = $("#nova-senha-2").value;
  const erro = $("#nova-senha-erro");
  hide(erro);

  if (senha.length < 6) {
    erro.textContent = "A senha precisa ter pelo menos 6 caracteres.";
    show(erro);
    return;
  }
  if (senha !== senha2) {
    erro.textContent = "As duas senhas estão diferentes. Confira e tente de novo.";
    show(erro);
    return;
  }

  const { error } = await sb.auth.updateUser({ password: senha });
  if (error) {
    erro.textContent = "Não consegui salvar: " + error.message + " (se o link do e-mail já expirou, peça outro na tela de login).";
    show(erro);
    return;
  }

  // limpa o "type=recovery" do endereço pra não cair aqui de novo ao recarregar
  history.replaceState(null, "", window.location.pathname);
  toast("Senha alterada! Já pode entrar com ela.");

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await entrarApp();
  } else {
    mostrarLogin();
  }
});

async function entrarApp() {
  hide($("#tela-login"));
  show($("#app"));
  $("#user-email").textContent = state.user.email;
  await carregarTurmas();
  await abrirCalendario();   // painel direito do calendário fica sempre visível
  await carregarClubinhos();
  mudarSecao("visao-geral");
}

// ------------------------------------------------------------
// NAVEGAÇÃO PRINCIPAL: Turmas / Calendário / Clubinho
// ------------------------------------------------------------
function mudarSecao(secao) {
  state.secaoAtiva = secao;
  $all(".nav-botao").forEach(b => b.classList.toggle("ativo", b.dataset.secao === secao));

  hide($("#secao-clubinho"));
  hide($("#conteudo-clubinho"));
  hide($("#conteudo-visao-geral"));

  if (secao === "turmas") {
    hide($("#conteudo-visao-geral"));
    show($("#secao-turmas"));
    mostrarPainelTurmas();
  } else if (secao === "clubinho") {
    hide($("#secao-turmas"));
    hide($("#ficha-vazia"));
    hide($("#ficha-aluna"));
    show($("#secao-clubinho"));
    show($("#conteudo-clubinho"));
    if (state.clubinhoAberto) show($("#clubinho-detalhe")); else show($("#clubinho-vazio"));
    carregarClubinhos();
  } else if (secao === "visao-geral") {
    hide($("#secao-turmas"));
    hide($("#ficha-vazia"));
    hide($("#ficha-aluna"));
    show($("#conteudo-visao-geral"));
    carregarVisaoGeral();
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
  $("#importar-turma-nome").textContent = turma.nome;
  // o texto de ajuda do index dizia que TODAS as respostas iam pra turma aberta;
  // agora só as novas vão, então o aviso é corrigido aqui
  const ajudaImportar = $("#importar-turma-nome")?.closest(".ajuda-campo");
  if (ajudaImportar) {
    ajudaImportar.innerHTML = `Pode subir o arquivo completo do Forms. Só as respostas <strong>novas</strong> entram em
      <strong>${turma.nome}</strong> — quem já foi importada antes continua na turma dela. Quem bater telefone/e-mail
      com uma aluna cadastrada vincula automático.`;
  }
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

$("#btn-excluir-turma").addEventListener("click", async () => {
  if (!state.turmaAberta) return;
  const confirmar = confirm(`Tem certeza que quer excluir a turma "${state.turmaAberta.nome}"? As alunas dela NÃO são apagadas, só ficam sem turma vinculada (você pode mover elas pra outra turma depois). Essa ação não pode ser desfeita.`);
  if (!confirmar) return;

  const { error } = await sb.from("turmas").delete().eq("id", state.turmaAberta.id);
  if (error) { toast("Erro ao excluir turma: " + error.message, true); return; }

  toast("Turma excluída.");
  await carregarTurmas();
  mostrarPainelTurmas();
});

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
// a busca fica no topo do app e funciona de qualquer seção (Visão Geral, Turmas, Clubinho)
let timeoutBusca = null;
$("#busca-global").addEventListener("input", (e) => {
  clearTimeout(timeoutBusca);
  const termo = e.target.value.trim();
  if (!termo) { hide($("#resultado-busca-global")); return; }
  timeoutBusca = setTimeout(() => buscarAlunasGlobal(termo), 250);
});

// clicar fora fecha a lista de resultados
document.addEventListener("click", (e) => {
  if (!e.target.closest(".topo-busca")) hide($("#resultado-busca-global"));
});

async function buscarAlunasGlobal(termo) {
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
      <div class="item-aluna-meta">${a.turmas?.nome || "sem turma"} · ${a.status}</div>
    </div>
  `).join("");

  $all("#resultado-busca-global .item-aluna").forEach(el => {
    el.addEventListener("click", async () => {
      hide(resultado);
      $("#busca-global").value = "";
      await irParaAluna(el.dataset.id);
    });
  });
}

// abre o prontuário de uma aluna vindo de qualquer lugar do app
async function irParaAluna(alunaId) {
  const { data: aluna } = await sb.from("alunas").select("*, turmas(*)").eq("id", alunaId).single();
  mudarSecao("turmas");
  // usa a turma já carregada em memória (linha completa); o join é só o plano B
  const turma = turmaPorId(aluna?.turma_id) || aluna?.turmas;
  if (turma) await abrirPainelTurma(turma);
  await abrirAluna(alunaId);
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
    const pesagem = a.fase === "manutencao" ? null : statusPesagemTurma(a.turmas, state.ultimasPesagens[a.id]);
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
    $("#aluna-altura").value = aluna.altura ?? "";
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
    altura: alturaEmMetros($("#aluna-altura").value),
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
  await carregarAnexos();
  await Promise.all([carregarPesos(), carregarPedidosExame(), carregarReceitas(), carregarEntregas(), carregarQuestionario(id), carregarPlanos(), carregarAlimentos()]);
  preencherFormularioPlano();
  show($("#ficha-aluna"));
  hide($("#ficha-vazia"));
  mudarAba("dados");

  // datas dos formulários já vêm preenchidas com hoje, pra não precisar ficar selecionando
  $("#peso-data").value = hoje();
  $("#pedido-data").value = hoje();
  $("#receita-data").value = hoje();
  $("#entrega-data").value = hoje();
}

// caminho clicável no topo da ficha: Turmas › Nome da turma › Nome da aluna
function renderCaminho() {
  const a = state.alunaAtual;
  if (!a) return;
  const cont = $("#ficha-caminho");
  cont.innerHTML = `
    <button class="caminho-link" data-ir="turmas">Turmas</button>
    <span class="caminho-sep">›</span>
    ${a.turmas ? `<button class="caminho-link" data-ir="turma">${a.turmas.nome}</button><span class="caminho-sep">›</span>` : ""}
    <span class="caminho-atual">${a.nome}</span>
  `;
  cont.querySelector('[data-ir="turmas"]')?.addEventListener("click", () => {
    mudarSecao("turmas");
    mostrarPainelTurmas();
  });
  cont.querySelector('[data-ir="turma"]')?.addEventListener("click", async () => {
    const turma = turmaPorId(a.turma_id);
    if (!turma) return;
    state.alunaAtual = null;
    hide($("#ficha-aluna"));
    show($("#ficha-vazia"));
    await abrirPainelTurma(turma);
  });
}

// resumo de progresso no topo da ficha: peso atual, quanto perdeu, quanto falta e próxima pesagem
function renderResumoProgresso(pesos) {
  const a = state.alunaAtual;
  const cont = $("#ficha-resumo");
  if (!a) return;

  const pesoAtual = pesos && pesos.length ? pesos[0].peso : null;
  const inicial = a.peso_inicial ?? (pesos && pesos.length ? pesos[pesos.length - 1].peso : null);
  const meta = a.meta_peso;

  if (pesoAtual == null && inicial == null) {
    cont.innerHTML = `<p class="resumo-vazio">Nenhum peso registrado ainda — registre a primeira pesagem na aba <strong>Peso</strong> pra acompanhar a evolução aqui.</p>`;
    return;
  }

  const variacao = (pesoAtual != null && inicial != null) ? Math.round((pesoAtual - inicial) * 10) / 10 : null;
  const perdeu = variacao != null ? Math.abs(variacao) : null;
  const ganhou = variacao != null && variacao > 0;

  // quanto falta e % do caminho até a meta
  let falta = null, percentual = null;
  if (pesoAtual != null && meta != null) {
    falta = Math.round(Math.abs(pesoAtual - meta) * 10) / 10;
    if (inicial != null && inicial !== meta) {
      const total = Math.abs(inicial - meta);
      const andado = Math.abs(inicial - pesoAtual);
      percentual = Math.max(0, Math.min(100, Math.round((andado / total) * 100)));
      // se andou pro lado errado, o progresso é zero
      if ((meta < inicial && pesoAtual > inicial) || (meta > inicial && pesoAtual < inicial)) percentual = 0;
    }
  }

  const atingiu = meta != null && pesoAtual != null &&
    (a.objetivo === "hipertrofia" ? pesoAtual >= meta : pesoAtual <= meta);

  const pesagem = a.fase === "manutencao" ? null : statusPesagemTurma(a.turmas, pesos?.[0]?.data || null);
  const proxima = a.fase === "manutencao"
    ? "Em manutenção — pesagens pausadas"
    : (pesagem ? pesagem.texto : "Pesagem em dia ✅");

  cont.innerHTML = `
    <div class="resumo-numeros">
      <div class="resumo-item">
        <span class="resumo-label">Peso atual</span>
        <span class="resumo-valor">${pesoAtual != null ? pesoAtual + " kg" : "-"}</span>
      </div>
      <div class="resumo-item">
        <span class="resumo-label">${ganhou ? "Ganhou" : "Já perdeu"}</span>
        <span class="resumo-valor ${ganhou ? "ruim" : "bom"}">${perdeu != null ? perdeu + " kg" : "-"}</span>
      </div>
      <div class="resumo-item">
        <span class="resumo-label">Meta</span>
        <span class="resumo-valor">${meta != null ? meta + " kg" : "não definida"}</span>
      </div>
      <div class="resumo-item">
        <span class="resumo-label">Falta</span>
        <span class="resumo-valor">${atingiu ? "🎯 atingiu!" : (falta != null ? falta + " kg" : "-")}</span>
      </div>
      <div class="resumo-item resumo-item-largo">
        <span class="resumo-label">Próxima pesagem</span>
        <span class="resumo-valor ${pesagem ? (pesagem.tipo === "hoje" ? "aviso" : "ruim") : "bom"}">${proxima}</span>
      </div>
    </div>
    ${percentual != null ? `
      <div class="barra-progresso" title="${percentual}% do caminho até a meta">
        <div class="barra-progresso-preenchida" style="width:${percentual}%"></div>
        <span class="barra-progresso-texto">${percentual}% do caminho até a meta</span>
      </div>` : ""}
  `;
}

function renderFichaAluna() {
  const a = state.alunaAtual;
  const acesso = acessoInfo(a.turmas);

  renderCaminho();
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
  $("#ficha-altura").textContent = a.altura ? `${a.altura} m` : "-";
  $("#ficha-queixas").textContent = a.queixas_iniciais || "Nenhuma queixa registrada.";
  $("#ficha-restricoes").textContent = a.restricoes || "Nenhuma restrição registrada.";
  $("#ficha-evolucao").textContent = a.evolucao || "Sem observações de evolução.";
  fecharEditorEvolucao();

  const alertaFase = $("#alerta-fase-manutencao");
  if (a.fase === "manutencao") {
    alertaFase.innerHTML = `✅ Esta aluna já está na Fase de Manutenção (objetivo: ${a.objetivo}). Os lembretes de pesagem ficam pausados enquanto ela estiver aqui.
      <button id="btn-voltar-programa" class="btn-mini">Voltar pro programa (retomar pesagens)</button>`;
    show(alertaFase);
    alertaFase.className = "alerta info";
    $("#btn-voltar-programa").addEventListener("click", voltarParaPrograma);
  } else {
    hide(alertaFase);
  }
}

$("#btn-editar-aluna").addEventListener("click", () => abrirFormAluna(state.alunaAtual));

// ============================================================
// ANEXOS — PDFs e imagens presos a uma receita, a um pedido de
// exame ou a um plano alimentar da aluna
// ============================================================

const BUCKET_ANEXOS = "anexos";
const ANEXO_TAMANHO_MAXIMO_MB = 20;
const ANEXO_EXTENSOES_OK = ["pdf", "jpg", "jpeg", "png", "webp", "heic"];

function fmtTamanho(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensaoDe(nome) {
  const partes = (nome || "").split(".");
  return partes.length > 1 ? partes.pop().toLowerCase() : "";
}

// tira acento, espaço e caractere esquisito do nome do arquivo, porque o
// Storage não aceita qualquer coisa no caminho
function nomeSeguroArquivo(nome) {
  return (nome || "arquivo")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-80);
}

function chaveAnexo(categoria, registroId) {
  return `${categoria}:${registroId || ""}`;
}

async function carregarAnexos() {
  state.anexos = {};
  if (!state.alunaAtual) return;
  const { data, error } = await sb.from("anexos")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("created_at", { ascending: true });
  if (error) {
    // não trava a ficha inteira se a tabela ainda não existir
    console.warn("Anexos indisponíveis:", error.message);
    return;
  }
  (data || []).forEach(anx => {
    const k = chaveAnexo(anx.categoria, anx.registro_id);
    (state.anexos[k] ||= []).push(anx);
  });
}

function anexosDe(categoria, registroId) {
  return state.anexos?.[chaveAnexo(categoria, registroId)] || [];
}

// bloco que vai dentro de cada receita / pedido / plano
function htmlAnexos(categoria, registroId) {
  const itens = anexosDe(categoria, registroId);
  const lista = itens.map(anx => `
    <span class="anexo-item">
      <button type="button" class="anexo-abrir" data-id="${anx.id}" title="Abrir ${anx.nome}">
        ${extensaoDe(anx.nome) === "pdf" ? "📄" : "🖼️"} ${anx.nome}
      </button>
      <span class="anexo-tamanho">${fmtTamanho(anx.tamanho)}</span>
      <button type="button" class="btn-icone excluir anexo-excluir" data-id="${anx.id}" title="Excluir anexo">🗑️</button>
    </span>`).join("");

  return `
    <div class="anexos" data-cat="${categoria}" data-reg="${registroId || ""}">
      <div class="anexos-lista">${lista}</div>
      <button type="button" class="btn-mini anexo-add" data-cat="${categoria}" data-reg="${registroId || ""}">
        📎 Anexar arquivo
      </button>
    </div>`;
}

// redesenha só os bloquinhos de anexo que já estão na tela,
// sem precisar refazer a lista inteira
function atualizarBlocosAnexos() {
  Array.from(document.querySelectorAll(".anexos")).forEach(div => {
    const novo = htmlAnexos(div.dataset.cat, div.dataset.reg || null);
    const temp = document.createElement("div");
    temp.innerHTML = novo.trim();
    div.innerHTML = temp.firstElementChild.innerHTML;
  });
}

// Um campo de arquivo NOVO a cada anexo. Reaproveitar o mesmo campo faz o
// navegador parar de avisar quando um segundo arquivo é escolhido — e aí o
// anexo falhava calado.
function pedirArquivo(categoria, registroId) {
  const antigo = $("#input-anexo");
  if (antigo) antigo.remove();

  const input = document.createElement("input");
  input.type = "file";
  input.id = "input-anexo";
  input.className = "hidden";
  input.accept = ".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*";
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const arquivo = input.files?.[0];
    input.remove();
    if (!arquivo) return;
    await enviarAnexo(arquivo, categoria, registroId);
  });

  input.click();
}

async function enviarAnexo(arquivo, categoria, registroId) {
  const a = state.alunaAtual;
  if (!a) { toast("Abra uma aluna antes de anexar.", true); return; }

  const ext = extensaoDe(arquivo.name);
  if (!ANEXO_EXTENSOES_OK.includes(ext)) {
    toast(`Só dá pra anexar PDF ou imagem (${ANEXO_EXTENSOES_OK.join(", ")}). Esse é .${ext || "sem extensão"}.`, true);
    return;
  }
  if (arquivo.size > ANEXO_TAMANHO_MAXIMO_MB * 1024 * 1024) {
    toast(`Arquivo muito grande (${fmtTamanho(arquivo.size)}). O limite é ${ANEXO_TAMANHO_MAXIMO_MB} MB.`, true);
    return;
  }

  toast("Enviando arquivo...");
  const caminho = `${a.id}/${categoria}/${Date.now()}-${nomeSeguroArquivo(arquivo.name)}`;

  const { error: erroUpload } = await sb.storage
    .from(BUCKET_ANEXOS)
    .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined });
  if (erroUpload) { toast("Erro ao enviar o arquivo: " + erroUpload.message, true); return; }

  const { error: erroBanco } = await sb.from("anexos").insert({
    aluna_id: a.id,
    categoria,
    registro_id: registroId || null,
    nome: arquivo.name,
    caminho,
    tamanho: arquivo.size,
    tipo: arquivo.type || null,
  });
  if (erroBanco) {
    // não deixa arquivo órfão no Storage se o registro falhar
    await sb.storage.from(BUCKET_ANEXOS).remove([caminho]);
    toast("Erro ao registrar o anexo: " + erroBanco.message, true);
    return;
  }

  toast("Arquivo anexado.");
  await carregarAnexos();
  atualizarBlocosAnexos();
}

function acharAnexo(id) {
  for (const lista of Object.values(state.anexos || {})) {
    const achado = lista.find(x => x.id === id);
    if (achado) return achado;
  }
  return null;
}

async function abrirAnexo(id) {
  const anx = acharAnexo(id);
  if (!anx) return;
  const { data, error } = await sb.storage
    .from(BUCKET_ANEXOS)
    .createSignedUrl(anx.caminho, 60 * 10);
  if (error) { toast("Erro ao abrir o arquivo: " + error.message, true); return; }
  const janela = window.open(data.signedUrl, "_blank");
  if (!janela) toast("O navegador bloqueou a janela. Libere os pop-ups deste site.", true);
}

async function excluirAnexo(id) {
  const anx = acharAnexo(id);
  if (!anx) return;
  if (!confirm(`Excluir o arquivo "${anx.nome}"? Isso não dá pra desfazer.`)) return;

  const { error: erroStorage } = await sb.storage.from(BUCKET_ANEXOS).remove([anx.caminho]);
  if (erroStorage) { toast("Erro ao excluir o arquivo: " + erroStorage.message, true); return; }

  const { error } = await sb.from("anexos").delete().eq("id", id);
  if (error) { toast("Erro ao excluir o registro: " + error.message, true); return; }

  toast("Anexo excluído.");
  await carregarAnexos();
  atualizarBlocosAnexos();
}

// um listener só pro app inteiro — assim funciona mesmo depois das listas
// serem redesenhadas
document.addEventListener("click", (e) => {
  const btnAdd = e.target.closest(".anexo-add");
  if (btnAdd) {
    e.preventDefault();
    e.stopPropagation();
    pedirArquivo(btnAdd.dataset.cat, btnAdd.dataset.reg || null);
    return;
  }
  const btnAbrir = e.target.closest(".anexo-abrir");
  if (btnAbrir) {
    e.preventDefault();
    e.stopPropagation();
    abrirAnexo(btnAbrir.dataset.id);
    return;
  }
  const btnExcluir = e.target.closest(".anexo-excluir");
  if (btnExcluir) {
    e.preventDefault();
    e.stopPropagation();
    excluirAnexo(btnExcluir.dataset.id);
  }
});

// ------------------------------------------------------------
// EVOLUÇÃO — editor de texto longo (aceita Enter pra pular linha)
// ------------------------------------------------------------

// Estilo do editor + exibição respeitando as quebras de linha.
// Fica aqui pra não precisar mexer no style.css.
(function estiloEvolucao() {
  const css = document.createElement("style");
  css.textContent = `
    #ficha-evolucao, #ficha-queixas, #ficha-restricoes { white-space: pre-wrap; }
    .editor-evolucao { margin-top: 8px; }
    .editor-evolucao textarea {
      width: 100%;
      box-sizing: border-box;
      min-height: 180px;
      resize: vertical;
      font: inherit;
      line-height: 1.5;
    }
    .editor-evolucao .acoes-linha {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }

    /* Calendário: dia clicado, eventos do dia e eventos que já passaram */
    .dia-calendario { cursor: pointer; }
    .dia-calendario.selecionado {
      outline: 2px solid #b5179e;
      outline-offset: -2px;
      border-radius: 6px;
    }
    /* a cinza original quase sumia no fundo branco */
    .dia-bolinhas .bolinha.passado {
      background: #8a8a93;
      opacity: 1;
    }
    .bloco-dia {
      margin: 10px 0 14px;
      padding: 10px 12px;
      border: 1px solid #e3e3e8;
      border-radius: 8px;
      background: #fafafa;
    }
    .bloco-dia-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .linha-evento-dia {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid #ececf1;
    }
    .linha-evento-dia.cor-passado .linha-evento-titulo { color: #6b6b73; }
    .linha-evento.cor-passado { opacity: .85; }
    #btn-eventos-passados { display: block; margin: 4px 0 8px; }

    /* Anexos (PDFs e imagens presos a receita / pedido / plano) */
    .anexos {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #e3e3e8;
      width: 100%;
    }
    .anexos-lista {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      align-items: center;
    }
    .anexo-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
    }
    .anexo-abrir {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      font-size: 13px;
      color: #b5179e;
      cursor: pointer;
      text-decoration: underline;
      text-align: left;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .anexo-tamanho { font-size: 11px; color: #7a7a83; }
    .linha-entrega .anexos, .linha-exame .anexos { flex-basis: 100%; }
  `;
  document.head.appendChild(css);
})();

function fecharEditorEvolucao() {
  const box = $("#editor-evolucao");
  if (box) box.remove();
  const p = $("#ficha-evolucao");
  if (p) show(p);
  const btn = $("#btn-editar-evolucao");
  if (btn) { show(btn); btn.textContent = "Atualizar"; }
}

function abrirEditorEvolucao() {
  if ($("#editor-evolucao")) return;          // já está aberto
  if (!state.alunaAtual) return;

  const p = $("#ficha-evolucao");
  const atual = state.alunaAtual.evolucao || "";

  const box = document.createElement("div");
  box.id = "editor-evolucao";
  box.className = "editor-evolucao";
  box.innerHTML = `
    <textarea id="evolucao-texto" rows="10"
      placeholder="Escreva livremente. Pode dar Enter pra pular de linha.&#10;&#10;Ex:&#10;12/09 - primeira pesagem, relatou menos inchaço&#10;22/09 - dormindo melhor, cortou refrigerante"></textarea>
    <p class="ajuda-campo">Enter pula linha normalmente. Nada é gravado até você clicar em <strong>Salvar evolução</strong>.</p>
    <div class="acoes-linha">
      <button type="button" id="btn-salvar-evolucao" class="btn-primario">Salvar evolução</button>
      <button type="button" id="btn-cancelar-evolucao" class="btn-secundario">Cancelar</button>
      <button type="button" id="btn-data-evolucao" class="btn-mini">+ Inserir data de hoje</button>
    </div>`;

  hide(p);
  p.insertAdjacentElement("afterend", box);

  const ta = $("#evolucao-texto");
  ta.value = atual;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const btn = $("#btn-editar-evolucao");
  if (btn) hide(btn);

  // Esc fecha o editor (mesmo efeito do Cancelar)
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); fecharEditorEvolucao(); }
  });

  $("#btn-data-evolucao").addEventListener("click", () => {
    const hoje = new Date().toLocaleDateString("pt-BR");
    const precisaQuebra = ta.value.length > 0 && !ta.value.endsWith("\n");
    ta.value += (precisaQuebra ? "\n" : "") + hoje + " - ";
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });

  $("#btn-cancelar-evolucao").addEventListener("click", () => {
    const mudou = ta.value !== atual;
    if (mudou && !confirm("Você mexeu no texto e ainda não salvou. Descartar as alterações?")) return;
    fecharEditorEvolucao();
  });

  $("#btn-salvar-evolucao").addEventListener("click", async () => {
    const botao = $("#btn-salvar-evolucao");
    const novo = ta.value.trim();
    botao.disabled = true;
    botao.textContent = "Salvando...";
    const { error } = await sb.from("alunas").update({ evolucao: novo }).eq("id", state.alunaAtual.id);
    if (error) {
      toast("Erro: " + error.message, true);
      botao.disabled = false;
      botao.textContent = "Salvar evolução";
      return;
    }
    toast("Evolução atualizada.");
    fecharEditorEvolucao();
    await abrirAluna(state.alunaAtual.id);
  });
}

$("#btn-editar-evolucao").addEventListener("click", abrirEditorEvolucao);

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

// gráfico de linha da evolução do peso, desenhado em SVG puro (sem biblioteca externa).
// recebe os pesos na ordem mais recente primeiro, igual vem do banco.
function renderGraficoPeso(pesos) {
  const cont = $("#grafico-peso");
  const a = state.alunaAtual;

  if (!pesos || pesos.length < 2) {
    cont.innerHTML = pesos && pesos.length === 1
      ? `<p class="grafico-vazio">Registre mais uma pesagem pra ver o gráfico da evolução.</p>`
      : "";
    return;
  }

  const pts = [...pesos].reverse(); // ordem cronológica pra desenhar da esquerda pra direita
  const meta = a.meta_peso;

  const L = 44, R = 14, T = 16, B = 30;      // margens
  const W = 620, H = 220;                     // área total
  const gw = W - L - R, gh = H - T - B;       // área do desenho

  const valores = pts.map(p => Number(p.peso));
  if (meta != null) valores.push(Number(meta));
  let min = Math.min(...valores), max = Math.max(...valores);
  if (min === max) { min -= 1; max += 1; }
  const folga = (max - min) * 0.15;
  min -= folga; max += folga;

  const x = (i) => L + (pts.length === 1 ? gw / 2 : (i / (pts.length - 1)) * gw);
  const y = (v) => T + gh - ((v - min) / (max - min)) * gh;

  const linha = pts.map((p, i) => `${x(i)},${y(Number(p.peso))}`).join(" ");
  const area = `${L},${T + gh} ${linha} ${x(pts.length - 1)},${T + gh}`;

  // 4 marcas no eixo vertical
  const marcas = [0, 1, 2, 3].map(k => {
    const v = min + ((max - min) * k) / 3;
    return `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="g-grade"/>
            <text x="${L - 8}" y="${y(v) + 4}" class="g-eixo" text-anchor="end">${v.toFixed(1)}</text>`;
  }).join("");

  const pontos = pts.map((p, i) => `
    <circle cx="${x(i)}" cy="${y(Number(p.peso))}" r="4" class="g-ponto">
      <title>${fmtData(p.data)} — ${p.peso} kg</title>
    </circle>`).join("");

  const primeiro = fmtData(pts[0].data);
  const ultimo = fmtData(pts[pts.length - 1].data);

  cont.innerHTML = `
    <h4 class="grafico-titulo">Evolução do peso</h4>
    <svg viewBox="0 0 ${W} ${H}" class="g-svg" role="img" aria-label="Gráfico da evolução do peso">
      ${marcas}
      <polygon points="${area}" class="g-area"/>
      ${meta != null && meta >= min && meta <= max ? `
        <line x1="${L}" y1="${y(meta)}" x2="${W - R}" y2="${y(meta)}" class="g-meta"/>
        <text x="${W - R}" y="${y(meta) - 6}" class="g-meta-texto" text-anchor="end">meta ${meta} kg</text>` : ""}
      <polyline points="${linha}" class="g-linha"/>
      ${pontos}
      <text x="${L}" y="${H - 8}" class="g-eixo">${primeiro}</text>
      <text x="${W - R}" y="${H - 8}" class="g-eixo" text-anchor="end">${ultimo}</text>
    </svg>
    <p class="grafico-legenda">Passe o mouse nos pontos pra ver a data e o peso de cada pesagem.</p>
  `;
}

function renderPesos(pesos) {
  const lista = $("#lista-pesos");
  const a = state.alunaAtual;

  state.ultimoPesoFicha = pesos && pesos.length ? pesos[0].peso : null;
  renderResumoProgresso(pesos);
  renderGraficoPeso(pesos);

  const alertaMeta = $("#alerta-meta-peso");
  hide(alertaMeta);

  const alertaPesagem = $("#alerta-pesagem");
  const ultimaData = pesos[0]?.data || null;
  const pesagem = a.fase === "manutencao" ? null : statusPesagemTurma(a.turmas, ultimaData);
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
  const peso = numeroDoTexto(novoPeso);
  if (peso == null) { toast("Não entendi esse peso. Escreva só o número, ex: 78,5", true); return; }

  // a data também é editável: a pesagem pode ter sido feita num dia e registrada em outro
  const novaData = prompt("Data da pesagem (dia/mês/ano):", fmtData(p.data));
  if (novaData === null) return;
  const dataISO = dataBRparaISO(novaData);
  if (!dataISO) { toast("Não entendi essa data. Escreva no formato dia/mês/ano, ex: 21/05/2026", true); return; }

  const novaObs = prompt("Observação:", p.observacao || "");
  if (novaObs === null) return;

  const { error } = await sb.from("pesos").update({
    peso,
    data: dataISO,
    observacao: novaObs.trim() || null,
  }).eq("id", id);
  if (error) { toast("Erro ao editar peso: " + error.message, true); return; }
  toast("Pesagem atualizada!");
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
  toast("Aluna movida para Fase de Manutenção! Os lembretes de pesagem dela ficam pausados.");
  await abrirAluna(state.alunaAtual.id);
}

async function voltarParaPrograma() {
  const { error } = await sb.from("alunas").update({ fase: "programa" }).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro: " + error.message, true); return; }
  toast("Aluna voltou pro programa — lembretes de pesagem retomados.");
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

  $("#cota-exames").textContent = `${pedidosAnoAtual} de ${COTA_EXAMES_POR_ANO} pedidos (levas) usados no ${anoAtual}º ano de programa`;
  $("#cota-exames").className = "cota" + (pedidosAnoAtual >= COTA_EXAMES_POR_ANO ? " estourada" : "");

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
          ${htmlAnexos("pedido_exame", p.id)}
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

  const a = state.alunaAtual;
  const anoAtual = anoDoPrograma(a.data_entrada, hoje());
  const { data: pedidosExistentes } = await sb.from("pedidos_exame").select("id, data").eq("aluna_id", a.id);
  const usadosNoAno = (pedidosExistentes || []).filter(p => anoDoPrograma(a.data_entrada, p.data) === anoAtual).length;
  if (usadosNoAno >= COTA_EXAMES_POR_ANO) {
    const confirmar = confirm(`${a.nome} já usou os ${COTA_EXAMES_POR_ANO} pedidos de exame da cota do ${anoAtual}º ano. Registrar mesmo assim, passando da cota?`);
    if (!confirmar) return;
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
      ${htmlAnexos("receita", r.id)}
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
  fecharDiaDoCalendario();
  await carregarEventosDoMes();
});
$("#btn-mes-seguinte").addEventListener("click", async () => {
  state.calMes++;
  if (state.calMes > 11) { state.calMes = 0; state.calAno++; }
  fecharDiaDoCalendario();
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
    el.addEventListener("click", () => abrirDiaDoCalendario(el.dataset.data));
  });

  // se tinha um dia aberto, mantém aberto depois de redesenhar a grade
  if (state.diaAberto) abrirDiaDoCalendario(state.diaAberto);
}

// ------------------------------------------------------------
// EVENTOS DE UM DIA — clicar num dia mostra o que tem nele,
// inclusive de datas que já passaram
// ------------------------------------------------------------
function blocoDoDia() {
  let div = $("#bloco-dia");
  if (!div) {
    div = document.createElement("div");
    div.id = "bloco-dia";
    div.className = "bloco-dia hidden";
    $("#grade-calendario").insertAdjacentElement("afterend", div);
  }
  return div;
}

function fecharDiaDoCalendario() {
  state.diaAberto = null;
  const div = $("#bloco-dia");
  if (div) { div.innerHTML = ""; hide(div); }
  $all(".dia-calendario.selecionado").forEach(el => el.classList.remove("selecionado"));
}

function abrirDiaDoCalendario(dataStr) {
  state.diaAberto = dataStr;

  $all(".dia-calendario.selecionado").forEach(el => el.classList.remove("selecionado"));
  const celula = $(`.dia-calendario[data-data="${dataStr}"]`);
  if (celula) celula.classList.add("selecionado");

  const evs = (state.eventosMes || []).filter(ev => ev.data === dataStr);
  const div = blocoDoDia();
  show(div);

  const corpo = evs.length === 0
    ? `<p class="vazio">Nenhum evento nesse dia.</p>`
    : evs.map(ev => `
        <div class="linha-evento-dia cor-${corUrgencia(ev.data)}">
          <div class="linha-evento-info">
            <div class="linha-evento-titulo">${ev.titulo}</div>
            <div class="linha-evento-meta">${ev.turmas ? ev.turmas.nome + " · " : ""}${textoContagem(ev.data)}</div>
          </div>
          <span class="acoes-linha">
            <button class="btn-icone editar-evento-dia" data-id="${ev.id}" title="Editar">✏️</button>
            <button class="btn-icone excluir excluir-evento-dia" data-id="${ev.id}" title="Excluir">🗑️</button>
          </span>
        </div>`).join("");

  div.innerHTML = `
    <div class="bloco-dia-header">
      <strong>${fmtData(dataStr)}</strong>
      <button type="button" class="btn-icone" id="btn-fechar-dia" title="Fechar">✕</button>
    </div>
    ${corpo}
    <button type="button" class="btn-mini" id="btn-novo-evento-dia">+ Novo evento nesse dia</button>
  `;

  $("#btn-fechar-dia").addEventListener("click", fecharDiaDoCalendario);
  $("#btn-novo-evento-dia").addEventListener("click", () => abrirFormEvento(null, dataStr));

  $all(".editar-evento-dia").forEach(btn => btn.addEventListener("click", () => {
    const ev = evs.find(e => e.id === btn.dataset.id);
    if (ev) abrirFormEvento(ev);
  }));
  $all(".excluir-evento-dia").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Excluir esse evento?")) return;
    const { error } = await sb.from("eventos_calendario").delete().eq("id", btn.dataset.id);
    if (error) { toast("Erro ao excluir: " + error.message, true); return; }
    toast("Evento excluído.");
    await carregarEventosDoMes();
  }));
}

// ------------------------------------------------------------
// LISTA LATERAL — alterna entre "próximos" e "já aconteceram"
// ------------------------------------------------------------
function tituloListaEventos() {
  const h3 = Array.from(document.querySelectorAll(".painel-calendario h3"))
    .find(el => el.textContent.trim().toLowerCase().startsWith("próximos")
             || el.textContent.trim().toLowerCase().startsWith("já aconteceram"));
  return h3 || null;
}

function botaoEventosPassados() {
  let btn = $("#btn-eventos-passados");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-eventos-passados";
    btn.className = "btn-link";
    $("#lista-eventos").insertAdjacentElement("beforebegin", btn);
    btn.addEventListener("click", async () => {
      state.verEventosPassados = !state.verEventosPassados;
      await carregarProximosEventos();
    });
  }
  return btn;
}

async function carregarProximosEventos() {
  const passados = !!state.verEventosPassados;

  let consulta = sb.from("eventos_calendario").select("*, turmas(nome)");
  consulta = passados
    ? consulta.lt("data", hoje()).order("data", { ascending: false }).limit(50)
    : consulta.gte("data", hoje()).order("data").limit(30);

  const { data, error } = await consulta;
  if (error) { toast("Erro ao carregar eventos: " + error.message, true); return; }

  const h3 = tituloListaEventos();
  if (h3) h3.textContent = passados ? "Já aconteceram" : "Próximos compromissos";

  const btn = botaoEventosPassados();
  btn.textContent = passados ? "← Voltar pros próximos compromissos" : "🕓 Ver eventos que já passaram";

  renderListaEventos(data || [], passados);
}

function textoContagem(dataStr) {
  const hojeD = new Date();
  hojeD.setHours(0, 0, 0, 0);
  const d = new Date(dataStr + "T00:00:00");
  const dias = Math.round((d - hojeD) / (1000 * 60 * 60 * 24));
  if (dias < 0) return `há ${Math.abs(dias)} dia(s)`;
  if (dias === 0) return "é hoje";
  if (dias === 1) return "é amanhã";
  return `inicia em ${dias} dias`;
}

function renderListaEventos(eventos, passados = false) {
  const lista = $("#lista-eventos");
  if (eventos.length === 0) {
    lista.innerHTML = passados
      ? `<p class="vazio">Nenhum evento anterior registrado.</p>`
      : `<p class="vazio">Nenhum compromisso agendado.</p>`;
    return;
  }
  lista.innerHTML = eventos.map(ev => {
    const cor = corUrgencia(ev.data);
    return `
    <div class="linha-evento cor-${cor}">
      <div class="linha-evento-info">
        <div class="linha-evento-titulo">${ev.titulo}</div>
        <div class="linha-evento-meta">${fmtData(ev.data)}${ev.turmas ? " · " + ev.turmas.nome : ""}</div>
      </div>
      <div class="linha-evento-rodape">
        <span class="linha-evento-contagem cor-${cor}">${textoContagem(ev.data)}</span>
        <span class="acoes-linha">
          <button class="btn-icone editar-evento" data-id="${ev.id}" title="Editar">✏️</button>
          <button class="btn-icone excluir excluir-evento" data-id="${ev.id}" title="Excluir">🗑️</button>
        </span>
      </div>
    </div>
  `;
  }).join("");

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

// (o aviso de "Clubinho do mês não cadastrado" agora aparece como lembrete
// na Visão Geral, veja carregarVisaoGeral)

// ------------------------------------------------------------
// WHATSAPP / COPIAR MENSAGEM
// ------------------------------------------------------------
function linkWhatsApp(telefone, mensagem) {
  const digitos = (telefone || "").replace(/\D/g, "");
  const numero = digitos.length <= 11 ? "55" + digitos : digitos;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

function escapeAtributo(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function copiarTexto(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(
      () => toast("Mensagem copiada!"),
      () => toast("Não consegui copiar automaticamente. Mensagem: " + texto, true)
    );
  } else {
    toast("Não consegui copiar automaticamente. Mensagem: " + texto, true);
  }
}

// ------------------------------------------------------------
// VISÃO GERAL (lembretes + resumo)
// ------------------------------------------------------------
async function ignorarLembrete(tipo, chave, descricao = null) {
  const { error } = await sb.from("lembretes_ignorados").insert({ tipo, chave, descricao });
  if (error) { toast("Erro ao marcar como resolvida: " + error.message, true); return; }
  toast("Pendência resolvida! Dá pra desfazer em \"Ver pendências que marquei como resolvidas\".");
  await carregarVisaoGeral();
  if (state.mostrandoResolvidas) await carregarResolvidas();
}

// ------------------------------------------------------------
// PENDÊNCIAS RESOLVIDAS (dá pra desfazer se marcou sem querer)
// ------------------------------------------------------------
async function carregarResolvidas() {
  const cont = $("#lista-resolvidas");
  const { data, error } = await sb.from("lembretes_ignorados")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { toast("Erro ao carregar resolvidas: " + error.message, true); return; }

  if (!data || data.length === 0) {
    cont.innerHTML = `<p class="vazio">Você ainda não marcou nenhuma pendência como resolvida.</p>`;
    return;
  }

  cont.innerHTML = data.map(r => `
    <div class="lembrete-card resolvida">
      <span class="lembrete-tipo">${ROTULO_PENDENCIA[r.tipo] || r.tipo}</span>
      <div class="lembrete-titulo">${r.descricao || "(pendência antiga, sem descrição salva)"}</div>
      <div class="lembrete-texto">Resolvida em ${r.created_at ? fmtData(r.created_at.slice(0, 10)) : "-"}</div>
      <div class="lembrete-acoes">
        <button class="btn-mini btn-desfazer" data-id="${r.id}">↩ Trazer de volta</button>
        <button class="btn-link btn-apagar-resolvida" data-id="${r.id}">Apagar de vez</button>
      </div>
    </div>
  `).join("");

  $all(".btn-desfazer").forEach(btn => btn.addEventListener("click", async () => {
    const { error } = await sb.from("lembretes_ignorados").delete().eq("id", btn.dataset.id);
    if (error) { toast("Erro ao desfazer: " + error.message, true); return; }
    toast("Pendência voltou pra lista!");
    await carregarVisaoGeral();
    await carregarResolvidas();
  }));

  $all(".btn-apagar-resolvida").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Apagar esse registro de vez? A pendência pode voltar a aparecer sozinha se a situação ainda existir (ex: pesagem continua atrasada).")) return;
    const { error } = await sb.from("lembretes_ignorados").delete().eq("id", btn.dataset.id);
    if (error) { toast("Erro ao apagar: " + error.message, true); return; }
    toast("Registro apagado.");
    await carregarVisaoGeral();
    await carregarResolvidas();
  }));
}

$("#btn-ver-resolvidas").addEventListener("click", async () => {
  state.mostrandoResolvidas = !state.mostrandoResolvidas;
  const cont = $("#lista-resolvidas");
  if (state.mostrandoResolvidas) {
    show(cont);
    $("#btn-ver-resolvidas").textContent = "▲ Esconder as resolvidas";
    await carregarResolvidas();
  } else {
    hide(cont);
    $("#btn-ver-resolvidas").textContent = "↩ Ver pendências que marquei como resolvidas";
  }
});

async function carregarVisaoGeral() {
  const hojeStr = hoje();

  const [
    { data: todasTurmas, error: e1 },
    { data: todasAlunas, error: e2 },
    { data: todosPesos, error: e3 },
    { data: todosPedidos, error: e4 },
    { data: todosEventos, error: e5 },
    { data: todasRespostas, error: e6 },
    { data: ignorados, error: e7 },
  ] = await Promise.all([
    sb.from("turmas").select("*"),
    sb.from("alunas").select("*, turmas(nome, data_inicio_acesso, data_fim, intervalo_pesagem_dias)"),
    sb.from("pesos").select("aluna_id, data").order("data", { ascending: false }),
    sb.from("pedidos_exame").select("id, aluna_id, data"),
    sb.from("eventos_calendario").select("*, turmas(nome)").gte("data", hojeStr),
    sb.from("respostas_questionario").select("*"),
    sb.from("lembretes_ignorados").select("tipo, chave"),
  ]);

  if (e1 || e2 || e3 || e4 || e5 || e6 || e7) {
    toast("Erro ao carregar a Visão Geral.", true);
    return;
  }

  const ignoradoSet = new Set((ignorados || []).map(i => `${i.tipo}:${i.chave}`));
  const estaIgnorado = (tipo, chave) => ignoradoSet.has(`${tipo}:${chave}`);

  const ultimasPesagens = {};
  (todosPesos || []).forEach(p => { if (!ultimasPesagens[p.aluna_id]) ultimasPesagens[p.aluna_id] = p.data; });

  const alunasComResposta = new Set((todasRespostas || []).filter(r => r.aluna_id).map(r => r.aluna_id));
  const respostasSemVinculo = (todasRespostas || []).filter(r => !r.aluna_id);

  const alunasAtivas = (todasAlunas || []).filter(a => a.status === "ativa");
  const turmasAtivas = (todasTurmas || []).filter(t => !acessoInfo(t).atrasado);

  $("#vg-total-turmas").textContent = turmasAtivas.length;
  $("#vg-total-alunas").textContent = alunasAtivas.length;

  // dados dos painéis clicáveis "turmas ativas" e "alunas ativas"
  state.vgTurmas = turmasAtivas.map(t => {
    const acesso = acessoInfo(t);
    const daTurma = alunasAtivas.filter(a => a.turma_id === t.id);
    const diasRestantes = acesso.semPrazo ? null : Math.ceil((acesso.dataFim - new Date()) / (1000 * 60 * 60 * 24));
    return {
      ...t,
      qtdAlunas: daTurma.length,
      acessoTexto: acesso.texto,
      acessoVencendo: diasRestantes != null && diasRestantes <= DIAS_AVISO_ACESSO_VENCENDO,
      pesagensAtrasadas: daTurma.filter(a => a.fase !== "manutencao" && statusPesagemTurma(a.turmas, ultimasPesagens[a.id])).length,
      semQuestionario: daTurma.filter(a => !alunasComResposta.has(a.id)).length,
    };
  });

  state.vgAlunas = alunasAtivas.map(a => {
    const pesagem = a.fase === "manutencao" ? null : statusPesagemTurma(a.turmas, ultimasPesagens[a.id]);
    return {
      id: a.id,
      nome: a.nome,
      turmaId: a.turma_id,
      turmaNome: a.turmas?.nome || "sem turma",
      pesagem,
      semQuestionario: !alunasComResposta.has(a.id),
      manutencao: a.fase === "manutencao",
      ultimaPesagem: ultimasPesagens[a.id] || null,
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const lembretes = [];

  // 1) Pesagem atrasada / hoje
  alunasAtivas.forEach(a => {
    if (a.fase === "manutencao") return;
    const pesagem = statusPesagemTurma(a.turmas, ultimasPesagens[a.id]);
    if (!pesagem) return;
    const chave = `${a.id}:${pesagem.ciclo}`;
    if (estaIgnorado("pesagem", chave)) return;
    lembretes.push({
      tipo: "pesagem", chave,
      cor: pesagem.tipo === "hoje" ? "amarelo" : "vermelho",
      titulo: `⚖️ ${a.nome}`,
      texto: `${pesagem.texto} · Turma ${a.turmas?.nome || ""}`,
      individual: true,
      alunaId: a.id,
      acaoPeso: true,
      telefone: a.telefone,
      mensagem: `Oi, ${(a.nome || "").split(" ")[0]}! Passando pra lembrar da sua pesagem de acompanhamento 💛 Me manda seu peso atualizado quando puder?`,
    });
  });

  // 2) Exame perto/estourando a cota de 4
  const contagemExames = {};
  (todosPedidos || []).forEach(p => {
    const aluna = alunasAtivas.find(a => a.id === p.aluna_id);
    if (!aluna) return;
    const ano = anoDoPrograma(aluna.data_entrada, p.data);
    contagemExames[p.aluna_id] ||= {};
    contagemExames[p.aluna_id][ano] = (contagemExames[p.aluna_id][ano] || 0) + 1;
  });
  alunasAtivas.forEach(a => {
    const anoAtual = anoDoPrograma(a.data_entrada, hojeStr);
    const count = contagemExames[a.id]?.[anoAtual] || 0;
    if (count < COTA_EXAMES_POR_ANO - 1) return;
    const chave = `${a.id}:${anoAtual}`;
    if (estaIgnorado("exame", chave)) return;
    lembretes.push({
      tipo: "exame", chave,
      cor: count >= COTA_EXAMES_POR_ANO ? "vermelho" : "amarelo",
      titulo: `🧪 ${a.nome}`,
      texto: `${count} de ${COTA_EXAMES_POR_ANO} pedidos de exame usados no ${anoAtual}º ano de programa`,
      individual: true,
      alunaId: a.id,
      telefone: a.telefone,
      mensagem: `Oi, ${(a.nome || "").split(" ")[0]}! Já pode ir agendando os próximos exames do seu acompanhamento. Qualquer dúvida me chama!`,
    });
  });

  // 3) Clubinho próximo
  (state.clubinhos || []).forEach(c => {
    if (!c.data) return;
    const cor = corUrgencia(c.data);
    if (cor === "verde" || cor === "passado") return;
    if (estaIgnorado("clubinho", c.id)) return;
    lembretes.push({
      tipo: "clubinho", chave: c.id, cor,
      titulo: `🌸 ${clubinhoNome(c)}`,
      texto: `${textoContagem(c.data)}${c.tema ? " · Tema: " + c.tema : ""}`,
      individual: false,
      mensagem: `🌸 Clubinho da Menopausa de ${MESES_NOME[c.mes - 1]}! Tema: ${c.tema || "a definir"}${c.convidado ? " · Convidada: " + c.convidado : ""}. Dia ${fmtData(c.data)}. Já anota na agenda!`,
    });
  });

  // 3b) Clubinho do mês ainda não cadastrado
  const agora = new Date();
  const anoAtualC = agora.getFullYear();
  const mesAtualC = agora.getMonth() + 1;
  const diasRestantesMes = new Date(anoAtualC, mesAtualC, 0).getDate() - agora.getDate();
  const jaTemEsteMes = (state.clubinhos || []).some(c => c.ano === anoAtualC && c.mes === mesAtualC);
  if (!jaTemEsteMes && diasRestantesMes <= 10) {
    const chave = `${anoAtualC}-${mesAtualC}`;
    if (!estaIgnorado("clubinho-pendente", chave)) {
      lembretes.push({
        tipo: "clubinho-pendente", chave,
        cor: diasRestantesMes <= 5 ? "vermelho" : "amarelo",
        titulo: `🌸 Clubinho de ${MESES_NOME[mesAtualC - 1]} ainda não cadastrado`,
        texto: `Faltam ${diasRestantesMes} dia(s) pro fim do mês`,
        individual: false, semMensagem: true,
      });
    }
  }

  // 4) Aulas/eventos próximos (até 3 dias)
  (todosEventos || []).forEach(ev => {
    const cor = corUrgencia(ev.data);
    if (cor !== "vermelho") return; // só entra quando faltam 5 dias ou menos
    if (estaIgnorado("evento", ev.id)) return;
    lembretes.push({
      tipo: "evento", chave: ev.id, cor,
      titulo: `📚 ${ev.titulo}`,
      texto: `${textoContagem(ev.data)}${ev.turmas ? " · " + ev.turmas.nome : ""}`,
      individual: false,
      mensagem: `📚 Lembrete: ${ev.titulo} é dia ${fmtData(ev.data)}! Não esqueçam de participar.`,
    });
  });

  // 5) Questionário de dieta pendente
  alunasAtivas.forEach(a => {
    if (alunasComResposta.has(a.id)) return;
    if (estaIgnorado("questionario", a.id)) return;
    lembretes.push({
      tipo: "questionario", chave: a.id, cor: "amarelo",
      titulo: `📋 ${a.nome}`,
      texto: "Ainda não respondeu o questionário da dieta",
      individual: true,
      alunaId: a.id,
      telefone: a.telefone,
      mensagem: `Oi, ${(a.nome || "").split(" ")[0]}! Ainda não vi sua resposta no questionário da dieta 🍽️ Consegue preencher hoje?`,
    });
  });

  // 6) Acesso da turma vencendo ou já vencido (bom momento pra oferecer renovação)
  (todasTurmas || []).forEach(t => {
    const acesso = acessoInfo(t);
    if (acesso.semPrazo) return;
    const diasRestantes = Math.ceil((acesso.dataFim - new Date()) / (1000 * 60 * 60 * 24));
    if (diasRestantes > DIAS_AVISO_ACESSO_VENCENDO) return;
    const qtdAlunasAtivas = alunasAtivas.filter(a => a.turma_id === t.id).length;
    if (qtdAlunasAtivas === 0) return;
    const chave = `${t.id}:${t.data_fim}`;
    if (estaIgnorado("acesso-vencendo", chave)) return;
    lembretes.push({
      tipo: "acesso-vencendo", chave,
      cor: acesso.atrasado ? "vermelho" : "amarelo",
      titulo: `⏳ ${t.nome}`,
      texto: `${acesso.texto} · ${qtdAlunasAtivas} aluna(s) ativa(s) — bom momento pra oferecer renovação`,
      individual: false, semMensagem: true,
    });
  });

  const semVinculoAtivas = respostasSemVinculo.filter(r => !ignoradoSet.has(`questionario-sem-vinculo:${r.id}`));
  $("#vg-total-pendencias").textContent = lembretes.length + semVinculoAtivas.length;

  state.vgPendencias = lembretes;
  renderFiltrosPendencias(lembretes);
  renderLembretes(lembretes);
  renderSemVinculo(respostasSemVinculo, todasAlunas || [], ignoradoSet);
  renderVGTurmas();
  renderVGAlunas();
}

// ------------------------------------------------------------
// PAINÉIS CLICÁVEIS DA VISÃO GERAL (pendências / turmas / alunas)
// ------------------------------------------------------------
function mudarPainelVG(nome) {
  state.vgPainel = nome;
  $all(".vg-card").forEach(c => c.classList.toggle("ativo", c.dataset.painel === nome));
  ["pendencias", "turmas", "alunas"].forEach(p => {
    const el = $(`#vg-painel-${p}`);
    if (p === nome) show(el); else hide(el);
  });
}
$all(".vg-card").forEach(card => {
  card.addEventListener("click", () => mudarPainelVG(card.dataset.painel));
});

// rótulos amigáveis de cada tipo de pendência, usados nos filtros
const ROTULO_PENDENCIA = {
  pesagem: "⚖️ Pesagem",
  exame: "🧪 Exames",
  questionario: "📋 Questionário",
  clubinho: "🌸 Clubinho",
  "clubinho-pendente": "🌸 Clubinho",
  evento: "📚 Aulas/eventos",
  "acesso-vencendo": "⏳ Acesso vencendo",
};

function renderFiltrosPendencias(lembretes) {
  const cont = $("#vg-filtros-pendencias");
  const tipos = [...new Set(lembretes.map(l => l.tipo))];
  if (tipos.length <= 1) { cont.innerHTML = ""; return; }

  const contagem = {};
  lembretes.forEach(l => { contagem[l.tipo] = (contagem[l.tipo] || 0) + 1; });

  cont.innerHTML = [`<button class="chip-filtro ${state.vgFiltroPendencia === "todas" ? "ativo" : ""}" data-filtro="todas">Todas (${lembretes.length})</button>`]
    .concat(tipos.map(t => `<button class="chip-filtro ${state.vgFiltroPendencia === t ? "ativo" : ""}" data-filtro="${t}">${ROTULO_PENDENCIA[t] || t} (${contagem[t]})</button>`))
    .join("");

  $all("#vg-filtros-pendencias .chip-filtro").forEach(btn => btn.addEventListener("click", () => {
    state.vgFiltroPendencia = btn.dataset.filtro;
    renderFiltrosPendencias(state.vgPendencias || []);
    renderLembretes(state.vgPendencias || []);
  }));
}

function renderVGTurmas() {
  const cont = $("#vg-lista-turmas");
  if (state.vgTurmas.length === 0) {
    cont.innerHTML = `<p class="vazio">Nenhuma turma ativa no momento.</p>`;
    return;
  }

  cont.innerHTML = state.vgTurmas.map(t => `
    <div class="vg-card-item" data-turma="${t.id}">
      <div class="vg-card-item-titulo">${t.nome}</div>
      <div class="vg-card-item-meta">${t.qtdAlunas} aluna(s) ativa(s) · ${t.acessoTexto}</div>
      <div class="item-aluna-badges">
        ${t.acessoVencendo ? `<span class="badge atrasado">⏳ Acesso vencendo</span>` : ""}
        ${t.pesagensAtrasadas ? `<span class="badge pesagem-atrasada">⚖️ ${t.pesagensAtrasadas} pesagem(ns) pendente(s)</span>` : ""}
        ${t.semQuestionario ? `<span class="badge">📋 ${t.semQuestionario} sem questionário</span>` : ""}
      </div>
    </div>
  `).join("");

  $all("#vg-lista-turmas .vg-card-item").forEach(el => el.addEventListener("click", async () => {
    const turma = turmaPorId(el.dataset.turma);
    if (!turma) return;
    mudarSecao("turmas");
    await abrirPainelTurma(turma);
  }));
}

function renderVGAlunas() {
  const cont = $("#vg-lista-alunas");
  const busca = semAcento(state.vgBuscaAlunas.trim());
  const lista = busca ? state.vgAlunas.filter(a => semAcento(a.nome).includes(busca)) : state.vgAlunas;

  if (lista.length === 0) {
    cont.innerHTML = `<p class="vazio">${busca ? "Nenhuma aluna com esse nome." : "Nenhuma aluna ativa ainda."}</p>`;
    return;
  }

  cont.innerHTML = lista.map(a => `
    <div class="vg-card-item" data-aluna="${a.id}">
      <div class="vg-card-item-titulo">${a.nome}</div>
      <div class="vg-card-item-meta">Turma: ${a.turmaNome} · ${a.ultimaPesagem ? "última pesagem em " + fmtData(a.ultimaPesagem) : "sem pesagem registrada"}</div>
      <div class="item-aluna-badges">
        ${a.manutencao ? `<span class="badge manutencao">🎯 Meta atingida (manutenção)</span>` : ""}
        ${a.pesagem ? `<span class="badge ${a.pesagem.tipo === "hoje" ? "pesagem-hoje" : "pesagem-atrasada"}">⚖️ ${a.pesagem.texto}</span>` : ""}
        ${a.semQuestionario ? `<span class="badge">📋 Sem questionário</span>` : ""}
        ${!a.manutencao && !a.pesagem && !a.semQuestionario ? `<span class="badge tudo-ok">✅ Tudo em dia</span>` : ""}
      </div>
    </div>
  `).join("");

  $all("#vg-lista-alunas .vg-card-item").forEach(el => el.addEventListener("click", async () => {
    const aluna = state.vgAlunas.find(x => x.id === el.dataset.aluna);
    if (!aluna) return;
    mudarSecao("turmas");
    const turma = turmaPorId(aluna.turmaId);
    if (turma) await abrirPainelTurma(turma);
    await abrirAluna(aluna.id);
  }));
}

$("#vg-busca-alunas").addEventListener("input", (e) => {
  state.vgBuscaAlunas = e.target.value;
  renderVGAlunas();
});

function renderLembretes(lembretes) {
  const cont = $("#lista-lembretes");
  if (lembretes.length === 0) {
    cont.innerHTML = `<p class="vazio">Nenhuma pendência por aqui. Tudo em dia! 🎉</p>`;
    return;
  }

  const filtro = state.vgFiltroPendencia || "todas";
  const visiveis = filtro === "todas" ? lembretes : lembretes.filter(l => l.tipo === filtro);
  if (visiveis.length === 0) {
    cont.innerHTML = `<p class="vazio">Nenhuma pendência desse tipo. 🎉</p>`;
    return;
  }

  const ordemCor = { vermelho: 0, amarelo: 1, verde: 2 };
  visiveis.sort((a, b) => (ordemCor[a.cor] ?? 3) - (ordemCor[b.cor] ?? 3));

  cont.innerHTML = visiveis.map(l => `
    <div class="lembrete-card cor-${l.cor}">
      <span class="lembrete-tipo">${l.individual ? "Individual" : "Grupo"}</span>
      <div class="lembrete-titulo">${l.titulo}</div>
      <div class="lembrete-texto">${l.texto}</div>
      <div class="lembrete-acoes">
        ${l.acaoPeso ? `<button class="btn-mini btn-registrar-peso" data-aluna="${l.alunaId}" data-nome="${escapeAtributo(l.titulo)}">⚖️ Registrar o peso</button>` : ""}
        ${l.semMensagem ? "" : (
          l.individual && l.telefone
            ? `<a class="btn-mini btn-whatsapp" href="${linkWhatsApp(l.telefone, l.mensagem)}" target="_blank" rel="noopener">📲 Enviar WhatsApp</a>`
            : `<button class="btn-mini btn-copiar" data-msg="${escapeAtributo(l.mensagem)}">📋 Copiar mensagem</button>`
        )}
        ${l.alunaId ? `<button class="btn-link btn-abrir-ficha" data-aluna="${l.alunaId}">Abrir prontuário</button>` : ""}
        <button class="btn-mini btn-resolvido btn-ignorar-lembrete" data-tipo="${l.tipo}" data-chave="${l.chave}" data-descricao="${escapeAtributo(l.titulo + " — " + l.texto)}">✓ Já resolvi</button>
      </div>
    </div>
  `).join("");

  $all(".btn-copiar").forEach(btn => btn.addEventListener("click", () => copiarTexto(btn.dataset.msg)));
  $all(".btn-ignorar-lembrete").forEach(btn => btn.addEventListener("click", () => ignorarLembrete(btn.dataset.tipo, btn.dataset.chave, btn.dataset.descricao)));
  $all(".btn-abrir-ficha").forEach(btn => btn.addEventListener("click", () => irParaAluna(btn.dataset.aluna)));

  // registrar o peso direto da pendência, sem precisar navegar até a ficha da aluna
  $all(".btn-registrar-peso").forEach(btn => btn.addEventListener("click", async () => {
    const nome = (btn.dataset.nome || "").replace("⚖️ ", "");
    const valor = prompt(`Peso de ${nome} (em kg):`);
    if (valor === null) return;
    const peso = numeroDoTexto(valor);
    if (peso == null) { toast("Não entendi esse peso. Escreva só o número, ex: 78,5", true); return; }
    const { error } = await sb.from("pesos").insert({ aluna_id: btn.dataset.aluna, data: hoje(), peso });
    if (error) { toast("Erro ao registrar peso: " + error.message, true); return; }
    toast(`Peso de ${nome} registrado: ${peso} kg`);
    await carregarVisaoGeral();
  }));
}

function renderSemVinculo(respostas, alunas, ignoradoSet) {
  const bloco = $("#bloco-sem-vinculo");
  const filtradas = respostas.filter(r => !ignoradoSet.has(`questionario-sem-vinculo:${r.id}`));
  if (filtradas.length === 0) { hide(bloco); return; }
  show(bloco);

  $("#lista-sem-vinculo").innerHTML = filtradas.map(r => {
    // se a resposta veio marcada com uma turma, mostra só as alunas dessa turma
    // pra facilitar achar quem é (mas nunca esconde a opção se a turma não tiver ninguém)
    const alunasDaTurma = r.turma_id ? alunas.filter(a => a.turma_id === r.turma_id) : [];
    const listaParaSelect = alunasDaTurma.length > 0 ? alunasDaTurma : alunas;
    const opcoesAlunas = listaParaSelect.map(a => `<option value="${a.id}">${a.nome}</option>`).join("");
    const nomeTurma = r.turma_id ? (state.turmas.find(t => t.id === r.turma_id)?.nome || "") : "";

    return `
    <div class="lembrete-card">
      <div class="lembrete-titulo">${r.nome_respondente || "(sem nome)"}</div>
      <div class="lembrete-texto">${r.telefone_respondente || ""}${r.email_respondente ? " · " + r.email_respondente : ""}${nomeTurma ? " · Turma: " + nomeTurma : ""}</div>
      <div class="lembrete-acoes">
        <select class="select-vincular-aluna">
          <option value="">Vincular a...</option>
          ${opcoesAlunas}
        </select>
        <button class="btn-mini btn-vincular" data-id="${r.id}">Vincular</button>
        <button class="btn-mini btn-cadastrar-nova" data-id="${r.id}">+ Cadastrar como nova aluna</button>
        <button class="btn-link btn-ignorar-sem-vinculo" data-id="${r.id}">Descartar</button>
      </div>
    </div>
  `;
  }).join("");

  $all(".btn-vincular").forEach(btn => btn.addEventListener("click", async () => {
    const card = btn.closest(".lembrete-card");
    const alunaId = card.querySelector(".select-vincular-aluna").value;
    if (!alunaId) { toast("Escolha uma aluna primeiro.", true); return; }
    const { error } = await sb.from("respostas_questionario").update({ aluna_id: alunaId }).eq("id", btn.dataset.id);
    if (error) { toast("Essa aluna já tem um questionário vinculado. Exclua o antigo na ficha dela antes de vincular esse.", true); return; }
    toast("Vinculado!");
    await carregarVisaoGeral();
  }));

  $all(".btn-cadastrar-nova").forEach(btn => btn.addEventListener("click", async () => {
    const resposta = filtradas.find(r => r.id === btn.dataset.id);
    if (!resposta) return;
    if (!resposta.nome_respondente) { toast("Essa resposta não tem nome pra cadastrar a aluna. Vincule manualmente.", true); return; }
    if (!confirm(`Cadastrar "${resposta.nome_respondente}" como nova aluna${resposta.turma_id ? " nessa turma" : ""} e vincular esse questionário a ela?`)) return;

    const resultado = await cadastrarAlunaDeResposta(resposta);
    if (!resultado.ok) { toast(resultado.erro, true); return; }

    toast(`"${resposta.nome_respondente}" cadastrada e vinculada!${resultado.pesoInicial != null ? " Peso inicial registrado." : ""}`);
    await carregarVisaoGeral();
  }));

  $("#btn-cadastrar-todas").addEventListener("click", async () => {
    const comNome = filtradas.filter(r => r.nome_respondente);
    const semNome = filtradas.length - comNome.length;
    if (comNome.length === 0) { toast("Nenhuma dessas respostas tem nome pra cadastrar.", true); return; }
    if (!confirm(`Cadastrar ${comNome.length} aluna(s) nova(s) de uma vez, usando nome/telefone/e-mail/peso/turma de cada resposta do questionário?${semNome ? ` (${semNome} sem nome vão ficar de fora, precisam ser vinculadas manualmente.)` : ""}`)) return;

    let criadas = 0, comErro = 0;
    for (const resposta of comNome) {
      const resultado = await cadastrarAlunaDeResposta(resposta);
      if (resultado.ok) criadas++; else comErro++;
    }

    toast(`${criadas} aluna(s) cadastrada(s) e vinculada(s)!${comErro ? ` ${comErro} deram erro (confira manualmente).` : ""}`);
    await carregarVisaoGeral();
  });

  $all(".btn-ignorar-sem-vinculo").forEach(btn => btn.addEventListener("click", () => ignorarLembrete("questionario-sem-vinculo", btn.dataset.id)));
}

// cadastra uma aluna nova a partir de uma resposta de questionário (nome, telefone, e-mail,
// turma, peso/altura/meta e queixas), já lançando a primeira pesagem e vinculando o questionário.
// usado tanto pelo botão individual quanto pelo "cadastrar todas de uma vez".
async function cadastrarAlunaDeResposta(resposta) {
  const pesoInicial = numeroDoTexto(resposta.peso_atual);
  const altura = alturaEmMetros(resposta.altura_atual);
  const quilosPerder = numeroDoTexto(resposta.quilos_perder);
  const metaPeso = (pesoInicial != null && quilosPerder != null) ? Math.round((pesoInicial - quilosPerder) * 100) / 100 : null;

  const observacoes = resumoQueixasQuestionario(resposta);

  const restricoes = [
    resposta.alergia_alimento ? `Alergia: ${resposta.alergia_alimento}` : "",
    resposta.alimento_nao_come ? `Não come: ${resposta.alimento_nao_come}` : "",
  ].filter(Boolean).join("\n");

  const { data: novaAluna, error: erroInsert } = await sb.from("alunas").insert({
    nome: resposta.nome_respondente,
    email: resposta.email_respondente || null,
    telefone: resposta.telefone_respondente || null,
    turma_id: resposta.turma_id || null,
    peso_inicial: pesoInicial,
    meta_peso: metaPeso,
    altura: altura,
    queixas_iniciais: observacoes || null,
    restricoes: restricoes || null,
  }).select().single();
  if (erroInsert) return { ok: false, erro: "Erro ao cadastrar aluna: " + erroInsert.message };

  if (pesoInicial != null) {
    await sb.from("pesos").insert({
      aluna_id: novaAluna.id,
      peso: pesoInicial,
      // usa o dia em que ela respondeu o formulário, não o dia da importação
      data: dataDoCarimbo(resposta.data_resposta) || hoje(),
      observacao: "Peso informado no questionário inicial",
    });
  }

  const { error: erroVinculo } = await sb.from("respostas_questionario").update({ aluna_id: novaAluna.id }).eq("id", resposta.id);
  if (erroVinculo) return { ok: false, erro: "Aluna cadastrada, mas houve erro ao vincular o questionário: " + erroVinculo.message };

  return { ok: true, pesoInicial, aluna: novaAluna };
}

// ------------------------------------------------------------
// IMPORTAR RESPOSTAS DO GOOGLE FORMS (CSV)
// ------------------------------------------------------------
function parseCSV(texto) {
  const linhas = [];
  let campo = "", linha = [], dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else { dentroAspas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === ",") {
      linha.push(campo); campo = "";
    } else if (c === "\r") {
      // ignora
    } else if (c === "\n") {
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || linha.length > 0) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(c => c !== ""));
}

// converte uma data digitada no formato brasileiro (21/05/2026) pra o formato do banco
// (2026-05-21). Aceita também a data já no formato do banco. Devolve null se não entender.
function dataBRparaISO(str) {
  const t = (str || "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);          // 2026-05-21
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);     // 21/05/2026
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// pega a data do carimbo do Google Forms ("2026/05/21 3:42:17 AM GMT-3")
// e devolve no formato do banco (2026-05-21)
function dataDoCarimbo(carimbo) {
  const t = (carimbo || "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);  // ano primeiro
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);      // dia primeiro
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// A altura é guardada sempre em METROS. Mas no formulário a aluna tanto escreve
// "1,59" quanto "159", e nos dois casos é a mesma altura. Como ninguém tem 159
// metros nem 1,5 centímetros, dá pra decidir pelo tamanho do número.
function alturaEmMetros(valor) {
  const n = typeof valor === "number" ? valor : numeroDoTexto(valor);
  if (n == null || !isFinite(n) || n <= 0) return null;
  if (n > 3) return Math.round(n) / 100;   // veio em centímetros
  return n;                                 // já veio em metros
}

// extrai o primeiro número de um texto tipo "81,50 kg" ou "1,56"
function numeroDoTexto(str) {
  if (!str) return null;
  const m = String(str).replace(",", ".").match(/[\d]+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// monta o resumo de "queixas da avaliação" a partir dos campos do questionário
function resumoQueixasQuestionario(r) {
  return [
    r.medicamentos ? `Medicamentos: ${r.medicamentos}` : "",
    r.suplementos ? `Suplementos: ${r.suplementos}` : "",
    r.atividade_fisica ? `Atividade física: ${r.atividade_fisica}` : "",
    r.fumante ? `Fumante: ${r.fumante}` : "",
    r.alcool ? `Álcool: ${r.alcool}` : "",
    r.sono_como ? `Sono: ${r.sono_como}` : "",
    r.horas_sono ? `Horas de sono: ${r.horas_sono}` : "",
    r.acorda_disposta ? `Acorda disposta: ${r.acorda_disposta}` : "",
    r.vontade_doce ? `Vontade de doce: ${r.vontade_doce}` : "",
    r.banheiro_vezes ? `Vezes no banheiro/dia: ${r.banheiro_vezes}` : "",
    r.banheiro_frequencia ? `Frequência (se não é todo dia): ${r.banheiro_frequencia}` : "",
  ].filter(Boolean).join("\n");
}

function semAcento(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mapearColunas(cabecalho) {
  const normalizados = cabecalho.map(semAcento);
  const achaTodos = (regex) => normalizados.map((h, i) => (regex.test(h) ? i : -1)).filter(i => i !== -1);

  return {
    carimbo: achaTodos(/carimbo/),
    nome_respondente: achaTodos(/nome/),
    email_respondente: achaTodos(/e-?mail/),
    telefone_respondente: achaTodos(/whats|telefone|numero/),
    peso_atual: achaTodos(/peso/),
    altura_atual: achaTodos(/altura/),
    quilos_perder: achaTodos(/perder/),
    manequim: achaTodos(/manequim/),
    medicamentos: achaTodos(/medicamento/),
    suplementos: achaTodos(/suplemento/),
    atividade_fisica: achaTodos(/atividade fisica/),
    fumante: achaTodos(/fuma/),
    alcool: achaTodos(/alco/),
    sono_como: achaTodos(/sono/),
    horas_sono: achaTodos(/horas.*dorme|dorme.*horas/),
    acorda_disposta: achaTodos(/acorda/),
    vontade_doce: achaTodos(/doce/),
    banheiro_vezes: achaTodos(/banheiro/),
    banheiro_frequencia: achaTodos(/frequencia/),
    alergia_alimento: achaTodos(/alergica/),
    alimento_nao_come: achaTodos(/nao come/),
  };
}

function normalizarTelefone(str) {
  const digitos = (str || "").replace(/\D/g, "");
  // usa DDD + número (até 11 dígitos) quando disponível, pra não confundir
  // números de pessoas diferentes que só coincidem nos últimos dígitos
  if (digitos.length <= 8) return digitos;
  return digitos.slice(-11);
}

async function importarQuestionarios(texto) {
  const linhas = parseCSV(texto);
  if (linhas.length < 2) { toast("Arquivo CSV vazio ou inválido.", true); return; }

  const turmaId = state.turmaAberta?.id || null;
  const idx = mapearColunas(linhas[0]);
  const linhasDados = linhas.slice(1).filter(l => l.some(c => c && c.trim()));

  const { data: todasAlunas, error: erroAlunas } = await sb.from("alunas").select("id, nome, telefone, email");
  if (erroAlunas) { toast("Erro ao carregar alunas pra comparar: " + erroAlunas.message, true); return; }

  const registrosBrutos = linhasDados.map(cols => {
    const get = (campo) => {
      const indices = idx[campo] || [];
      return indices.map(i => (cols[i] || "").trim()).filter(Boolean).join(" · ");
    };

    const nome = get("nome_respondente");
    const email = get("email_respondente");
    const telefone = get("telefone_respondente");
    const telNorm = normalizarTelefone(telefone);
    const emailNorm = email.toLowerCase();

    const alunaMatch = todasAlunas.find(a => {
      const aTel = normalizarTelefone(a.telefone);
      const aEmail = (a.email || "").toLowerCase();
      return (telNorm && aTel && aTel === telNorm) || (emailNorm && aEmail && aEmail === emailNorm);
    });

    const chave = telNorm || emailNorm || nome.toLowerCase();
    if (!chave) return { descartada: true };

    return {
      aluna_id: alunaMatch ? alunaMatch.id : null,
      turma_id: turmaId,
      chave_importacao: chave,
      nome_respondente: nome || null,
      email_respondente: email || null,
      telefone_respondente: telefone || null,
      data_resposta: get("carimbo") || null,
      peso_atual: get("peso_atual") || null,
      altura_atual: get("altura_atual") || null,
      quilos_perder: get("quilos_perder") || null,
      manequim: get("manequim") || null,
      medicamentos: get("medicamentos") || null,
      suplementos: get("suplementos") || null,
      atividade_fisica: get("atividade_fisica") || null,
      fumante: get("fumante") || null,
      alcool: get("alcool") || null,
      sono_como: get("sono_como") || null,
      horas_sono: get("horas_sono") || null,
      acorda_disposta: get("acorda_disposta") || null,
      vontade_doce: get("vontade_doce") || null,
      banheiro_vezes: get("banheiro_vezes") || null,
      banheiro_frequencia: get("banheiro_frequencia") || null,
      alergia_alimento: get("alergia_alimento") || null,
      alimento_nao_come: get("alimento_nao_come") || null,
      updated_at: new Date().toISOString(),
    };
  });

  const descartadas = registrosBrutos.filter(r => r && r.descartada).length;
  const registros = registrosBrutos.filter(r => r && !r.descartada);

  if (registros.length === 0) {
    toast(descartadas ? `Nenhuma resposta válida — ${descartadas} linha(s) sem nome, e-mail nem telefone foram ignoradas.` : "Nenhuma resposta válida encontrada no arquivo.", true);
    return;
  }

  // se a mesma pessoa respondeu mais de uma vez no arquivo, fica só com a resposta
  // mais recente (a lista já vem em ordem cronológica, então a última que aparecer vence)
  const porChave = new Map();
  registros.forEach(r => porChave.set(r.chave_importacao, r));
  const registrosSemDuplicata = Array.from(porChave.values());
  const duplicadas = registros.length - registrosSemDuplicata.length;

  // Respostas que JÁ existem no sistema mantêm a turma em que foram importadas
  // e o vínculo com a aluna que já tinham. Sem isso, subir o CSV completo do
  // Forms dentro de uma turma nova remarcava todas as alunas antigas com ela,
  // e desfazia os vínculos que foram feitos na mão.
  const chaves = registrosSemDuplicata.map(r => r.chave_importacao);
  const { data: jaExistentes, error: erroExistentes } = await sb
    .from("respostas_questionario")
    .select("chave_importacao, turma_id, aluna_id")
    .in("chave_importacao", chaves);
  if (erroExistentes) { toast("Erro ao conferir o que já foi importado: " + erroExistentes.message, true); return; }

  const anteriorPorChave = new Map((jaExistentes || []).map(x => [x.chave_importacao, x]));
  registrosSemDuplicata.forEach(r => {
    const anterior = anteriorPorChave.get(r.chave_importacao);
    if (!anterior) return;
    if (anterior.turma_id) r.turma_id = anterior.turma_id;
    if (anterior.aluna_id) r.aluna_id = anterior.aluna_id;
  });

  const { error } = await sb.from("respostas_questionario").upsert(registrosSemDuplicata, { onConflict: "chave_importacao" });
  if (error) { toast("Erro ao importar: " + error.message, true); return; }

  const novas = registrosSemDuplicata.filter(r => !anteriorPorChave.has(r.chave_importacao));
  const atualizadas = registrosSemDuplicata.length - novas.length;
  const vinculadas = novas.filter(r => r.aluna_id).length;
  const semVinculo = novas.length - vinculadas;

  const partes = [];
  partes.push(`${novas.length} resposta(s) nova(s)`);
  if (novas.length) partes.push(`${vinculadas} vinculada(s) a alunas, ${semVinculo} sem vínculo`);
  if (atualizadas) partes.push(`${atualizadas} já existia(m) e foi(ram) atualizada(s) sem mudar de turma`);
  if (duplicadas) partes.push(`${duplicadas} repetida(s) no próprio arquivo`);
  if (descartadas) partes.push(`${descartadas} linha(s) sem nome/e-mail/telefone`);
  toast("Importado! " + partes.join(" · ") + ".");
  await carregarVisaoGeral();
}

$("#btn-importar-questionario").addEventListener("click", () => {
  if (!state.turmaAberta) { toast("Abra uma turma primeiro pra importar as respostas nela.", true); return; }
  $("#input-csv-questionario").click();
});
$("#input-csv-questionario").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const texto = await file.text();
  await importarQuestionarios(texto);
  e.target.value = "";
});

// ------------------------------------------------------------
// QUESTIONÁRIO NA FICHA DA ALUNA
// ------------------------------------------------------------
async function carregarQuestionario(alunaId) {
  const { data, error } = await sb.from("respostas_questionario").select("*").eq("aluna_id", alunaId).maybeSingle();
  if (error) { toast("Erro ao carregar questionário: " + error.message, true); return; }
  renderQuestionario(data);
}

function renderQuestionario(r) {
  state.questionarioAtual = r || null;
  if (!r) {
    show($("#questionario-vazio"));
    hide($("#questionario-preenchido"));
    return;
  }
  hide($("#questionario-vazio"));
  show($("#questionario-preenchido"));

  const dataResp = dataDoCarimbo(r.data_resposta);
  $("#questionario-data").textContent = dataResp ? fmtData(dataResp) : (r.data_resposta || "-");
  $("#questionario-alergia").textContent = [r.alergia_alimento, r.alimento_nao_come].filter(Boolean).join(" · ") || "Nada informado.";

  const pesoInicial = numeroDoTexto(r.peso_atual);
  const altura = numeroDoTexto(r.altura_atual);
  const quilosPerder = numeroDoTexto(r.quilos_perder);
  const metaCalculada = (pesoInicial != null && quilosPerder != null) ? Math.round((pesoInicial - quilosPerder) * 100) / 100 : null;
  $("#questionario-peso-resumo").textContent = [
    r.peso_atual ? `Peso atual: ${r.peso_atual} kg` : "",
    alturaEmMetros(r.altura_atual) ? `Altura: ${nBR(alturaEmMetros(r.altura_atual))} m` : "",
    r.quilos_perder ? `Quer perder: ${r.quilos_perder} kg` : "",
    metaCalculada != null ? `Meta calculada: ${metaCalculada} kg` : "",
  ].filter(Boolean).join(" · ") || "Nada informado.";

  $("#questionario-queixas-resumo").textContent = resumoQueixasQuestionario(r).split("\n").join(" · ") || "Nada informado.";

  const campos = [
    ["Peso atual", r.peso_atual],
    ["Altura", r.altura_atual],
    ["Quilos que quer perder", r.quilos_perder],
    ["Manequim", r.manequim],
    ["Medicamentos", r.medicamentos],
    ["Suplementos", r.suplementos],
    ["Atividade física", r.atividade_fisica],
    ["Fuma?", r.fumante],
    ["Álcool", r.alcool],
    ["Sono", r.sono_como],
    ["Horas de sono", r.horas_sono],
    ["Acorda disposta?", r.acorda_disposta],
    ["Vontade de doce", r.vontade_doce],
    ["Vezes no banheiro/dia", r.banheiro_vezes],
    ["Frequência (se não é todo dia)", r.banheiro_frequencia],
  ];

  $("#grid-questionario").innerHTML = campos.filter(([, v]) => v).map(([label, valor]) => `
    <div class="info-box">
      <span class="info-label">${label}</span>
      <span class="info-valor">${valor}</span>
    </div>
  `).join("");
}

$("#btn-usar-peso-questionario").addEventListener("click", async () => {
  const r = state.questionarioAtual;
  if (!r || !state.alunaAtual) return;

  const pesoInicial = numeroDoTexto(r.peso_atual);
  const altura = alturaEmMetros(r.altura_atual);
  const quilosPerder = numeroDoTexto(r.quilos_perder);
  const metaPeso = (pesoInicial != null && quilosPerder != null) ? Math.round((pesoInicial - quilosPerder) * 100) / 100 : null;

  if (pesoInicial == null && altura == null && metaPeso == null) {
    toast("Não há peso, altura ou meta nesse questionário.", true);
    return;
  }

  const payload = {};
  if (pesoInicial != null) payload.peso_inicial = pesoInicial;
  if (altura != null) payload.altura = altura;
  if (metaPeso != null) payload.meta_peso = metaPeso;

  const { error } = await sb.from("alunas").update(payload).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro ao atualizar: " + error.message, true); return; }

  // se ela ainda não tem nenhuma pesagem registrada, já lança essa como a primeira
  if (pesoInicial != null) {
    const { count } = await sb.from("pesos").select("id", { count: "exact", head: true }).eq("aluna_id", state.alunaAtual.id);
    if (!count) {
      await sb.from("pesos").insert({
        aluna_id: state.alunaAtual.id,
        peso: pesoInicial,
        // usa o dia em que ela respondeu o formulário, não o dia de hoje
        data: dataDoCarimbo(r.data_resposta) || hoje(),
        observacao: "Peso informado no questionário",
      });
    }
  }

  toast("Peso, altura e meta atualizados com base no questionário!");
  await abrirAluna(state.alunaAtual.id);
});

$("#btn-usar-queixas-questionario").addEventListener("click", async () => {
  const r = state.questionarioAtual;
  if (!r || !state.alunaAtual) return;
  const texto = resumoQueixasQuestionario(r);
  if (!texto) { toast("Não há queixas/observações nesse questionário.", true); return; }
  const { error } = await sb.from("alunas").update({ queixas_iniciais: texto }).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro ao atualizar queixas: " + error.message, true); return; }
  toast("Queixas iniciais atualizadas com base no questionário!");
  await abrirAluna(state.alunaAtual.id);
});

$("#btn-usar-restricao-questionario").addEventListener("click", async () => {
  const r = state.questionarioAtual;
  if (!r || !state.alunaAtual) return;
  const texto = [r.alergia_alimento, r.alimento_nao_come].filter(Boolean).join(" · ");
  if (!texto) { toast("Não há informação de alergia/restrição nesse questionário.", true); return; }
  const { error } = await sb.from("alunas").update({ restricoes: texto }).eq("id", state.alunaAtual.id);
  if (error) { toast("Erro ao atualizar restrições: " + error.message, true); return; }
  toast("Restrições atualizadas com base no questionário!");
  await abrirAluna(state.alunaAtual.id);
});

$("#btn-excluir-questionario").addEventListener("click", async () => {
  if (!state.questionarioAtual) return;
  if (!confirm("Excluir o questionário dessa aluna? Isso não apaga o cadastro dela, só a resposta importada.")) return;
  const { error } = await sb.from("respostas_questionario").delete().eq("id", state.questionarioAtual.id);
  if (error) { toast("Erro ao excluir: " + error.message, true); return; }
  toast("Questionário excluído.");
  await carregarQuestionario(state.alunaAtual.id);
});

// ------------------------------------------------------------
// PLANO ALIMENTAR (calculadora de macros — especificação Dieta MSS)
// ------------------------------------------------------------
const FATORES_ATIVIDADE = { sedentaria: 1.2, leve: 1.375, moderada: 1.55, alta: 1.725 };
const NOME_ATIVIDADE = {
  sedentaria: "Sedentária", leve: "Leve (1 a 3x/semana)",
  moderada: "Moderada (3 a 5x/semana)", alta: "Alta (5 a 6x/semana ou 2x ao dia)",
};

const PISO_CALORICO = 1200;
const PISO_PROTEINA_KG = 1.2;
const PISO_GORDURA_KG = 0.4;
const FRACAO_GORDURA_DEDICADA = 0.7;

const DISTRIBUICAO_PADRAO = [
  { nome: "Café da manhã", pct: 30 },
  { nome: "Almoço", pct: 50 },
  { nome: "Lanche da tarde ou Jantar", pct: 20 },
];

const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);
// número no padrão brasileiro (vírgula no decimal), pra tela e pro PDF
const nBR = (n) => String(n).replace(".", ",");

// o coração do cálculo: recebe os dados e devolve os macros do dia,
// a divisão por refeição e a lista de avisos
function calcularPlano(entrada) {
  const {
    idade, peso, alturaCm, atividade = "leve",
    modo = "manual", metaManual = null,
    proteinaPorKg = 1.3, fatorGordura = 0.8,
    reservaFruta = 130, distribuicao = DISTRIBUICAO_PADRAO,
    carboMinimo = 20,
  } = entrada;

  const avisos = [];

  // conferência de sanidade: se um desses estiver fora da faixa, o cálculo todo
  // sai errado (foi o que aconteceu quando uma altura entrou como 15900 cm)
  if (alturaCm && (alturaCm < 120 || alturaCm > 220)) {
    avisos.push({ tipo: "atencao", texto: `A altura de ${nBR(alturaCm)} cm está fora do esperado. Confira o campo: precisa ser em centímetros, tipo 159.` });
  }
  if (peso && (peso < 30 || peso > 300)) {
    avisos.push({ tipo: "atencao", texto: `O peso de ${nBR(peso)} kg está fora do esperado. Confira o campo.` });
  }
  if (idade && (idade < 18 || idade > 99)) {
    avisos.push({ tipo: "atencao", texto: `A idade de ${nBR(idade)} anos está fora do esperado. Confira o campo.` });
  }

  const bmr = 10 * peso + 6.25 * alturaCm - 5 * idade - 161;
  const fator = FATORES_ATIVIDADE[atividade] ?? FATORES_ATIVIDADE.leve;
  const tdee = bmr * fator;

  const alturaM = alturaCm / 100;
  const imc = peso / (alturaM * alturaM);
  let pesoCalculo = peso;
  let usouPesoAjustado = false;
  if (imc >= 35) {
    const ibw = 45.5 + 0.9 * (alturaCm - 152);
    pesoCalculo = ibw + 0.4 * (peso - ibw);
    usouPesoAjustado = true;
    avisos.push({ tipo: "info", texto: `IMC ${nBR(r1(imc))} (obesidade grau II/III): proteína e gordura calculadas sobre o peso ajustado de ${nBR(r1(pesoCalculo))} kg. Vale recomendar acompanhamento médico em paralelo.` });
  }

  let meta;
  if (modo === "manual") {
    meta = Number(metaManual) || 0;
  } else {
    if (usouPesoAjustado && imc >= 40) meta = Math.max(PISO_CALORICO, r0(tdee - 675));
    else if (atividade === "alta") meta = Math.min(1650, Math.max(1400, r0(tdee - 900)));
    else if (atividade === "sedentaria") meta = Math.min(1300, Math.max(1200, r0(tdee - 375)));
    else meta = 1300;
    meta = Math.max(PISO_CALORICO, meta);
  }

  if (meta < PISO_CALORICO) {
    avisos.push({ tipo: "atencao", texto: `A meta de ${r0(meta)} kcal está abaixo do piso de segurança de ${PISO_CALORICO} kcal. Dá pra seguir assim, mas confira se é isso mesmo.` });
  }

  let protKg = Number(proteinaPorKg);
  if (protKg < PISO_PROTEINA_KG) {
    avisos.push({ tipo: "atencao", texto: `Proteína de ${nBR(protKg)} g/kg está abaixo do piso de ${nBR(PISO_PROTEINA_KG)} g/kg. Subi pro piso automaticamente.` });
    protKg = PISO_PROTEINA_KG;
  }
  const proteinaG = protKg * pesoCalculo;

  const carboDe = (fg) => (meta - reservaFruta - proteinaG * 4 - (fg * pesoCalculo) * 9) / 4;

  let fg = Number(fatorGordura);
  let carboG = carboDe(fg);
  let reduziu = false;
  while (carboG < carboMinimo && fg - 0.1 >= PISO_GORDURA_KG - 1e-9) {
    fg = Math.round((fg - 0.1) * 10) / 10;
    carboG = carboDe(fg);
    reduziu = true;
  }
  if (reduziu) {
    avisos.push({ tipo: "info", texto: `O carboidrato ficaria abaixo de ${carboMinimo} g/dia, então reduzi a gordura de ${nBR(fatorGordura)} para ${nBR(fg)} g/kg pra viabilizar.` });
  }
  // compara arredondado pra não avisar por diferença de casa decimal (129,7 vs 130)
  if (r0(carboG) < carboMinimo) {
    avisos.push({ tipo: "atencao", texto: `Mesmo com a gordura no piso de ${nBR(PISO_GORDURA_KG)} g/kg o carboidrato ficou em ${r0(carboG)} g/dia, abaixo de ${carboMinimo} g. Suba a meta calórica pra resolver — nunca reduza a proteína.` });
  }

  const gorduraG = fg * pesoCalculo;

  const somaPct = distribuicao.reduce((s, d) => s + Number(d.pct || 0), 0);
  if (Math.abs(somaPct - 100) > 0.5) {
    avisos.push({ tipo: "atencao", texto: `Os percentuais das refeições somam ${nBR(r1(somaPct))}%, não 100%. Ajuste pra fechar a conta.` });
  }

  const carboUtil = Math.max(0, carboG);
  const refeicoes = distribuicao.map(d => {
    const f = Number(d.pct || 0) / 100;
    const gordRef = gorduraG * f;
    return {
      nome: d.nome, pct: Number(d.pct || 0),
      proteina: r1(proteinaG * f),
      gordura: r1(gordRef),
      gorduraDedicada: r1(gordRef * FRACAO_GORDURA_DEDICADA),
      carbo: r1(carboUtil * f),
      kcal: r0(proteinaG * f * 4 + gordRef * 9 + carboUtil * f * 4),
    };
  });

  return {
    bmr: r0(bmr), tdee: r0(tdee), fatorAtividade: fator,
    imc: r1(imc), pesoCalculo: r1(pesoCalculo), usouPesoAjustado,
    meta: r0(meta), proteinaPorKg: protKg, fatorGordura: fg, reservaFruta: Number(reservaFruta),
    proteinaG: r1(proteinaG), gorduraG: r1(gorduraG), carboG: r1(carboUtil),
    kcalProteina: r0(proteinaG * 4), kcalGordura: r0(gorduraG * 9), kcalCarbo: r0(carboUtil * 4),
    kcalTotal: r0(proteinaG * 4 + gorduraG * 9 + carboUtil * 4 + Number(reservaFruta)),
    refeicoes, avisos,
  };
}

// Seção 6: procura medicamentos e condições de risco no que já está cadastrado
const REGRAS_SEGURANCA = [
  {
    termos: ["dapagliflozin", "empagliflozin", "canagliflozin", "gliflozin", "sglt2", "forxiga", "jardiance", "xigduo"],
    carboMinimo: 130,
    texto: "Inibidor de SGLT2 detectado. O carboidrato não pode ficar abaixo de ~130 g/dia (risco de cetoacidose com dieta pobre em carboidrato). Já subi o mínimo pra 130 g. Validar com o médico antes de liberar o plano.",
  },
  {
    termos: ["varfarina", "warfarin", "marevan", "anticoagul"],
    texto: "Anticoagulante detectado. A ingestão de vitamina K (folhosos verdes) precisa ser constante, não variável. Isso não é automatizável — confirmar com o médico.",
  },
  {
    termos: ["infarto", "iam", "insuficiência cardíaca", "insuficiencia cardiaca", "cardíac", "cardiac", "stent", "ponte de safena"],
    texto: "Histórico cardíaco detectado. Priorizar peixe e frango sobre carne vermelha, moderar gema de ovo e evitar déficit agressivo. Não citar o diagnóstico no documento da aluna.",
  },
];

function checarSeguranca(aluna, questionario) {
  const texto = [
    aluna?.queixas_iniciais, aluna?.restricoes, aluna?.evolucao,
    questionario?.medicamentos, questionario?.suplementos,
  ].filter(Boolean).join(" \n ");

  const alvo = semAcento(texto);
  const achados = [];
  let carboMinimo = 20;

  REGRAS_SEGURANCA.forEach(regra => {
    if (regra.termos.some(t => alvo.includes(semAcento(t)))) {
      achados.push({ tipo: "atencao", texto: regra.texto });
      if (regra.carboMinimo) carboMinimo = Math.max(carboMinimo, regra.carboMinimo);
    }
  });

  const temMedicacao = (questionario?.medicamentos || "").trim();
  const pareceNegativa = /^(n[aã]o|nenhum|nada|-)/i.test(temMedicacao);
  if (temMedicacao && !pareceNegativa && achados.length === 0) {
    achados.push({ tipo: "info", texto: `Ela usa medicação contínua ("${temMedicacao.slice(0, 80)}") que não está na minha lista de regras. Confira possíveis interações alimentares antes de liberar o plano.` });
  }

  return { achados, carboMinimo };
}

// ---- estado e leitura do formulário ----
function distribuicaoDoFormulario() {
  // $all devolve NodeList, que não tem .map — por isso o Array.from
  return Array.from($all("#plano-distribuicao .linha-refeicao")).map(el => ({
    nome: el.querySelector(".ref-nome").value.trim() || "Refeição",
    pct: Number(el.querySelector(".ref-pct").value) || 0,
  }));
}

function renderDistribuicao(lista) {
  $("#plano-distribuicao").innerHTML = lista.map((d, i) => `
    <div class="linha-refeicao">
      <input type="text" class="ref-nome" value="${escapeAtributo(d.nome)}" placeholder="Nome da refeição">
      <input type="number" class="ref-pct" value="${d.pct}" min="0" max="100" step="5">
      <span class="ref-pct-sinal">%</span>
      ${lista.length > 1 ? `<button type="button" class="btn-icone excluir ref-remover" data-i="${i}" title="Remover">🗑️</button>` : ""}
    </div>
  `).join("");

  $all("#plano-distribuicao input").forEach(inp => inp.addEventListener("input", recalcularPlano));
  $all(".ref-remover").forEach(btn => btn.addEventListener("click", () => {
    const atual = distribuicaoDoFormulario();
    atual.splice(Number(btn.dataset.i), 1);
    renderDistribuicao(atual);
    recalcularPlano();
  }));
}

function preencherFormularioPlano() {
  const a = state.alunaAtual;
  if (!a) return;

  const ultimo = state.planosAluna?.[0] || null;

  $("#plano-idade").value = ultimo?.idade ?? "";
  $("#plano-peso").value = state.ultimoPesoFicha ?? a.peso_inicial ?? "";
  const alturaM = alturaEmMetros(a.altura);
  $("#plano-altura").value = alturaM ? r0(alturaM * 100) : (ultimo?.altura_cm ?? "");
  $("#plano-atividade").value = ultimo?.atividade || "leve";
  $("#plano-modo").value = ultimo?.modo || "manual";
  $("#plano-meta").value = ultimo?.meta_calorica ?? 1300;
  $("#plano-prot-kg").value = ultimo?.proteina_por_kg ?? 1.3;
  $("#plano-fator-gordura").value = ultimo?.fator_gordura ?? 0.8;
  $("#plano-reserva-fruta").value = ultimo?.reserva_fruta ?? 130;
  $("#plano-observacoes").value = "";

  state.cardapio = {};
  const seguranca = checarSeguranca(a, state.questionarioAtual);
  state.segurancaPlano = seguranca;
  $("#plano-carbo-minimo").value = ultimo?.carbo_minimo ?? seguranca.carboMinimo;

  renderDistribuicao(ultimo?.distribuicao || DISTRIBUICAO_PADRAO);
  recalcularPlano();
}

function recalcularPlano() {
  const a = state.alunaAtual;
  if (!a) return;

  const modo = $("#plano-modo").value;
  $("#campo-meta-manual").style.display = modo === "manual" ? "" : "none";

  const entrada = {
    idade: Number($("#plano-idade").value),
    peso: Number($("#plano-peso").value),
    alturaCm: Number($("#plano-altura").value),
    atividade: $("#plano-atividade").value,
    modo,
    metaManual: Number($("#plano-meta").value),
    proteinaPorKg: Number($("#plano-prot-kg").value),
    fatorGordura: Number($("#plano-fator-gordura").value),
    reservaFruta: Number($("#plano-reserva-fruta").value),
    carboMinimo: Number($("#plano-carbo-minimo").value) || 20,
    distribuicao: distribuicaoDoFormulario(),
  };

  const faltando = [];
  if (!entrada.idade) faltando.push("idade");
  if (!entrada.peso) faltando.push("peso");
  if (!entrada.alturaCm) faltando.push("altura");
  if (faltando.length) {
    $("#plano-tdee").textContent = "-";
    $("#plano-resultado").innerHTML = `<p class="vazio">Preencha ${faltando.join(", ")} pra ver o cálculo.</p>`;
    state.planoCalculado = null;
    // os alertas de medicação continuam visíveis mesmo sem o cálculo pronto
    renderAlertasPlano(state.segurancaPlano?.achados || []);
    return;
  }

  const res = calcularPlano(entrada);
  state.planoCalculado = { entrada, ...res };

  $("#plano-tdee").textContent = `${res.tdee} kcal/dia`;
  if (modo !== "manual") $("#plano-meta").value = res.meta;

  renderAlertasPlano([...(state.segurancaPlano?.achados || []), ...res.avisos]);
  renderResultadoPlano(res);
  renderMontagemRefeicoes();
}

function renderAlertasPlano(lista) {
  const cont = $("#plano-alertas");
  if (!lista.length) { cont.innerHTML = ""; return; }
  cont.innerHTML = lista.map(a => `
    <div class="alerta ${a.tipo === "atencao" ? "atencao" : "info"}">${a.texto}</div>
  `).join("");
}

function renderResultadoPlano(res) {
  $("#plano-resultado").innerHTML = `
    <div class="plano-macros">
      <div class="macro-card">
        <span class="macro-label">Meta do dia</span>
        <span class="macro-valor">${res.meta} kcal</span>
        <span class="macro-extra">${res.reservaFruta} kcal reservados pra fruta</span>
      </div>
      <div class="macro-card">
        <span class="macro-label">Proteína</span>
        <span class="macro-valor">${nBR(res.proteinaG)} g</span>
        <span class="macro-extra">${nBR(res.proteinaPorKg)} g/kg · ${res.kcalProteina} kcal</span>
      </div>
      <div class="macro-card">
        <span class="macro-label">Gordura</span>
        <span class="macro-valor">${nBR(res.gorduraG)} g</span>
        <span class="macro-extra">${nBR(res.fatorGordura)} g/kg · ${res.kcalGordura} kcal</span>
      </div>
      <div class="macro-card">
        <span class="macro-label">Carboidrato</span>
        <span class="macro-valor">${nBR(res.carboG)} g</span>
        <span class="macro-extra">o que sobra · ${res.kcalCarbo} kcal</span>
      </div>
    </div>

    <p class="ajuda-campo">IMC ${nBR(res.imc)} · peso usado no cálculo ${nBR(res.pesoCalculo)} kg${res.usouPesoAjustado ? " (ajustado)" : ""} · soma dos macros + fruta: ${res.kcalTotal} kcal</p>

    <table class="tabela-plano">
      <thead>
        <tr><th>Refeição</th><th>%</th><th>Proteína</th><th>Gordura</th><th>Gordura no prato</th><th>Carboidrato</th><th>kcal</th></tr>
      </thead>
      <tbody>
        ${res.refeicoes.map(r => `
          <tr>
            <td>${r.nome}</td><td>${r.pct}%</td>
            <td>${nBR(r.proteina)} g</td><td>${nBR(r.gordura)} g</td>
            <td>${nBR(r.gorduraDedicada)} g</td><td>${nBR(r.carbo)} g</td><td>${r.kcal}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <p class="ajuda-campo">"Gordura no prato" é o item visível (azeite, abacate, mix de sementes): 70% da gordura da refeição. Os outros 30% já vêm dos alimentos proteicos.</p>
  `;
}

// ------------------------------------------------------------
// MONTAGEM DAS REFEIÇÕES (Fase 2)
// ------------------------------------------------------------
// Você marca quais alimentos essa aluna pode ter em cada refeição, e o sistema
// calcula a quantidade de cada um pra bater a meta daquela categoria.
// A mesma quantidade vale na receita e na tabela de substituição, que é a regra
// de consistência da Seção 7 da especificação.
// Entre os marcados, os botões 1 e 2 dizem quais entram na Opção 1 e na Opção 2.

const MACRO_DA_CATEGORIA = { proteina: "proteina_100g", carbo: "carbo_100g", gordura: "gordura_100g" };
const ROTULO_MACRO = { proteina: "Proteína", carbo: "Carboidrato", gordura: "Gordura" };
const CATEGORIAS = ["proteina", "carbo", "gordura"];

async function carregarAlimentos() {
  if (state.alimentos && state.alimentos.length) return state.alimentos;
  const { data, error } = await sb.from("alimentos").select("*").eq("ativo", true).order("nome");
  if (error) { toast("Erro ao carregar a lista de alimentos: " + error.message, true); return []; }
  state.alimentos = data || [];
  return state.alimentos;
}

function alimentoPorId(id) {
  return (state.alimentos || []).find(a => a.id === id) || null;
}

function alimentosDe(categoria, chaveRefeicao) {
  return (state.alimentos || []).filter(a => {
    if (a.categoria !== categoria) return false;
    const permitidas = (a.refeicoes || "todas").trim();
    if (permitidas === "todas") return true;
    return permitidas.split(",").map(s => s.trim()).includes(chaveRefeicao);
  });
}

// transforma gramas em texto prático: "4 unidades (200 g)", "2 fatias", "1 colher de sopa"
function porcaoTexto(alimento, gramas) {
  if (!isFinite(gramas) || gramas <= 0) return "-";
  const nome = semAcento(alimento.nome);
  const un = Number(alimento.unidade_g) || 0;

  if (un > 0 && (nome.includes("pao") || nome.includes("wrap"))) {
    const fatias = Math.max(1, Math.round(gramas / un));
    const palavra = nome.includes("wrap") ? "unidade" : "fatia";
    return `${fatias} ${palavra}${fatias > 1 ? "s" : ""}`;
  }
  if (un > 0 && nome.includes("azeite")) {
    const colheres = gramas / un;
    if (colheres < 1.3) return "1 colher de sopa";
    if (colheres < 2.3) return "1 a 2 colheres de sopa";
    return `${Math.round(colheres)} colheres de sopa`;
  }
  if (un > 0 && nome.includes("ovo")) {
    const uni = Math.max(1, Math.round(gramas / un));
    return `${uni} unidade${uni > 1 ? "s" : ""} (${r0(uni * un)} g)`;
  }
  if (un > 0) {
    const uni = Math.max(1, Math.round(gramas / un));
    return `${uni} unidade${uni > 1 ? "s" : ""} (≈${r0(gramas)} g)`;
  }
  return `${r0(gramas)} g`;
}

// gramas desse alimento que entregam o alvo do macro da categoria dele
function gramasPara(alimento, categoria, alvoG) {
  const densidade = Number(alimento[MACRO_DA_CATEGORIA[categoria]]) || 0;
  if (densidade <= 0) return 0;
  return (alvoG * 100) / densidade;
}

function porcaoPara(alimento, categoria, alvoG) {
  const gramas = gramasPara(alimento, categoria, alvoG);
  return { gramas, texto: porcaoTexto(alimento, gramas) };
}

function chaveRefeicao(nome, indice, total) {
  const n = semAcento(nome);
  if (n.includes("cafe") || n.includes("manha")) return "cafe";
  if (n.includes("almoco")) return "almoco";
  if (n.includes("lanche") || n.includes("jantar") || n.includes("ceia")) return "lanche";
  return indice === 0 ? "cafe" : (indice === total - 1 ? "lanche" : "almoco");
}

// gordura aqui é a do item visível no prato (70%), como na especificação
function metasDaRefeicao(ref) {
  return { proteina: ref.proteina, carbo: ref.carbo, gordura: ref.gorduraDedicada };
}

// margem de tolerância: dentro disso o macro está fechado.
// 8% ou 3 gramas, o que for maior — porque em número pequeno (gordura de 11 g)
// uma diferença de 1 grama não muda nada na prática.
function margemDoMacro(alvo) {
  return Math.max(3, alvo * 0.08);
}

function estaOk(atual, alvo) {
  return Math.abs(atual - alvo) <= margemDoMacro(alvo);
}

// o selo verde/amarelo que diz de bate-pronto se aquele macro fechou
function selo(rotulo, atual, alvo) {
  if (estaOk(atual, alvo)) {
    return `<span class="selo ok">✅ ${rotulo} ok</span>`;
  }
  const d = atual - alvo;
  const palavra = d > 0 ? "acima" : "abaixo";
  return `<span class="selo ${d > 0 ? "acima" : "abaixo"}">⚠️ ${rotulo} ${nBR(r1(Math.abs(d)))} g ${palavra}</span>`;
}

// soma os macros de verdade dos alimentos de uma opção, só pra te mostrar
// quanto a refeição realmente entrega (não é isso que define as quantidades)
function somaRealDaOpcao(itens) {
  const t = { proteina: 0, carbo: 0, gordura: 0 };
  itens.forEach(({ alimento, gramas }) => {
    const f = gramas / 100;
    t.proteina += (Number(alimento.proteina_100g) || 0) * f;
    t.carbo += (Number(alimento.carbo_100g) || 0) * f;
    t.gordura += (Number(alimento.gordura_100g) || 0) * f;
  });
  t.kcal = t.proteina * 4 + t.carbo * 4 + t.gordura * 9;
  return t;
}

// assinatura das metas: mudou peso, calorias ou ajustes, as quantidades mudam junto
function assinaturaDasMetas() {
  const c = state.planoCalculado;
  if (!c) return "";
  return c.refeicoes.map(r => `${r.nome}:${r.proteina}:${r.carbo}:${r.gorduraDedicada}`).join("|");
}

// estado de uma refeição: o que está marcado e quem é a Opção 1 e a Opção 2.
// Começa com os alimentos "principais" marcados e uma escolha padrão pras opções.
function estadoDaRefeicao(refIdx, chave) {
  state.cardapio = state.cardapio || {};
  if (state.cardapio[refIdx]) return state.cardapio[refIdx];

  const preferidos = {
    proteina: { cafe: ["Ovo inteiro", "Iogurte grego"], almoco: ["Frango grelhado", "Peixe branco"], lanche: ["Ovo inteiro", "Frango desfiado"] },
    carbo: { cafe: ["Pão 100% integral", "Aveia em flocos"], almoco: ["Arroz integral", "Batata doce"], lanche: ["Pão 100% integral", "Batata doce"] },
    gordura: { cafe: ["Abacate", "Amêndoas"], almoco: ["Amêndoas", "Azeite de oliva"], lanche: ["Abacate", "Amêndoas"] },
  };

  const marcados = [];
  const opcoes = [{}, {}];
  CATEGORIAS.forEach(cat => {
    const lista = alimentosDe(cat, chave);
    lista.filter(a => a.principal).forEach(a => marcados.push(a.id));
    [0, 1].forEach(pos => {
      const desejado = preferidos[cat]?.[chave]?.[pos];
      const alim = (desejado && lista.find(a => semAcento(a.nome).startsWith(semAcento(desejado))))
        || lista.filter(a => a.principal)[pos] || lista[pos] || lista[0];
      if (alim) {
        opcoes[pos][cat] = alim.id;
        if (!marcados.includes(alim.id)) marcados.push(alim.id);
      }
    });
  });

  state.cardapio[refIdx] = { marcados, opcoes };
  return state.cardapio[refIdx];
}

function itensDaOpcao(refIdx, pos, chave, metas) {
  const est = estadoDaRefeicao(refIdx, chave);
  return CATEGORIAS.map(cat => {
    const id = est.opcoes[pos]?.[cat];
    const alimento = id ? alimentoPorId(id) : null;
    if (!alimento) return null;
    return { alimento, categoria: cat, gramas: gramasPara(alimento, cat, metas[cat]) };
  }).filter(Boolean);
}

function renderMontagemRefeicoes() {
  const cont = $("#plano-cardapio");
  const calc = state.planoCalculado;
  if (!cont) return;
  if (!calc) { cont.innerHTML = `<p class="vazio">Preencha os dados da aluna pra montar o cardápio.</p>`; return; }
  if (!(state.alimentos || []).length) { cont.innerHTML = `<p class="vazio">Rode a migração v18 no Supabase pra carregar a lista de alimentos.</p>`; return; }

  // se as metas mudaram, as quantidades mudam; as marcações continuam valendo
  const assinatura = assinaturaDasMetas();
  if (state.cardapioAssinatura !== assinatura) state.cardapioAssinatura = assinatura;

  const total = calc.refeicoes.length;
  cont.innerHTML = calc.refeicoes.map((ref, i) => {
    const chave = chaveRefeicao(ref.nome, i, total);
    const metas = metasDaRefeicao(ref);
    const est = estadoDaRefeicao(i, chave);

    const categorias = CATEGORIAS.map(cat => {
      const lista = alimentosDe(cat, chave);
      const linhas = lista.map(a => {
        const marcado = est.marcados.includes(a.id);
        const eh1 = est.opcoes[0]?.[cat] === a.id;
        const eh2 = est.opcoes[1]?.[cat] === a.id;
        const p = porcaoPara(a, cat, metas[cat]);
        return `
          <div class="linha-alimento ${marcado ? "" : "desmarcado"}">
            <label class="alim-check">
              <input type="checkbox" data-ref="${i}" data-cat="${cat}" data-id="${a.id}" class="chk-alimento" ${marcado ? "checked" : ""}>
              <span class="alim-nome">${a.nome}${a.origem === "taco" ? ' <span class="tag-conferir" title="Valor da tabela padrão, ainda não conferido por vocês">a conferir</span>' : ""}</span>
            </label>
            <span class="alim-qtd">${p.texto}</span>
            <span class="alim-opcoes">
              <button type="button" class="btn-op ${eh1 ? "ativo" : ""}" data-ref="${i}" data-cat="${cat}" data-id="${a.id}" data-pos="0" title="Usar na Opção 1">1</button>
              <button type="button" class="btn-op ${eh2 ? "ativo" : ""}" data-ref="${i}" data-cat="${cat}" data-id="${a.id}" data-pos="1" title="Usar na Opção 2">2</button>
            </span>
          </div>`;
      }).join("");

      return `
        <div class="grupo-categoria">
          <div class="grupo-cabecalho">
            <strong>${ROTULO_MACRO[cat]}</strong>
            <span>meta ${nBR(r1(metas[cat]))} g${cat === "gordura" ? " no prato" : ""}</span>
          </div>
          ${linhas || `<p class="vazio">Nenhum alimento dessa categoria liberado nessa refeição.</p>`}
        </div>`;
    }).join("");

    const resumoOpcoes = [0, 1].map(pos => {
      const itens = itensDaOpcao(i, pos, chave, metas);
      if (!itens.length) return `<div class="resumo-opcao"><strong>Opção ${pos + 1}</strong><span class="vazio">nada escolhido</span></div>`;
      const real = somaRealDaOpcao(itens);
      const alvos = { proteina: ref.proteina, carbo: ref.carbo, gordura: ref.gordura };
      const selos = CATEGORIAS.map(cat => selo(ROTULO_MACRO[cat], real[cat], alvos[cat])).join("");
      const tudoOk = CATEGORIAS.every(cat => estaOk(real[cat], alvos[cat]));
      return `
        <div class="resumo-opcao ${tudoOk ? "opcao-ok" : ""}">
          <div class="resumo-opcao-topo">
            <strong>Opção ${pos + 1}</strong>
            <span class="resumo-kcal">${r0(real.kcal)} kcal</span>
          </div>
          <div class="selos">${selos}</div>
          <span class="resumo-itens">${itens.map(it => `${it.alimento.nome}: ${porcaoTexto(it.alimento, it.gramas)}`).join(" · ")}</span>
        </div>`;
    }).join("");

    return `
      <div class="bloco-refeicao">
        <h4>${ref.nome} <span class="bloco-ref-meta">meta: P ${nBR(ref.proteina)}g · C ${nBR(ref.carbo)}g · G ${nBR(ref.gordura)}g · ${ref.kcal} kcal</span></h4>
        <div class="grupos-categoria">${categorias}</div>
        <p class="nota-salada">🥗 Salada de folhas verdes e vegetais de baixa caloria entram <strong>à vontade</strong> nessa refeição. Vão automáticos no PDF, não precisam ser marcados.</p>
        <div class="resumo-opcoes">${resumoOpcoes}</div>
      </div>`;
  }).join("");

  ligarEventosMontagem();
}

function ligarEventosMontagem() {
  $all(".chk-alimento").forEach(chk => chk.addEventListener("change", () => {
    const { ref, cat, id } = chk.dataset;
    const est = state.cardapio[ref];
    if (chk.checked) {
      if (!est.marcados.includes(id)) est.marcados.push(id);
    } else {
      est.marcados = est.marcados.filter(x => x !== id);
      // se estava sendo usado numa opção, tira de lá também
      [0, 1].forEach(pos => { if (est.opcoes[pos]?.[cat] === id) delete est.opcoes[pos][cat]; });
    }
    renderMontagemRefeicoes();
  }));

  $all(".btn-op").forEach(btn => btn.addEventListener("click", () => {
    const { ref, cat, id, pos } = btn.dataset;
    const est = state.cardapio[ref];
    // clicar de novo no mesmo tira; escolher outro troca
    if (est.opcoes[pos]?.[cat] === id) {
      delete est.opcoes[pos][cat];
    } else {
      est.opcoes[pos] = est.opcoes[pos] || {};
      est.opcoes[pos][cat] = id;
      if (!est.marcados.includes(id)) est.marcados.push(id);
    }
    renderMontagemRefeicoes();
  }));
}

// monta os dados do documento: opções, substituições (só o que você marcou),
// frutas e vegetais
function montarDocumento() {
  const calc = state.planoCalculado;
  const total = calc.refeicoes.length;

  const refeicoes = calc.refeicoes.map((ref, i) => {
    const chave = chaveRefeicao(ref.nome, i, total);
    const metas = metasDaRefeicao(ref);
    const est = estadoDaRefeicao(i, chave);

    const opcoes = [0, 1].map(pos => ({
      titulo: `Opção ${pos + 1}`,
      itens: itensDaOpcao(i, pos, chave, metas)
        .map(it => ({ nome: it.alimento.nome, quantidade: porcaoTexto(it.alimento, it.gramas) })),
    })).filter(o => o.itens.length);

    const substituicoes = CATEGORIAS.map(cat => ({
      categoria: ROTULO_MACRO[cat],
      itens: alimentosDe(cat, chave)
        .filter(a => est.marcados.includes(a.id))
        .map(a => ({ nome: a.nome, quantidade: porcaoPara(a, cat, metas[cat]).texto })),
    })).filter(s => s.itens.length);

    return { nome: ref.nome, chave, opcoes, substituicoes };
  });

  const frutas = (state.alimentos || []).filter(a => a.categoria === "fruta");
  const vegs = (state.alimentos || []).filter(a => a.categoria === "vegetal");
  // duas listas separadas, como no documento de vocês: a base da salada e o resto
  const folhosos = vegs.filter(a => a.grupo === "folhoso");
  const baixaCaloria = vegs.filter(a => a.grupo !== "folhoso");

  return { refeicoes, frutas, folhosos, baixaCaloria };
}

// ---- salvar / histórico ----
async function carregarPlanos() {
  if (!state.alunaAtual) return;
  const { data, error } = await sb.from("planos_alimentares")
    .select("*")
    .eq("aluna_id", state.alunaAtual.id)
    .order("data", { ascending: false });
  if (error) { toast("Erro ao carregar planos: " + error.message, true); return; }
  state.planosAluna = data || [];
  renderListaPlanos();
}

function renderListaPlanos() {
  const cont = $("#lista-planos");
  const lista = state.planosAluna || [];
  if (lista.length === 0) {
    cont.innerHTML = `<p class="vazio">Nenhum plano gerado ainda.</p>`;
    return;
  }
  cont.innerHTML = lista.map(p => `
    <div class="linha-entrega">
      <span>${fmtData(p.data)}</span>
      <strong>${r0(p.meta_calorica)} kcal</strong>
      <span class="obs">P ${r0(p.proteina_g)}g · G ${r0(p.gordura_g)}g · C ${r0(p.carbo_g)}g${p.observacoes ? " · " + p.observacoes : ""}</span>
      <span class="acoes-linha">
        <button class="btn-icone plano-reabrir" data-id="${p.id}" title="Carregar esses números no formulário">↩️</button>
        <button class="btn-icone excluir plano-excluir" data-id="${p.id}" title="Excluir">🗑️</button>
      </span>
      ${htmlAnexos("plano", p.id)}
    </div>
  `).join("");

  $all(".plano-reabrir").forEach(btn => btn.addEventListener("click", () => {
    const p = (state.planosAluna || []).find(x => x.id === btn.dataset.id);
    if (!p) return;
    $("#plano-idade").value = p.idade ?? "";
    $("#plano-peso").value = p.peso ?? "";
    $("#plano-altura").value = p.altura_cm ?? "";
    $("#plano-atividade").value = p.atividade || "leve";
    $("#plano-modo").value = p.modo || "manual";
    $("#plano-meta").value = p.meta_calorica ?? 1300;
    $("#plano-prot-kg").value = p.proteina_por_kg ?? 1.3;
    $("#plano-fator-gordura").value = p.fator_gordura ?? 0.8;
    $("#plano-reserva-fruta").value = p.reserva_fruta ?? 130;
    $("#plano-carbo-minimo").value = p.carbo_minimo ?? 20;
    $("#plano-observacoes").value = p.observacoes || "";
    renderDistribuicao(p.distribuicao || DISTRIBUICAO_PADRAO);
    recalcularPlano();
    toast("Números do plano carregados no formulário.");
  }));

  $all(".plano-excluir").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Excluir esse plano do histórico? A entrega lançada continua registrada.")) return;
    const { error } = await sb.from("planos_alimentares").delete().eq("id", btn.dataset.id);
    if (error) { toast("Erro ao excluir: " + error.message, true); return; }
    toast("Plano excluído.");
    await carregarPlanos();
  }));
}

$("#btn-salvar-plano").addEventListener("click", async () => {
  const calc = state.planoCalculado;
  const a = state.alunaAtual;
  if (!calc || !a) { toast("Preencha idade, peso e altura primeiro.", true); return; }

  const hojeStr = hoje();
  const obs = $("#plano-observacoes").value.trim();

  // lança a entrega automaticamente, sem você precisar digitar nada lá
  const { data: entrega, error: erroEntrega } = await sb.from("entregas").insert({
    aluna_id: a.id,
    item: `Plano alimentar (${calc.meta} kcal)`,
    data_entrega: hojeStr,
    observacao: obs || `P ${r0(calc.proteinaG)}g · G ${r0(calc.gorduraG)}g · C ${r0(calc.carboG)}g`,
  }).select().single();
  if (erroEntrega || !entrega) {
    toast("Erro ao lançar a entrega: " + (erroEntrega?.message || "não consegui registrar"), true);
    return;
  }

  const { error } = await sb.from("planos_alimentares").insert({
    aluna_id: a.id,
    data: hojeStr,
    idade: calc.entrada.idade,
    peso: calc.entrada.peso,
    altura_cm: calc.entrada.alturaCm,
    atividade: calc.entrada.atividade,
    modo: calc.entrada.modo,
    meta_calorica: calc.meta,
    proteina_por_kg: calc.proteinaPorKg,
    fator_gordura: calc.fatorGordura,
    reserva_fruta: calc.reservaFruta,
    carbo_minimo: calc.entrada.carboMinimo,
    distribuicao: calc.entrada.distribuicao,
    bmr: calc.bmr, tdee: calc.tdee, imc: calc.imc, peso_calculo: calc.pesoCalculo,
    proteina_g: calc.proteinaG, gordura_g: calc.gorduraG, carbo_g: calc.carboG,
    refeicoes: calc.refeicoes,
    avisos: [...(state.segurancaPlano?.achados || []), ...calc.avisos],
    observacoes: obs || null,
    entrega_id: entrega.id,
  });
  if (error) { toast("Erro ao salvar o plano: " + error.message, true); return; }

  toast("Plano salvo e lançado em Entregas!");
  await carregarPlanos();
  await carregarEntregas();
});

// ---- PDF (abre a versão de impressão; no diálogo é só escolher "Salvar como PDF") ----
$("#btn-pdf-plano").addEventListener("click", () => {
  const calc = state.planoCalculado;
  const a = state.alunaAtual;
  if (!calc || !a) { toast("Preencha idade, peso e altura primeiro.", true); return; }

  const doc = montarDocumento();
  const linhas = calc.refeicoes.map((r, i) => `
    <tr class="${i % 2 ? "par" : ""}">
      <td>${r.nome}</td>
      <td>${nBR(r.proteina)} g</td>
      <td>${nBR(r.carbo)} g</td>
      <td>${nBR(r.gorduraDedicada)} g</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Plano Alimentar - ${a.nome}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; color: #241019; margin: 0; }
  .banner { background: #6E0F1F; color: #fff; padding: 22px 24px; border-radius: 6px; margin-bottom: 22px; }
  .banner h1 { margin: 0; font-size: 19pt; letter-spacing: .5px; }
  .banner p { margin: 4px 0 0; font-size: 12pt; opacity: .92; }
  .dados { margin-bottom: 20px; font-size: 11.5pt; }
  .dados span { display: inline-block; margin-right: 22px; }
  h2 { color: #6E0F1F; font-size: 13pt; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #6E0F1F; color: #fff; text-align: left; padding: 8px 10px; font-size: 11pt; }
  td { padding: 8px 10px; border-bottom: 1px solid #E4D8C4; }
  tr.par td { background: #F3ECDA; }
  .nota { font-size: 10.5pt; color: #5c4a52; margin-top: 4px; }
  h3 { color: #6E0F1F; font-size: 12pt; margin: 18px 0 6px; }
  .op-titulo { font-weight: bold; margin: 10px 0 4px; font-size: 11pt; }
  .quebra { page-break-before: always; }
  .vazio-preencher { color: #8a7680; font-style: italic; }
</style></head><body>
  <div class="banner">
    <h1>Menopausa Sem Sofrimento</h1>
    <p>Plano Alimentar Individual</p>
  </div>

  <div class="dados">
    <span><strong>Nome:</strong> ${a.nome}</span>
    <span><strong>Peso:</strong> ${calc.entrada.peso} kg</span>
    <span><strong>Altura:</strong> ${(calc.entrada.alturaCm / 100).toFixed(2).replace(".", ",")} m</span>
    <span><strong>Data:</strong> ${fmtData(hoje())}</span>
  </div>

  <h2>Metas por refeição</h2>
  <table>
    <thead><tr><th>Refeição</th><th>Proteína</th><th>Carboidrato</th><th>Gordura no prato</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <p class="nota">A gordura indicada é a do item visível no prato (azeite, abacate, oleaginosa ou mix de sementes). Fruta opcional, até 2 por dia, sempre após uma refeição.</p>

  <h2>Refeições do dia</h2>
  ${doc.refeicoes.map(ref => `
    <h3>${ref.nome}</h3>
    ${ref.opcoes.map(op => `
      <p class="op-titulo">${op.titulo}</p>
      <table>
        <thead><tr><th style="width:62%">Alimento</th><th>Quantidade</th></tr></thead>
        <tbody>
          ${op.itens.map((it, k) => `<tr class="${k % 2 ? "par" : ""}"><td>${it.nome}</td><td>${it.quantidade}</td></tr>`).join("")}
          <tr class="${op.itens.length % 2 ? "par" : ""}"><td>Salada de folhas verdes</td><td>à vontade</td></tr>
        </tbody>
      </table>`).join("")}
  `).join("")}

  <h2>Fruta (opcional, até 2 por dia)</h2>
  <table>
    <thead><tr><th style="width:62%">Alimento</th><th>Quantidade</th></tr></thead>
    <tbody>
      ${doc.frutas.map((f, k) => `<tr class="${k % 2 ? "par" : ""}"><td>${f.nome}</td><td>${f.porcao_fixa || "-"}${f.observacao ? " (" + f.observacao + ")" : ""}</td></tr>`).join("")}
    </tbody>
  </table>

  <div class="quebra"></div>

  <h2>Tabela de substituição por horário</h2>
  <p class="nota">Use para trocar um alimento por outro dentro da mesma refeição. Cada linha equivale à mesma quantidade de macronutriente.</p>
  ${doc.refeicoes.map(ref => `
    <h3>${ref.nome}</h3>
    <table>
      <thead><tr><th style="width:22%">Categoria</th><th style="width:48%">Alimento</th><th>Quantidade</th></tr></thead>
      <tbody>
        ${ref.substituicoes.map(sub => sub.itens.map((it, k) => `
          <tr class="${k % 2 ? "par" : ""}">
            <td>${k === 0 ? sub.categoria : ""}</td><td>${it.nome}</td><td>${it.quantidade}</td>
          </tr>`).join("")).join("")}
      </tbody>
    </table>
    ${ref.chave === "almoco" ? '<p class="nota">Sem abacate no almoço. Regra fixa do programa.</p>' : ""}
  `).join("")}

  <div class="quebra"></div>

  <h2>Listas complementares</h2>
  ${doc.folhosos.length ? `
    <h3>Vegetais folhosos verdes crus (base da salada, à vontade)</h3>
    <p>${doc.folhosos.map(v => v.nome).join(", ")}.</p>` : ""}
  ${doc.baixaCaloria.length ? `
    <h3>Vegetais de baixa caloria (à vontade)</h3>
    <p>${doc.baixaCaloria.map(v => v.nome).join(", ")}.</p>` : ""}
  <p class="nota">Salada de folhas verdes cruas sempre à vontade, temperada com vinagre de maçã. Chá à vontade após todas as refeições.</p>

  <p class="nota">Documento gerado pelo sistema Menopausa Sem Sofrimento em ${fmtData(hoje())}.</p>
  <script>window.onload = () => window.print();<\/script>
</body></html>`;

  const janela = window.open("", "_blank");
  if (!janela) { toast("O navegador bloqueou a janela. Libere os pop-ups deste site e tente de novo.", true); return; }
  janela.document.write(html);
  janela.document.close();
});

// recalcula ao mexer em qualquer campo
["#plano-idade", "#plano-peso", "#plano-altura", "#plano-atividade", "#plano-modo",
 "#plano-meta", "#plano-prot-kg", "#plano-fator-gordura", "#plano-reserva-fruta", "#plano-carbo-minimo"]
  .forEach(sel => {
    const el = $(sel);
    el.addEventListener("input", recalcularPlano);
    el.addEventListener("change", recalcularPlano);
  });

$("#btn-add-refeicao").addEventListener("click", () => {
  const atual = distribuicaoDoFormulario();
  atual.push({ nome: "Nova refeição", pct: 10 });
  renderDistribuicao(atual);
  recalcularPlano();
});


// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
initAuth();
