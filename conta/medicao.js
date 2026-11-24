// Medição da Cinesiomecânica
// 1) Funil próprio e anônimo (tabela "eventos" no Supabase): sem cookies, sem e-mail, sem IP.
// 2) Pixel da Meta, só se PIXEL_ID estiver preenchido E a pessoa aceitar no aviso de cookies.
// Uso nas páginas: window.cm('evento', 'detalhe') — funciona antes deste arquivo carregar (fila window.cmq).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Cole aqui o número do pixel criado no Gerenciador de Eventos da Meta (só números). Vazio = pixel desligado.
export const PIXEL_ID = '';

const CONSENT = 'cm_cookies';   // 'sim' | 'nao'
const ss = (() => { try { return sessionStorage; } catch (_) { return null; } })();
const ls = (() => { try { return localStorage; } catch (_) { return null; } })();

// código da aba (some quando a aba fecha)
let sessao = ss && ss.getItem('cm_s');
if (!sessao) { sessao = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24); ss && ss.setItem('cm_s', sessao); }

// de onde veio: guardado na primeira página da aba
const P = new URLSearchParams(location.search);
let origem = ss && ss.getItem('cm_o');
if (!origem) {
  const ref = document.referrer || '';
  origem = P.get('utm_source') || (P.has('fbclid') ? 'anuncio-meta' : '')
    || (/instagram\./.test(ref) ? 'instagram' : /facebook\./.test(ref) ? 'facebook' : /google\./.test(ref) ? 'google' : /tiktok\./.test(ref) ? 'tiktok' : ref && !ref.includes(location.host) ? 'outro-site' : 'direto');
  origem = origem.toLowerCase().slice(0, 40); ss && ss.setItem('cm_o', origem);
}
const aparelho = (matchMedia('(pointer:coarse)').matches || innerWidth < 900) ? 'celular' : 'computador';
const local = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.hostname.endsWith('.test');
const jaFoi = new Set(JSON.parse((ss && ss.getItem('cm_f')) || '[]'));   // cada passo conta uma vez por aba

function gravar(evento, detalhe) {
  const chave = evento + '|' + (detalhe || '');
  if (jaFoi.has(chave)) return; jaFoi.add(chave); ss && ss.setItem('cm_f', JSON.stringify([...jaFoi]));
  const corpo = { sessao, evento, detalhe: detalhe ? String(detalhe).slice(0, 40) : null, origem: evento === 'visita' ? origem : null, aparelho };
  if (local || window.__cmSemFunil) { console.debug('[funil]', corpo); return; }
  fetch(SUPABASE_URL + '/rest/v1/eventos', {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(corpo)
  }).catch(() => { });
}

// ===== Pixel da Meta (com consentimento) =====
const META = { viu_planos: ['ViewContent', { content_name: 'planos' }], clicou_teste: ['Lead'], clicou_assinar: ['InitiateCheckout'], abriu_pix: ['InitiateCheckout'],
  criou_conta: ['CompleteRegistration'], comecou_teste: ['StartTrial', { value: 0, currency: 'BRL' }] };
let fbqPronto = false;
function ligarPixel() {
  if (fbqPronto || !PIXEL_ID) return; fbqPronto = true;
  /* código padrão da Meta */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID); fbq('track', 'PageView');
}
function pixel(evento, detalhe) {
  if (!fbqPronto) return; const m = META[evento]; if (!m) return;
  const extra = Object.assign({}, m[1] || {});
  if (detalhe && (evento === 'clicou_assinar' || evento === 'abriu_pix')) { extra.content_name = detalhe; extra.currency = 'BRL'; extra.value = { mensal: 15, semestral: 60, anual: 100 }[detalhe] || 0; }
  fbq('track', m[0], extra);
}

function aviso() {
  if (!PIXEL_ID || (ls && ls.getItem(CONSENT))) return;
  const d = document.createElement('div'); d.id = 'cmCookies'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Aviso de cookies');
  d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;max-width:560px;margin:0 auto;background:#141b31;border:1.5px solid #263153;border-radius:18px;padding:14px 16px;box-shadow:0 18px 50px #000b;color:#f2f4fa;font:14px/1.45 "Instrument Sans",system-ui,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  d.innerHTML = '<p style="flex:1 1 260px;margin:0;color:#aeb7cf">Usamos cookies da Meta para medir nossos anúncios no Instagram. Você pode recusar sem perder nada no site. <a href="/privacidade/#cookies" style="color:#ffb938">Saiba mais</a></p>'
    + '<div style="display:flex;gap:8px;margin-left:auto"><button type="button" data-c="nao" style="font:inherit;font-weight:700;cursor:pointer;padding:10px 16px;border-radius:999px;background:#10162a;color:#f2f4fa;border:1.5px solid #263153">Recusar</button>'
    + '<button type="button" data-c="sim" style="font:inherit;font-weight:700;cursor:pointer;padding:10px 18px;border-radius:999px;background:#ffb938;color:#1a1203;border:0">Aceitar</button></div>';
  d.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; ls && ls.setItem(CONSENT, b.dataset.c); d.remove(); if (b.dataset.c === 'sim') { ligarPixel(); historico.forEach(([e, x]) => pixel(e, x)); } });
  document.body.appendChild(d);
}

const historico = [];
export function cm(evento, detalhe) { gravar(evento, detalhe); historico.push([evento, detalhe]); pixel(evento, detalhe); }
// para a página de privacidade: mudar a escolha
export function mudarCookies() { ls && ls.removeItem(CONSENT); location.reload(); }

if (PIXEL_ID && ls && ls.getItem(CONSENT) === 'sim') ligarPixel();
const fila = window.cmq || []; window.cm = cm; window.cmq = { push: a => cm(...a) };
fila.forEach(a => cm(...a));
if (!window.__cmSemAviso) { if (document.body) aviso(); else addEventListener('DOMContentLoaded', aviso); }
