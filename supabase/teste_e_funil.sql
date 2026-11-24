-- Cinesiomecânica: teste grátis de 3 dias e funil de visitas da página de vendas
-- Rodar uma vez no SQL Editor do Supabase. Só acrescenta coisas; não muda o que já existe.

-- ===== Teste grátis =====
-- Quem entra com e-mail confirmado ganha 3 dias. Um teste por pessoa, com três travas:
--  1) o e-mail é "normalizado": joao.silva+2@gmail.com conta como joaosilva@gmail.com;
--  2) e-mails descartáveis (mailinator, temp-mail…) não ganham teste;
--  3) cada navegador/aparelho só ganha um teste (marca aleatória guardada no aparelho);
--  4) cada número de celular só ganha um teste (celular brasileiro válido, com DDD).
-- O acesso vale pela mesma regra de sempre (tem_acesso olha valido_ate em assinantes).
create or replace function public.email_normal(e text) returns text
language sql immutable as $$
  select case
    when split_part(lower(e), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(e), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(e), '@', 1), '+', 1) || '@' || split_part(lower(e), '@', 2)
  end $$;

create or replace function public.email_descartavel(e text) returns boolean
language sql immutable as $$
  select split_part(lower(e), '@', 2) = any (array[
    'mailinator.com', 'yopmail.com', 'yopmail.net', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
    'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net', '10minemail.com', 'temp-mail.org',
    'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com', 'tempail.com',
    'tempr.email', 'emailondeck.com', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc',
    'mailnesia.com', 'mintemail.com', 'mohmal.com', 'throwawaymail.com', 'trashmail.com', 'trashmail.de',
    'fakeinbox.com', 'spamgourmet.com', 'mytemp.email', 'emailfake.com', 'fakemail.net', 'mail.tm',
    'mail.gw', 'inboxkitten.com', 'burnermail.io', 'tmail.ws', 'tmpmail.org', 'tmpmail.net',
    'dropmail.me', '10mail.org', 'emltmp.com', 'crazymailing.com', 'byom.de', 'discard.email',
    'mailpoof.com', 'linshiyouxiang.net', 'firemailbox.club', 'cs.email', 'vomoto.com', 'luxusmail.org',
    'minuteinbox.com', 'mailcatch.com', 'spambox.us', 'tempinbox.com', 'owlymail.com'
  ]) $$;

-- celular brasileiro: devolve só os 11 dígitos (DDD + 9 + número) ou null se não parecer um celular de verdade
create or replace function public.celular_normal(t text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  if length(d) = 13 and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) = 12 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) <> 11 then return null; end if;
  if left(d, 2) <> all (string_to_array('11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99', ',')) then return null; end if;
  if substr(d, 3, 1) <> '9' then return null; end if;
  if substr(d, 4) ~ '^(\d)\1+$' or substr(d, 4) in ('12345678', '87654321') then return null; end if;
  return d;
end $$;

-- quem já usou teste (e-mail normalizado, marca do aparelho ou celular; ninguém lê esta tabela pelo site)
create table if not exists public.testes_usados (
  chave text primary key,
  tipo text not null check (tipo in ('email', 'aparelho', 'telefone')),
  em timestamptz not null default now()
);
alter table public.testes_usados drop constraint if exists testes_usados_tipo_check;
alter table public.testes_usados add constraint testes_usados_tipo_check check (tipo in ('email', 'aparelho', 'telefone'));
alter table public.testes_usados add column if not exists email text;
alter table public.testes_usados enable row level security;
revoke all on public.testes_usados from anon, authenticated;

