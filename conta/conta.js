// Conta e acesso da Cinesiomecânica (Supabase)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export async function usuario() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

// true se a pessoa tem assinatura válida (ou é administradora)
export async function temAcesso() {
  const { data, error } = await sb.rpc('tem_acesso');
  if (error) { console.error(error); return false; }
  return !!data;
}

export async function ehAdmin() {
  const { data, error } = await sb.rpc('eh_admin');
  if (error) return false;
  return !!data;
}

export async function minhaAssinatura() {
  const u = await usuario(); if (!u) return null;
  const { data } = await sb.from('assinantes').select('*').eq('email', (u.email || '').toLowerCase()).maybeSingle();
  return data;
}

// conteúdo protegido (fichas e textos), guardado no cofre privado
export async function carregarDados() {
  const { data, error } = await sb.storage.from('conteudo').download('dados.json');
  if (error) throw error;
  return JSON.parse(await data.text());
}

export async function sair(destino = '/') { await sb.auth.signOut(); location.href = destino; }

// teste grátis de 3 dias (uma vez por e-mail confirmado). Devolve { ok, motivo, plano, valido_ate }
// marca aleatória deste navegador: o mesmo aparelho só ganha um teste, mesmo trocando de e-mail
export function marcaAparelho() {
  try {
    let m = localStorage.getItem('cm_ap');
    if (!m) { m = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 32); localStorage.setItem('cm_ap', m); }
    return m;
  } catch (e) { return null; }
}
export async function comecarTeste(telefone) {
  const { data, error } = await sb.rpc('comecar_teste', { aparelho: marcaAparelho(), telefone: telefone || null });
  if (error) { console.error(error); return { ok: false, motivo: 'erro', erro: error.message }; }
  return data;
}

// celular brasileiro com DDD: devolve 11 dígitos ou null (a mesma regra é conferida no servidor)
const DDDS = new Set('11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99'.split(','));
export function celularNormal(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 11 || !DDDS.has(d.slice(0, 2)) || d[2] !== '9') return null;
  const r = d.slice(3); if (/^(\d)\1+$/.test(r) || r === '12345678' || r === '87654321') return null;
  return d;
}
