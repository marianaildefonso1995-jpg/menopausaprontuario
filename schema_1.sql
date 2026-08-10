-- ============================================================
-- Menopausa Sem Sofrimentos - Prontuário de Alunas
-- Schema do banco de dados (Supabase / Postgres)
-- ============================================================
-- Versão consolidada (equivale a schema.sql + migracao_v2 até
-- v12 juntos). Use este arquivo se um dia precisar recriar o
-- banco do zero num projeto Supabase novo — ele já cria tudo
-- na estrutura atual, sem precisar rodar as migrações antigas
-- uma por uma.
--
-- Se o seu banco já existe e já está atualizado (rodou todas as
-- migrações até a v12), NÃO precisa rodar este arquivo — ele é
-- só a "fotografia" de como o banco deveria estar.
--
-- Como usar (banco novo): cole este arquivo inteiro no SQL Editor
-- do seu projeto Supabase ("SQL Editor" > "New query") e clique
-- em "Run".
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- TURMAS
-- ------------------------------------------------------------
create table if not exists turmas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  data_inicio_acesso date not null default current_date, -- início da contagem de acesso/pesagem
  data_fim date,                                          -- vazio = acesso vitalício (sem prazo)
  intervalo_pesagem_dias int,                             -- de quantos em quantos dias a turma pesa
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ALUNAS
-- ------------------------------------------------------------
create table if not exists alunas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text,
  telefone text,
  turma_id uuid references turmas(id) on delete set null,

  data_entrada date not null default current_date,

  peso_inicial numeric,
  meta_peso numeric,
  altura numeric,
  objetivo text not null default 'emagrecimento', -- emagrecimento | manutencao | hipertrofia
  fase text not null default 'programa',           -- programa | manutencao
  status text not null default 'ativa',            -- ativa | pausada | concluida

  queixas_iniciais text,   -- resumo da avaliação/anamnese inicial
  evolucao text,           -- observações de evolução, atualizadas ao longo do acompanhamento
  restricoes text,         -- alergias / restrições alimentares / observações de dieta

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- HISTÓRICO DE PESO
-- ------------------------------------------------------------
create table if not exists pesos (
  id uuid primary key default gen_random_uuid(),
  aluna_id uuid not null references alunas(id) on delete cascade,
  data date not null default current_date,
  peso numeric not null,
  observacao text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- EXAMES: pedidos em "levas" numeradas, cada uma com os exames
-- marcados; cada exame já tem resultado (texto) e data de
-- entrega direto na mesma linha.
-- ------------------------------------------------------------
create table if not exists pedidos_exame (
  id uuid primary key default gen_random_uuid(),
  aluna_id uuid not null references alunas(id) on delete cascade,
  data date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists itens_pedido_exame (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos_exame(id) on delete cascade,
  nome_exame text not null,
  resultado text,
  data_entrega date,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RECEITAS (suplementos / orientações receitadas)
-- ------------------------------------------------------------
create table if not exists receitas (
  id uuid primary key default gen_random_uuid(),
  aluna_id uuid not null references alunas(id) on delete cascade,
  item text not null,
  data date not null default current_date,
  observacao text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ENTREGAS (materiais / bônus / o que a aluna já recebeu)
-- ------------------------------------------------------------
create table if not exists entregas (
  id uuid primary key default gen_random_uuid(),
  aluna_id uuid not null references alunas(id) on delete cascade,
  item text not null,
  data_entrega date not null default current_date,
  observacao text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CALENDÁRIO (eventos, opcionalmente vinculados a uma turma)
-- ------------------------------------------------------------
create table if not exists eventos_calendario (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid references turmas(id) on delete set null,
  titulo text not null,
  data date not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CLUBINHO DA MENOPAUSA (um cadastro por mês)
-- ------------------------------------------------------------
create table if not exists clubinho (
  id uuid primary key default gen_random_uuid(),
  ano int not null,
  mes int not null check (mes between 1 and 12),
  data date,
  tema text,
  convidado text,
  created_at timestamptz not null default now(),
  unique (ano, mes)
);

-- ------------------------------------------------------------
-- QUESTIONÁRIO (respostas importadas do Google Forms)
-- ------------------------------------------------------------
create table if not exists respostas_questionario (
  id uuid primary key default gen_random_uuid(),
  aluna_id uuid references alunas(id) on delete set null,
  turma_id uuid references turmas(id) on delete set null,
  chave_importacao text not null unique,

  nome_respondente text,
  email_respondente text,
  telefone_respondente text,
  data_resposta text,

  peso_atual text,
  altura_atual text,
  quilos_perder text,
  manequim text,
  medicamentos text,
  suplementos text,
  atividade_fisica text,
  fumante text,
  alcool text,
  sono_como text,
  horas_sono text,
  acorda_disposta text,
  vontade_doce text,
  banheiro_vezes text,
  banheiro_frequencia text,
  alergia_alimento text,
  alimento_nao_come text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- LEMBRETES IGNORADOS (Visão Geral)
-- ------------------------------------------------------------
create table if not exists lembretes_ignorados (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  chave text not null,
  created_at timestamptz not null default now(),
  unique (tipo, chave)
);

-- ------------------------------------------------------------
-- Trigger para manter "updated_at" da aluna sempre atualizado
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_alunas_updated_at on alunas;
create trigger trg_alunas_updated_at
before update on alunas
for each row execute function set_updated_at();

-- ============================================================
-- SEGURANÇA (RLS) - só usuários logados podem ver e editar.
--
-- Atenção: essa regra dá acesso total (ler/editar/apagar tudo)
-- pra QUALQUER usuário autenticado no seu projeto Supabase. Hoje
-- só você tem login, então tudo bem. Se um dia você criar login
-- pra uma assistente/estagiária, ela vai poder ver e apagar
-- tudo — nesse caso, me avisa que ajustamos a regra pra
-- restringir por usuário.
-- ============================================================
alter table turmas enable row level security;
alter table alunas enable row level security;
alter table pesos enable row level security;
alter table pedidos_exame enable row level security;
alter table itens_pedido_exame enable row level security;
alter table receitas enable row level security;
alter table entregas enable row level security;
alter table eventos_calendario enable row level security;
alter table clubinho enable row level security;
alter table respostas_questionario enable row level security;
alter table lembretes_ignorados enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['turmas','alunas','pesos','pedidos_exame','itens_pedido_exame','receitas','entregas','eventos_calendario','clubinho','respostas_questionario','lembretes_ignorados']
  loop
    execute format('drop policy if exists "auth full access" on %I', t);
    execute format('create policy "auth full access" on %I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t);
  end loop;
end $$;

-- ============================================================
-- STORAGE (bucket para anexos, caso volte a usar no futuro)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

drop policy if exists "auth read anexos" on storage.objects;
create policy "auth read anexos" on storage.objects
  for select using (bucket_id = 'anexos' and auth.role() = 'authenticated');

drop policy if exists "auth upload anexos" on storage.objects;
create policy "auth upload anexos" on storage.objects
  for insert with check (bucket_id = 'anexos' and auth.role() = 'authenticated');

drop policy if exists "auth update anexos" on storage.objects;
create policy "auth update anexos" on storage.objects
  for update using (bucket_id = 'anexos' and auth.role() = 'authenticated');

drop policy if exists "auth delete anexos" on storage.objects;
create policy "auth delete anexos" on storage.objects
  for delete using (bucket_id = 'anexos' and auth.role() = 'authenticated');

-- ============================================================
-- Turmas iniciais (só entra se a tabela estiver vazia)
-- ============================================================
insert into turmas (nome) values ('Turma 1'), ('Turma 2')
on conflict do nothing;