drop function if exists public.comecar_teste();
drop function if exists public.comecar_teste(text);
create or replace function public.comecar_teste(aparelho text default null, telefone text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(coalesce(auth.jwt()->>'email', ''));
  n text;
  ap text := nullif(left(coalesce(aparelho, ''), 40), '');
  conf timestamptz;
  meta jsonb;
  tel text;
  r public.assinantes;
  fim timestamptz := now() + interval '3 days';
begin
  if e = '' then return jsonb_build_object('ok', false, 'motivo', 'sem_login'); end if;
  select email_confirmed_at, raw_user_meta_data into conf, meta from auth.users where id = auth.uid();
  if conf is null then return jsonb_build_object('ok', false, 'motivo', 'nao_confirmado'); end if;
  select * into r from public.assinantes where email = e;
  if found then
    return jsonb_build_object('ok', r.valido_ate > now(),
      'motivo', case when r.valido_ate > now() then 'ja_tem' else 'ja_usou' end,
      'plano', r.plano, 'valido_ate', r.valido_ate);
  end if;
  if public.email_descartavel(e) then return jsonb_build_object('ok', false, 'motivo', 'descartavel'); end if;
  n := public.email_normal(e);
  if exists (select 1 from public.testes_usados where chave = 'e:' || n)
     or exists (select 1 from public.assinantes where public.email_normal(email) = n)
    then return jsonb_build_object('ok', false, 'motivo', 'ja_usou'); end if;
  if ap is not null and exists (select 1 from public.testes_usados where chave = 'a:' || ap)
    then return jsonb_build_object('ok', false, 'motivo', 'aparelho'); end if;
  if coalesce(telefone, '') = '' and coalesce(meta->>'telefone', '') = '' then return jsonb_build_object('ok', false, 'motivo', 'sem_telefone'); end if;
  tel := public.celular_normal(coalesce(nullif(telefone, ''), meta->>'telefone'));
  if tel is null then return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido'); end if;
  if exists (select 1 from public.testes_usados where chave = 't:' || tel)
    then return jsonb_build_object('ok', false, 'motivo', 'telefone'); end if;
  insert into public.testes_usados (chave, tipo, email) values ('t:' || tel, 'telefone', e) on conflict do nothing;
  insert into public.testes_usados (chave, tipo) values ('e:' || n, 'email') on conflict do nothing;
  if ap is not null then insert into public.testes_usados (chave, tipo) values ('a:' || ap, 'aparelho') on conflict do nothing; end if;
  insert into public.assinantes (email, plano, valido_ate, origem, obs)
    values (e, 'teste', fim, 'teste', 'Teste grátis de 3 dias');
  return jsonb_build_object('ok', true, 'motivo', 'comecou', 'plano', 'teste', 'valido_ate', fim);
end $$;
revoke all on function public.comecar_teste(text, text) from public, anon;
grant execute on function public.comecar_teste(text, text) to authenticated;

-- ===== Funil (estatística anônima, sem cookies) =====
-- Cada aba do navegador ganha um código aleatório (sessao) que some quando a aba fecha.
-- Não guarda e-mail, nome nem IP: só o passo do funil, a página e de onde a pessoa veio.
create table if not exists public.eventos (
  id bigserial primary key,
  em timestamptz not null default now(),
  sessao text not null check (char_length(sessao) between 8 and 40),
  evento text not null check (evento in (
    'visita', 'rolou_meio', 'viu_planos', 'clicou_teste', 'clicou_assinar', 'abriu_pix', 'gerou_pix',
    'abriu_cadastro', 'criou_conta', 'comecou_teste', 'abriu_atlas', 'voltou_pagamento')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 40),
  origem text check (origem is null or char_length(origem) <= 40),
  aparelho text check (aparelho is null or aparelho in ('celular', 'computador'))
);
create index if not exists eventos_em on public.eventos (em);
alter table public.eventos enable row level security;
grant insert on public.eventos to anon, authenticated;
grant usage on sequence public.eventos_id_seq to anon, authenticated;
grant select on public.eventos to authenticated;
drop policy if exists "qualquer um registra" on public.eventos;
create policy "qualquer um registra" on public.eventos for insert to anon, authenticated with check (true);
drop policy if exists "admin ve eventos" on public.eventos;
create policy "admin ve eventos" on public.eventos for select to authenticated using (public.eh_admin());

-- resumo do funil para o painel: quantas sessões chegaram a cada passo, no período e na origem pedidos
create or replace function public.funil(desde timestamptz, ate timestamptz default now(), so_origem text default null)
returns table (evento text, sessoes bigint)
language sql stable security definer set search_path = public as $$
  select e.evento, count(distinct e.sessao)
  from public.eventos e
  where public.eh_admin() and e.em >= desde and e.em < ate
    and (so_origem is null or e.sessao in (
      select v.sessao from public.eventos v where v.evento = 'visita' and v.origem = so_origem and v.em >= desde and v.em < ate))
  group by e.evento;
$$;
revoke all on function public.funil(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.funil(timestamptz, timestamptz, text) to authenticated;
