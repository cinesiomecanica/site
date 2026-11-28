import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DADOS = window.__DADOS;
const E = DADOS.e, INFO = DADOS.info;
// Z-Anatomy: as malhas das partes ascendente (inferior) e descendente (superior) do trapézio vêm com os nomes trocados,
// e as áreas de origem/inserção também. TROCA: nome no modelo -> nome certo (só se os dados ainda tiverem o erro).
const TROCA = {};
for (const l of ['r', 'l']) {
  const A = 'Ascending part of trapezius muscle', D = 'Descending part of trapezius muscle';
  if (!E[`${A}.e${l}`] || E[`${D}.e${l}`] || !E[`${D}.o${l}`]) continue;
  TROCA[`${A}.${l}`] = `${D}.${l}`; TROCA[`${D}.${l}`] = `${A}.${l}`;
  TROCA[`${A}.e${l}`] = `${D}.o${l}`;   // occipital → origem da parte descendente
  TROCA[`${A}.o${l}`] = `${D}.e${l}`;   // clavícula → inserção da parte descendente
  TROCA[`${D}.o${l}`] = `${A}.e${l}`;   // espinha da escápula → inserção da parte ascendente
  E[`${D}.e${l}`] = { ...E[`${D}.o${l}`], t: 'inserção', n: E[`${D}.o${l}`].n.replace('Origem', 'Inserção') };
  delete E[`${A}.o${l}`];               // origem da parte ascendente (T4–T12) não existe no modelo
}

/* ---------- cena ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
// versão celular: menos pixels por quadro (o celular esquenta menos e a bateria dura mais)
const CEL = () => document.documentElement.classList.contains('cel');
const ajustarPixels = () => renderer.setPixelRatio(Math.min(devicePixelRatio, CEL() ? 1.25 : 2));   // celular em movimento: leve; parado, a imagem é refeita na resolução cheia (NITIDO)
ajustarPixels();
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
const scene = new THREE.Scene(); renderer.setClearColor(0x000000, 0);   // o fundo vem do CSS (gradiente + malha)
const cam = new THREE.PerspectiveCamera(32, 1, 0.02, 30);
const ctl = new OrbitControls(cam, canvas); ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.minDistance = 0.25; ctl.maxDistance = 12; ctl.zoomSpeed = 0.9;
const hemi = new THREE.HemisphereLight('#e6efff', '#3d2622', 1.4); scene.add(hemi);   // por baixo a luz volta avermelhada, como rebatida no próprio tecido
const sol = new THREE.DirectionalLight('#fff6ea', 2.0); sol.position.set(1.5, 3, 2.5); scene.add(sol);   // luz principal: mais suave e levemente quente
const rim = new THREE.DirectionalLight('#a8dcff', 0.9); rim.position.set(-2, 2, -2.5); scene.add(rim);   // contraluz fria, só para recortar a silhueta
const cam_l = new THREE.DirectionalLight('#ffffff', 0.35); cam.add(cam_l); scene.add(cam);
// sombra da luz principal: um músculo faz sombra no outro e o corpo no chão (dá volume e "peso"). O mapa só é refeito quando algo muda de lugar ou de visibilidade.
const SOMBRA = { on: !/[?&]sombra=0/.test(location.search), suja: true, mov: 0, az: 0, arrastando: false, lento: false, t: 0, n: 0 };
if (SOMBRA.on) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = CEL() ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  sol.castShadow = true; sol.target.position.set(0, 0.9, 0); scene.add(sol.target); sol.position.set(1.5, 3.9, 2.5);
  const sc = sol.shadow.camera; sc.left = -1.15; sc.right = 1.15; sc.top = 1.2; sc.bottom = -1.2; sc.near = 0.5; sc.far = 9; sc.updateProjectionMatrix();
  sol.shadow.mapSize.set(CEL() ? 1024 : 2048, CEL() ? 1024 : 2048); sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.006; sol.shadow.radius = 3.5;
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.38 })); chao.rotation.x = -Math.PI / 2; chao.position.y = 0.001; chao.receiveShadow = true; chao.raycast = () => {}; scene.add(chao);
}
const sombrear = () => { SOMBRA.suja = true; };
const NITIDO = { on: false, t: 0, pode: (() => { try { return localStorage.getItem('cm-nitido') !== '0'; } catch (e) { return true; } })() };
canvas.addEventListener('webglcontextlost', () => { if (NITIDO.on) { NITIDO.pode = false; try { localStorage.setItem('cm-nitido', '0'); } catch (e) {} } });   // se o aparelho não aguentar a imagem em resolução cheia, não tenta de novo
// a luz principal acompanha a câmera (sempre de cima, um pouco à direita de quem olha): o modelo fica bem iluminado de frente, de lado e de costas.
// No computador ela gira junto; no celular (ou em máquina lenta) só se acomoda quando o dedo solta, para não refazer a sombra a cada quadro.
ctl.addEventListener('start', () => { SOMBRA.arrastando = true; }); ctl.addEventListener('end', () => { SOMBRA.arrastando = false; sujar(30); });
function luzSegue() {
  const az = Math.atan2(cam.position.x - ctl.target.x, cam.position.z - ctl.target.z); let d = az - SOMBRA.az; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.003) return false;
  const leve = CEL() || SOMBRA.lento; if (leve && (SOMBRA.arrastando || performance.now() - SOMBRA.mov < 220)) return false;   // no celular a luz (e a sombra) só se acomoda com a câmera parada
  SOMBRA.az += !leve || Math.abs(d) < 0.03 ? d : d * 0.35;
  const a = SOMBRA.az + 0.54, b = SOMBRA.az - 2.47; sol.position.set(Math.sin(a) * 2.92, SOMBRA.on ? 3.9 : 3, Math.cos(a) * 2.92); rim.position.set(Math.sin(b) * 3.2, 2, Math.cos(b) * 3.2);
  SOMBRA.suja = true; return true;
}
// intensidades de base; com uma estrutura escolhida, o resto do corpo escurece um pouco (LUZ.k) e ela se destaca
const LUZ = { hemi: 1.4, sol: 2.0, rim: 0.9, cam: 0.35, env: 0, k: 1, alvo: 1 };
function luzAplicar() { hemi.intensity = LUZ.hemi * LUZ.k; sol.intensity = LUZ.sol * LUZ.k; rim.intensity = LUZ.rim * LUZ.k; cam_l.intensity = LUZ.cam * LUZ.k; scene.environmentIntensity = LUZ.env * LUZ.k; }
function luzPasso() { if (SELDIM.value !== SELDIM.alvo) { SELDIM.value += (SELDIM.alvo - SELDIM.value) * 0.25; if (Math.abs(SELDIM.alvo - SELDIM.value) < 0.01 || matchMedia('(prefers-reduced-motion:reduce)').matches) SELDIM.value = SELDIM.alvo; return true; } if (LUZ.k === LUZ.alvo) return false; LUZ.k += (LUZ.alvo - LUZ.k) * 0.22; if (Math.abs(LUZ.alvo - LUZ.k) < 0.004 || matchMedia('(prefers-reduced-motion:reduce)').matches) LUZ.k = LUZ.alvo; luzAplicar(); return true; }
// luz ambiente de estúdio (reflexos suaves e volume nos músculos): mapa de ambiente gerado na própria GPU, sem download
import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
  if (/[?&]env=0/.test(location.search)) return;
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const q = new URLSearchParams(location.search); LUZ.env = +(q.get('envI') || 0.42); LUZ.hemi = +(q.get('hemi') || 0.4); if (q.get('sol')) LUZ.sol = +q.get('sol'); luzAplicar(); sujar();   // o ambiente substitui parte da luz difusa
}).catch(() => {});
// piso sutil
const grid = new THREE.GridHelper(4, 40, '#3a4a7a', '#1c2545'); grid.material.transparent = true; grid.material.opacity = 0.6; scene.add(grid);
let painelAberto = false;
const LST = { aba: 'musculos', q: '', reg: '', cache: {}, rol: 0, de: false };   // lista de estruturas (estado)
// desenha só quando algo muda (economiza bateria): cada interação pede alguns quadros
let suja = 120; const sujar = (n = 50) => { if (suja < n) suja = n; };
for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'click', 'input', 'change', 'keydown', 'touchmove']) addEventListener(t, () => sujar(), { passive: true, capture: true });
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h;
  cam.updateProjectionMatrix(); sujar(); }
addEventListener('resize', resize); resize();
// área da tela onde o modelo fica visível (descontando cabeçalho, painel e barra de abas)
function areaLivre() {
  const W = innerWidth, H = innerHeight;
  if (CEL()) {
    const p = $('painel'), aberto = p && p.classList.contains('on'), tab = ($('tabbar') && $('tabbar').offsetHeight) || 64;
    const folha = !aberto ? 0 : p.classList.contains('min') ? 84 : Math.round(H * 0.46);
    const topo = (($('camadas') && $('camadas').getBoundingClientRect().bottom) || 100) + 6;
    return { x0: 0, x1: W - 58, y0: topo, y1: H - tab - folha - 8 };
  }
  if (W < 900) return { x0: 0, x1: W, y0: 140, y1: H * 0.5 - 66 };
  if (document.documentElement.classList.contains('aula')) {   // modo aula: painel maior; sem painel, o modelo usa a tela toda
    const p = $('painel'), pw = p && p.classList.contains('on') ? p.getBoundingClientRect().width + 32 : 24;
    return { x0: 0, x1: W - pw, y0: 96, y1: H - 84 };
  }
  return { x0: 0, x1: W - 430, y0: 64, y1: H - 64 };
}
addEventListener('versao', () => { ajustarPixels(); resize(); sujar(); });

/* ---------- tema (cores e papéis): fica junto do código para valer mesmo com a página em cache ----------
   quatro níveis de superfície (fundo, painel, cartão, flutuante); dourado = ação principal; verde-água = selecionado e estados; vermelho e azul = origem e inserção */
{ const st = document.createElement('style'); st.id = 'tema'; st.textContent = ':root{--bg:#080c18;--bg2:#19223f;--card:#111830;--line:#2e3a66;--ink:#f3f5fb;--ink2:#c0c8dc;--ink3:#939dba;--ac:#f7b84b;--ax:#3fd8cb;--sel:#3fd8cb;--pop:#222d52;--mus:#a63a35;--osso:#e4dac6;--ori:#f0655a;--ins:#5c9dff}html,body{background:#080c18}.painel{background:#111830f7}.chip{background:#222d52d9;transition:background .15s,border-color .15s,color .15s}.reg .chip,.ferr .chip{background:none}.ferr,.movbar .chip{background:#222d52e8}.movbar{background:none}.toast,.sug{background:#222d52f5}.sug button:hover,.sug button:focus{background:#ffffff12}#aulaBar{background:#222d52f0}html.cel .tabbar{background:#111830f5}.busca input,.vbtn,#bAula{background:#19223fcc}.busca input:focus{border-color:var(--sel)}.vbtn:hover{color:var(--ink);border-color:#4a5a94}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--sel);outline-offset:2px}.reg .chip.on::after{background:var(--sel)}.chips .chip.on{border-color:#4a5a94}.ferr .chip.on,.movbar .chip.on,#aulaBar button.on,html.aula #bAula{background:var(--sel);border-color:var(--sel);color:#04211f}#bTirar.on{background:#ff8a45;border-color:#ff8a45;color:#1a0b02}.seg button,.acoes button,.mfases button{transition:background .15s,border-color .15s,color .15s}.acoes button:hover,.seg button:hover{border-color:#4a5a94}.seg button.on,.mfases button.on{border-color:var(--sel);color:var(--sel);background:#3fd8cb1c}.smcmp .seg button.on{background:#3fd8cb26}.acoes button.pri{background:var(--ac);border-color:var(--ac);color:#1a1203}.acoes button.pri:hover{border-color:#ffd58a}.abas button.on{background:var(--pop)}html.cel .tabbar button.on{color:var(--sel)}html.cel .tabbar button.on svg{filter:drop-shadow(0 0 6px #3fd8cb66)}.p-b a{color:var(--sel)}.mv input[type=range],.pctl input[type=range]{accent-color:var(--sel)}.pctl-t output,.kp.mt4 b{color:var(--ink)}.smcmp{border-color:var(--line)}.oi .o{color:var(--ori)}.oi .e{color:var(--ins)}#rot span{background:#080c18d9}'; document.head.appendChild(st); }
/* ---------- fibras e relevo dos músculos: estado e tabela (as funções ficam mais abaixo, em "fibras musculares") ---------- */
const FIB = { on: false, u: { value: 0 }, leve: { value: 0 }, rel: { value: new THREE.Vector2(+(new URLSearchParams(location.search).get('rel') ?? 0.62), 1 / 230) }, feito: new WeakSet(), pronto: false };   // rel = realce do relevo esculpido no modelo (força, escala)
// Arquitetura dos músculos penados: [tipo, ângulo de penação em graus, face do músculo onde o desenho aparece de frente,
//   e, só nos unipenados, para que lado as fibras caminham ao descer].
// Ângulos: Ward, Eng, Smallwood e Lieber (2009), Clin Orthop Relat Res 467:1074-82, tabela 3 (média de 16 a 21 peças). Tipo: classificação dos livros de anatomia.
// Quem não está aqui é desenhado com as fibras seguindo a forma do músculo (paralelo, fusiforme ou em leque).
const ARQ = {
  'Rectus femoris muscle': ['bi', 13.9, 'ant'], 'Vastus lateralis muscle': ['uni', 18.4, 'ant', 'med'], 'Vastus medialis muscle': ['uni', 29.6, 'ant', 'lat'],
  'Medial head of gastrocnemius': ['uni', 9.9, 'post', 'lat'], 'Lateral head of gastrocnemius': ['uni', 12.0, 'post', 'med'], 'Soleus muscle': ['multi', 28.3, 'post'],
  'Extensor digitorum longus': ['uni', 10.8, 'ant', 'med'],
};
const TENDAO = /tendon|aponeurosis|Iliotibial tract|Linea alba|ligament|intermuscular septum|Iliopectineal arch/i;
const CARTILAGEM = /cartilage|disc\b|meniscus|labrum|symphysis/i;
const SELDIM = { value: 0, alvo: 0 };   // quanto o resto do corpo está apagado (0 a 1) enquanto há uma estrutura escolhida
const APAGA = `
if (uDim > 0.0 && uSelf < 0.5) { float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.55, 0.15)); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum * (0.64 - 0.24 * min(lum, 1.0))) * vec3(0.97, 0.96, 1.07), uDim); }`;
const selU = mat => mat.userData.fibU ? mat.userData.fibU.uSelf : mat.userData.uSelf;
const fibU = m => m.userData.fibU || (m.userData.fibU = { uSelf: { value: 0 }, uFP: { value: new THREE.Vector4(0, 0, 0, 0) }, uFT: { value: new THREE.Vector4(0, 0, 0.3, 0.03) } });
/* ---------- materiais ---------- */
const COR = { ossos: '#e4dac6', musculos: '#a63a35', articulacoes: '#d9c27a' };   // vermelho profundo e uniforme; ossos em marfim
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
function material(nome, camada) {
  const e = E[nome] || {};
  if (camada === 'insercoes') return new THREE.MeshStandardMaterial({ color: e.t === 'origem' ? '#f0655a' : '#5c9dff', roughness: 0.5, emissive: e.t === 'origem' ? '#5a0c08' : '#08214a', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // tecido de cada peça, pelo nome que o modelo traz: tendões, aponeuroses e septos vêm junto dos músculos; cartilagens junto dos ossos; discos e meniscos junto dos ligamentos
  const tendao = camada === 'musculos' && TENDAO.test(e.b || ''), cart = (camada === 'ossos' || camada === 'articulacoes') && CARTILAGEM.test(e.b || '');
  const c = new THREE.Color(tendao ? '#dccfba' : cart ? '#d2dcdd' : COR[camada]);
  const h01 = s => ((hash(s) % 100) + 100) % 100 / 100;
  if (camada === 'musculos' && !tendao) c.offsetHSL((h01(e.b || nome) - 0.5) * 0.012, 0, (h01((e.b || nome) + 'x') - 0.5) * 0.07);   // variação pequena entre vizinhos: separa os músculos sem virar laranja ou rosa
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: tendao ? 0.46 : cart ? 0.5 : camada === 'ossos' ? 0.7 : camada === 'musculos' ? 0.56 : 0.5, metalness: 0 });
  if (camada === 'musculos') { fibMaterial(m); if (tendao) fibU(m).uFP.value.x = 1; }   // tendão: mesmos veios, sem o rosado e sem a faixa clara nas pontas
  else relMaterial(m, camada === 'ossos' ? 0.5 : 0.4);   // ossos, cartilagens e ligamentos: só o realce do relevo
  if (camada === 'musculos') m.side = THREE.DoubleSide;   // malhas abertas (adutores, períneo): sem isso o músculo parece "cortado"
  if (camada === 'articulacoes') { m.transparent = true; m.opacity = 0.85; }
  return m;
}

/* ---------- carregamento por camadas ---------- */
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const CAMADAS = { ossos: null, musculos: null, insercoes: null, articulacoes: null };
const MESH = {};            // nome -> mesh
const visCamada = { ossos: true, musculos: true, insercoes: false, articulacoes: false };
const oculto = new Set();   // ocultados pelo usuário
let isolado = null, soDireito = false, filtroInsercao = null;
function carregar(nome, pct0, pct1) {
  return new Promise((ok, err) => loader.load(`modelo/${nome}.glb`, g => {
    const grp = g.scene; grp.name = nome;
    const J = g.parser.json, A = g.parser.associations;
    const nomeOrig = o => { for (const x of [o, o.parent]) { const a = x && A.get(x); if (a && a.nodes !== undefined) return J.nodes[a.nodes].name.replace(/\.\d{3}$/, ''); } return o.name; };
    grp.traverse(o => { if (o.isMesh) { const n0 = nomeOrig(o), n = TROCA[n0] || n0; if (!E[n]) { o.visible = false; return; } o.name = n; o.material = material(n, nome); o.userData.camada = nome; MESH[n] = o; o.receiveShadow = true; o.castShadow = nome !== 'insercoes'; } });
    scene.add(grp); CAMADAS[nome] = grp; sombrear(); sujar(); ok(grp);
  }, ev => { if (ev.total && $('cBar')) $('cBar').style.width = (pct0 + (pct1 - pct0) * ev.loaded / ev.total) + '%'; }, err));
}
const cargaMusc = carregar('musculos', 35, 90);   // ossos e músculos baixam ao mesmo tempo
await carregar('ossos', 0, 35);
const EIXO = new THREE.Box3().setFromObject(CAMADAS.ossos).getCenter(new THREE.Vector3());   // eixo do corpo (x, z)
$('cTxt').textContent = 'Carregando os músculos…';
await cargaMusc;
$('carga').style.opacity = 0; setTimeout(() => $('carga').remove(), 450);
setTimeout(() => { $('dica').style.opacity = 0; }, 6000);
// camadas extras ficam para quando forem ligadas
async function garantir(c) { if (!CAMADAS[c]) { await carregar(c, 0, 100); } }

/* ---------- visibilidade ---------- */
function aplicarVis() {
  for (const [n, m] of Object.entries(MESH)) {
    const e = E[n] || {}, c = m.userData.camada;
    let v = visCamada[c] && !oculto.has(n);
    if (MOV.on || AG.on) { m.visible = MOV.vis.has(n); continue; }
    if (window.POSE_ON && (c === 'insercoes' || c === 'articulacoes')) { m.visible = false; continue; }
    if (soDireito && e.l === 'esquerdo') v = false;
    if (isolado && c !== 'ossos' && !isolado.has(n) && !(c === 'insercoes' && filtroInsercao)) v = false;
    if (c === 'insercoes' && filtroInsercao) v = visCamada.insercoes && e.b === filtroInsercao && (!soDireito || e.l !== 'esquerdo');
    m.visible = v;
    // mostrando origem/inserção: o músculo fica translúcido para enxergar as marcas no osso
    if (c === 'musculos' && !m.userData.tec0) { const tr = !!filtroInsercao && e.b === filtroInsercao; if (m.material.transparent !== tr) { m.material.transparent = tr; m.material.opacity = tr ? 0.33 : 1; m.material.depthWrite = !tr; m.material.needsUpdate = true; } }
  }
  if (window.POSE_ON) POSE.sinc();
  HULL.sinc(); sombrear();
}
$('camadas').addEventListener('click', async ev => {
  const b = ev.target.closest('.chip'); if (!b) return; const c = b.dataset.c;
  visCamada[c] = !visCamada[c]; b.classList.toggle('on', visCamada[c]);
  if (visCamada[c]) await garantir(c);
  if (c === 'insercoes' && !visCamada[c]) filtroInsercao = null;
  aplicarVis();
});

/* ---------- câmera ---------- */
const anim = { de: null, ate: null, t: 1, t0: 0 };
function voar(alvo, dist, dir = new THREE.Vector3(0.35, 0.12, 1), comPainel = true) {
  const t = new THREE.Vector3(...alvo);
  if (comPainel && (CEL() || innerWidth < 900)) {   // no celular o painel cobre a parte de baixo: sobe o objeto na tela
    const A = areaLivre(); dist *= Math.min(2.6, Math.max(1, 0.72 * innerHeight / (A.y1 - A.y0)));   // a área livre é menor: afasta a câmera para caber
    t.y += ((A.y0 + A.y1) / 2 - innerHeight / 2) * 2 * dist * Math.tan(cam.fov * Math.PI / 360) / innerHeight;
  } else if (comPainel && document.documentElement.classList.contains('aula')) {
    // modo aula no computador: o painel (500 px) cobre a direita, então afasta um pouco e leva o objeto para a área livre
    const W = innerWidth, H = innerHeight, livre = W - 532;
    dist *= Math.min(1.6, Math.max(1, 0.85 * W / livre));
    const wpp = 2 * dist * Math.tan(cam.fov * Math.PI / 360) / H, dx = livre / 2 - W / 2;
    const f = dir.clone().normalize().negate(), r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    t.addScaledVector(r, -dx * wpp);
  }
  const p = t.clone().add(dir.clone().normalize().multiplyScalar(dist));
  anim.de = { t: ctl.target.clone(), p: cam.position.clone() }; anim.ate = { t, p }; anim.t = 0; anim.t0 = performance.now();
}
cam.position.set(1.1, 1.2, 3.55); ctl.target.set(0, 0.9, 0); ctl.update();

function focar(nome, mult = 2.2) {
  const m = MESH[nome]; if (!m) return;
  const bx = new THREE.Box3().setFromObject(m), c = bx.getCenter(new THREE.Vector3()), r = bx.getSize(new THREE.Vector3()).length();
  const d = new THREE.Vector3(c.x - EIXO.x, 0, c.z - EIXO.z); if (d.length() < 0.04) d.copy(cam.position).sub(ctl.target).setY(0);
  d.normalize(); d.y = 0.28;
  voar(c.toArray(), Math.max(0.85, r * mult), d);
}
/* ---------- seleção ---------- */
let sel = null;
// a estrutura escolhida fica na luz cheia, com contorno e brilho de borda verde-água, e o resto do corpo escurece um pouco.
// Três camadas desenhadas por cima dela (nada muda no material, então não interfere nos outros modos):
//   contorno = casca um pouco maior vista por trás; brilho = devolve a luz e acende as bordas; fantasma = silhueta que aparece
//   mesmo atrás de outros músculos (mostra onde fica uma estrutura profunda escolhida pela lista ou pela busca)
const HL = new THREE.Color('#3fd8cb');
const HULL = (() => {
  const uC = { value: new THREE.Color() }, uB = { value: new THREE.Color() };
  const vs = 'uniform float uW; varying float vF;\nvoid main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalMatrix * normal; float ln = length(n); n = ln > 1e-6 ? n / ln : vec3(0.0, 0.0, 1.0); mv.xyz += n * uW * max(0.05, -mv.z); vF = clamp(abs(dot(n, normalize(-mv.xyz))), 0.0, 1.0); gl_Position = projectionMatrix * mv; }';
  const mk = (corpo, o) => new THREE.ShaderMaterial(Object.assign({ uniforms: { uW: { value: 0 }, uC, uB, uK: { value: 1 } }, vertexShader: vs, fragmentShader: 'uniform vec3 uC; uniform vec3 uB; uniform float uK; varying float vF;\nvoid main(){ ' + corpo + ' }', transparent: true, depthWrite: false, toneMapped: false }, o));
  const M = {
    contorno: mk('gl_FragColor = vec4(uC, 0.95);', { side: THREE.BackSide }),
    brilho: mk('float f = clamp(vF, 0.0, 1.0), r = pow(1.0 - f, 2.6); gl_FragColor = vec4(uB * (uK * f) + uC * (0.95 * r + 0.05), 1.0);', { side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    fantasma: mk('float f = clamp(vF, 0.0, 1.0), r = pow(1.0 - f, 1.8); gl_FragColor = vec4(uC, 0.09 + 0.45 * r);', { side: THREE.FrontSide, depthFunc: THREE.GreaterDepth }),   // só onde está encoberta
  };
  const ms = Object.entries(M).map(([k, mt], i) => { const h = new THREE.Mesh(undefined, mt); h.userData.k = k; h.raycast = () => {}; h.renderOrder = 6 + i; h.frustumCulled = false; return h; });
  let linear = null;
  const px = () => { M.contorno.uniforms.uW.value = (CEL() ? 2.6 : 3) * 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, innerHeight); };
  // com a oclusão ligada (computador) a imagem é montada em luz linear; sem ela (celular) as camadas somam direto na cor da tela
  const cores = () => { const m = sel && MESH[sel]; uC.value.copy(HL); if (m) uB.value.copy(m.material.color); if (!linear) { uC.value.convertLinearToSRGB(); uB.value.convertLinearToSRGB(); } M.brilho.uniforms.uK.value = 0; };
  addEventListener('resize', px); addEventListener('versao', px);
  const sinc = () => {
    const m = sel && MESH[sel], ok = !!m && !window.POSE_ON && !m.isSkinnedMesh, vidro = ok && m.material.transparent;
    for (const h of ms) { const usa = ok && (h.userData.k === 'fantasma' || !vidro); if (usa) { if (h.parent !== m) { h.geometry = m.geometry; m.add(h); } } else if (h.parent) h.parent.remove(h); }
    if (ok) { px(); cores(); }
    return ok;
  };
  return { sinc, saida: l => { l = !!l; if (l !== linear) { linear = l; cores(); } } };
})();
function destacar(nome) {
  if (sel && MESH[sel]) { MESH[sel].material.emissive.copy(MESH[sel].userData.em0 || new THREE.Color(0)); const u0 = selU(MESH[sel].material); if (u0) u0.value = 0; }
  sel = nome; const m = MESH[nome]; SELDIM.alvo = m ? 0.82 : 0; { const u1 = m && selU(m.material); if (u1) u1.value = 1; } const camadas = HULL.sinc(); sujar(60); if (!m) return;
  if (!m.userData.em0) m.userData.em0 = m.material.emissive.clone();
  if (!camadas) m.material.emissive.copy(m.material.color).multiplyScalar(0.22).add(_hl.copy(HL).multiplyScalar(0.05));   // em movimento (músculo preso ao esqueleto) vale só o brilho próprio
}
const _hl = new THREE.Color();
const ray = new THREE.Raycaster(); const pt = new THREE.Vector2(); let down = null;
const mirar = e => { pt.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(pt, cam); };
const tocado = e => { mirar(e); const h = ray.intersectObjects([...Object.values(CAMADAS).filter(Boolean), ...(window.POSE_ON ? POSE.alvos() : [])], true).find(h => h.object.visible && h.object.isMesh); return h && h.object; };
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (MOV.on) movDown(e); else if (AG.on) agDown(e); });
canvas.addEventListener('pointermove', e => { if (MOV.arrastando) movMove(e); else if (AG.arrastando) agMove(e); });
canvas.addEventListener('pointerup', e => {
  if (MOV.arrastando || AG.arrastando) { MOV.arrastando = false; AG.arrastando = false; ctl.enabled = true; return; }
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  if (MOV.on || AG.on) return;
  const o = tocado(e);
  if (modoTirar) { if (o) tirar(o.name); return; }
  if (o) abrir(o.name); else fechar();
});

/* ---------- tirar / voltar / padrão ---------- */
let modoTirar = false; const hist = [];
const toast = t => { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 1900); };
function tirar(nome) {
  oculto.add(nome); hist.push(nome); if (sel === nome) fechar();
  aplicarVis(); $('bVoltar').disabled = false; toast('Tirado: ' + ((E[nome] || {}).n || nome));
}
$('bTirar').onclick = () => {
  modoTirar = !modoTirar; $('bTirar').classList.toggle('on', modoTirar); document.body.classList.toggle('tirar', modoTirar);
  if (modoTirar) { fechar(); toast('Toque nas estruturas para tirá-las'); }
};
$('bVoltar').onclick = () => {
  const n = hist.pop(); if (n) { oculto.delete(n); aplicarVis(); toast('Voltou: ' + ((E[n] || {}).n || n)); }
  $('bVoltar').disabled = !hist.length;
};
function padrao() {
  if (MOV.on) sairMov(); if (AG.on) sairAg(); limparDesvio();
  oculto.clear(); hist.length = 0; $('bVoltar').disabled = true; isolado = null; filtroInsercao = null; soDireito = false; $('bLado').classList.remove('on');
  if (modoTirar) $('bTirar').click();
  Object.assign(visCamada, { ossos: true, musculos: true, insercoes: false, articulacoes: false });
  document.querySelectorAll('#camadas .chip').forEach(b => b.classList.toggle('on', visCamada[b.dataset.c]));
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.remove('on'));
  fechar(); aplicarVis(); CEL() ? enquadrarP('corpo', 'ant') : voar([0, 0.9, 0], 3.7, new THREE.Vector3(0.3, 0.1, 1), false); toast('Modelo padrão');
}
$('bPadrao').onclick = padrao;

/* ---------- painel ---------- */
const lado = e => e.l ? ` · lado ${e.l}` : '';
const CAM_NOME = { ossos: 'osso', musculos: 'músculo', insercoes: 'origem/inserção', articulacoes: 'ligamento/articulação' };
function abrir(nome) {
  const e = E[nome] || { n: nome, c: '' }; destacar(nome);
  const base = e.c === 'insercoes' ? e.b : e.b, inf = INFO[base];
  $('pT').textContent = e.n; $('pS').innerHTML = `<span class="tag">${CAM_NOME[e.c] || ''}</span>${esc(lado(e).replace(' · ', ''))}`;
  let h = '';
  if (inf) {
    h += `<p>${esc(inf.resumo)}</p>`;
    if (inf.origem) h += `<h3>Origem, inserção e inervação</h3><div class="oi"><span class="o">Origem</span><div>${esc(inf.origem)}</div><span class="e">Inserção</span><div>${esc(inf.insercao)}</div><span class="n">Inervação</span><div>${esc(inf.inervacao)}</div></div>`;
    if (inf.acoes) h += `<h3>Ações</h3><table class="ac"><tr><th>Movimento</th><th>Plano</th><th>Eixo</th></tr>${inf.acoes.map(a => `<tr><td><b>${esc(a.movimento)}</b><br><small style="color:var(--ink3)">${esc(a.articulacao)}</small></td><td>${a.plano.split('/').map(p => `<span class="pl ${p}">${esc(p)}</span>`).join(' ')}</td><td>${esc(a.eixo)}</td></tr>`).join('')}</table>`;
    if (inf.notas) h += `<h3>${inf.tipo === 'osso' ? 'Pontos importantes' : 'Na prática'}</h3><p>${esc(inf.notas)}</p>`;
  } else if (e.c === 'insercoes') {
    h += `<p>Área em que o músculo se prende ao osso: <b style="color:${e.t === 'origem' ? 'var(--ori)' : 'var(--ins)'}">${e.t}</b>. Na origem fica a parte que normalmente se move menos; na inserção, a que mais se move.</p>`;
  } else {
    h += `<p style="color:var(--ink3)">Estrutura do modelo sem ficha própria.</p>`;
  }
  h += `<div class="acoes">`;
  if (e.c === 'musculos') h += `<button class="pri" data-a="oi">Ver origem e inserção</button>`;
  h += `<button data-a="iso">${isolado ? 'Mostrar todos' : 'Isolar'}</button><button data-a="ocu">Tirar</button></div>`;
  if (inf && inf.fontes) h += `<div class="fontes">Fontes: ${inf.fontes.map(esc).join(' · ')}</div>`;
  $('pB').innerHTML = h; $('painel').classList.add('on'); $('pB').scrollTop = 0; painelAberto = true; resize(); lstVoltar();
  $('pB').querySelector('.acoes').onclick = async ev => {
    const a = ev.target.closest('button'); if (!a) return;
    if (a.dataset.a === 'ocu') tirar(nome);
    if (a.dataset.a === 'iso') { isolado = isolado ? null : new Set([nome]); aplicarVis(); abrir(nome); }
    if (a.dataset.a === 'oi') { await garantir('insercoes'); visCamada.insercoes = true; document.querySelector('[data-c=insercoes]').classList.add('on'); filtroInsercao = e.b; isolado = new Set([nome]); aplicarVis(); abrir(nome);
      focar(nome, 2.4); }
  };
}
function fechar() { LST.de = false; $('painel').classList.remove('on'); painelAberto = false; resize(); destacar(null); }
$('pX').onclick = fechar;
$('bLado').onclick = () => { soDireito = !soDireito; $('bLado').classList.toggle('on', soDireito); aplicarVis(); };

/* ---------- regiões ---------- */
function regiao(r) {
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.toggle('on', b.dataset.r === r));
  if (MOV.on) sairMov(false); if (AG.on) sairAg(false);
  $('pB').onclick = null;
  if (r === 'postura') { listaPostura(); return; }
  if (r === 'tecidos') { mostrarTecidos(); return; }
  if (r === 'movimento') { listaMov(); return; }
  limparDesvio();
  if (r === 'corpo') { isolado = null; aplicarVis(); fechar(); CEL() ? enquadrarP('corpo', 'ant') : voar([0, 0.9, 0], 3.7, undefined, false); return; }
  const R = DADOS.regioes[r]; const itens = new Set(R.itens);
  isolado = new Set(Object.keys(E).filter(n => itens.has(E[n].b) && E[n].c === 'musculos'));
  let alvo = R.alvo;
  if (R.alvoMesh) { const bx = new THREE.Box3(); R.alvoMesh.forEach(n => MESH[n] && bx.expandByObject(MESH[n])); alvo = bx.getCenter(new THREE.Vector3()).toArray(); }
  aplicarVis(); voar(alvo, R.dist, new THREE.Vector3(-0.6, 0.25, 1));
  destacar(null);
  $('pT').textContent = R.nome; $('pS').innerHTML = '<span class="tag">região</span>';
  const ms = [...new Set(R.itens)].filter(b => INFO[b]);
  $('pB').innerHTML = `<p>${R.intro}</p>
    ${R.movimento ? `<div class="acoes"><button class="pri" id="bMov">▶ Mover o ${R.movimento} · ângulo e torque</button>${r === 'joelho' ? '<button class="pri" id="bAg">▶ Agachamento · quadril, joelho e tornozelo</button>' : ''}</div>` : ''}
    ${(() => { const arts = { ombro: ['Ombro (glenoumeral)', 'Escápula (cintura escapular)'], cotovelo: ['Cotovelo', 'Radioulnares', 'Punho'], joelho: ['Joelho (tibiofemoral)', 'Tornozelo (talocrural)'] }[r] || [];
      return arts.map(a => `<h3>Movimentos · ${esc(a)}</h3><div class="lista lmov">${CAT.filter(m => m.art === a).map(m => `<button data-a="${m.id}"><i style="background:${PLANOS[m.plano][2]}"></i><span class="lnome">${esc(m.nome)}</span><span class="pl ${PLANOS[m.plano][0]}">${PLANOS[m.plano][0]}</span></button>`).join('')}</div>`).join(''); })()}
    ${Object.entries(R.juntas).map(([k, t]) => `<h3>${esc(k)}</h3><p>${esc(t)}</p>`).join('')}
    ${R.seguranca || ''}
    <h3>Estruturas</h3><div class="lista">${ms.map(b => { const nm = Object.keys(E).find(n => E[n].b === b && E[n].l === 'direito') || Object.keys(E).find(n => E[n].b === b); return nm ? `<button data-n="${esc(nm)}"><i class="${E[nm].c === 'ossos' ? 'os' : ''}"></i>${esc(E[nm].n)}</button>` : ''; }).join('')}</div>`;
  $('painel').classList.add('on'); painelAberto = true; resize();
  if (R.movimento) $('bMov').onclick = () => entrarMov(R.movimento);
  if ($('bAg')) $('bAg').onclick = entrarAg;
  $('pB').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; if (b.dataset.a) mostrarArt(b.dataset.a); else if (b.dataset.n) mostrar(b.dataset.n, 2.6); };
}
$('regioes').addEventListener('click', ev => { const b = ev.target.closest('.chip'); if (b) regiao(b.dataset.r); });

/* ---------- busca ---------- */
const IDX = []; const vistos = new Set();
for (const [n, e] of Object.entries(E)) { if (e.c === 'insercoes') continue; const k = e.n + '|' + e.l; if (vistos.has(k)) continue; vistos.add(k); IDX.push({ n, t: e.n, l: e.l, c: e.c, s: e.n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }); }
const sug = $('sug');
$('q').addEventListener('input', () => {
  const q = $('q').value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (q.length < 2) { sug.style.display = 'none'; return; }
  const R = IDX.filter(x => x.s.includes(q) && x.l !== 'esquerdo').slice(0, 30);
  sug.innerHTML = R.map(x => `<button data-n="${esc(x.n)}">${esc(x.t)}<small>${CAM_NOME[x.c]}</small></button>`).join('') || '<button disabled>Nada encontrado</button>';
  sug.style.display = 'block';
});
sug.addEventListener('click', ev => { const b = ev.target.closest('button[data-n]'); if (!b) return; sug.style.display = 'none'; $('q').value = ''; $('q').blur();
  mostrar(b.dataset.n); });
async function mostrar(n, mult) {
  const c = (E[n] || {}).c; if (c && !visCamada[c]) { await garantir(c); visCamada[c] = true; document.querySelector(`[data-c=${c}]`).classList.add('on'); }
  oculto.delete(n); if (isolado && c !== 'ossos') isolado.add(n); aplicarVis(); if (MESH[n]) focar(n, mult); abrir(n);
}
document.addEventListener('click', ev => { if (!ev.target.closest('.busca')) sug.style.display = 'none'; });

/* ---------- modo movimento (cotovelo, joelho): flexão e extensão com torque ---------- */
// Corpo rígido: o segmento distal gira em torno do eixo látero-lateral da articulação.
// Cada músculo é traçado em linha reta da origem à inserção (centro das áreas do modelo).
const G = 9.81, _v = new THREE.Vector3();
const vertsMundo = m => { m.updateWorldMatrix(true, false); const p = m.geometry.attributes.position, out = []; for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); return out; };
const media = vs => vs.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / vs.length);
const caixa = ms => { const b = new THREE.Box3(); ms.forEach(m => b.expandByObject(m)); return b; };
const extremo = (n, folga, alto = 0) => { const vs = vertsMundo(MESH[n]); const mn = Math.min(...vs.map(v => v.y)); const c = media(vs.filter(v => v.y < mn + folga)); c.y = mn + alto; return c; };
const JMOV = {
  cotovelo: {
    titulo: 'Cotovelo · biomecânica', eixo: 'eixo do cotovelo', s: -1, max: 145, seg: 'antebraço', ang0: 0, carga0: 8,
    distal: /^(Radius|Ulna)$|of hand|metacarpal|Scaphoid|Lunate|Triquetrum|Pisiform|Trapezium|Trapezoid|Capitate|Hamate/, fator: {},
    vis: ['Humerus.r', 'Scapula.r', 'Clavicle.r'],
    centro: () => extremo('Humerus.r', 0.022, 0.011),
    pontos(J) {   // W = punho, H = pegada (palma)
      const W = extremo('Radius.r', 0.012);
      const bm = caixa(J.dist.map(d => d.m).filter(m => new THREE.Box3().setFromObject(m).getCenter(_v).y < W.y - 0.01));
      const H = bm.getCenter(new THREE.Vector3()); H.y = bm.max.y - 0.045; return { W, H };
    },
    zonas: (a) => [
      a <= 5 && ['Extensão completa', 'O olécrano encaixa na fossa do olécrano. Estender até o fim é normal; evite "bater" na trava com carga e velocidade, e não force além do 0° em quem é hipermóvel.'],
      a >= 125 && ['Flexão profunda', 'O contato entre braço e antebraço limita o movimento (cerca de 145° ativos). Amplitude completa é segura e útil para hipertrofia.'],
    ],
    carga: 'H', segs: [[0.016, 'W', 0.43], [0.006, 'H', 1]], objeto: 'halter', rotCarga: 'Carga no halter', cargaMax: 40,
    musculos: [
      ['Long head of biceps brachii', 'Biceps brachii muscle', 'Bíceps (cabeça longa)', '#ff5d73'], ['Short head of biceps brachii', 'Biceps brachii muscle', 'Bíceps (cabeça curta)', '#ff8fa3'],
      ['Brachialis muscle', 'Brachialis muscle', 'Braquial', '#ff9f43'], ['Brachioradialis muscle', 'Brachioradialis muscle', 'Braquiorradial', '#ffd43b'],
      ['Pronator teres', 'Pronator teres', 'Pronador redondo', '#c084fc'], ['Extensor carpi radialis longus', 'Extensor carpi radialis longus', 'Extensor radial longo do carpo', '#94d82d'],
      ['Lateral head of triceps brachii', 'Triceps brachii muscle', 'Tríceps (cabeça lateral)', '#4dabf7', -0.02], ['Long head of triceps brachii', 'Triceps brachii muscle', 'Tríceps (cabeça longa)', '#74c0fc', -0.02],
      ['Medial head of triceps brachii', 'Triceps brachii muscle', 'Tríceps (cabeça medial)', '#a5d8ff', -0.02],
    ],
    posicoes: [[0, 'Em pé (braço ao lado do corpo)'], [45, 'Banco Scott (braço 45° à frente)'], [-30, 'Banco inclinado (braço 30° atrás)']],
    cam: { cel: [0, 0.08, 0.12, 1.75], pc: [0, -0.03, 0.17, 1.05] },
    texto: `<p><b>Torque</b> é a capacidade de uma força girar a articulação: τ = F × d⊥. A força é o peso (do halter e do próprio antebraço) e d⊥ é a distância perpendicular entre a linha da gravidade (seta amarela) e o eixo do cotovelo (linha verde-água). Com o antebraço perpendicular à gravidade, d⊥ é máxima e o exercício fica mais pesado.</p>
    <p><b>Braço de momento do músculo</b> é a mesma ideia do lado de dentro: a distância perpendicular entre a linha de tração do músculo e o eixo. Quanto maior, menos força o músculo precisa fazer para gerar o mesmo torque. O bíceps tem braço de momento pequeno com o cotovelo estendido e maior perto de 90° a 100°.</p>
    <p><b>Posição do braço muda tudo.</b> O pico de torque acontece quando o antebraço fica na horizontal. Em pé, isso acontece no meio da subida. No banco Scott (braço à frente), o pico vem bem antes e o fim da subida fica leve. No banco inclinado (braço atrás), o pico vem depois e o bíceps começa o movimento mais alongado no ombro. Teste as três posições e veja a curva amarela mudar.</p>`,
    aviso: 'cada músculo é traçado em linha reta da origem à inserção do modelo 3D (o tendão do tríceps contorna o olécrano, modelado como um cilindro de 2 cm em volta do eixo), e o peso do antebraço e da mão usa as proporções médias de Winter.',
    fontes: 'Neumann. Cinesiologia do aparelho musculoesquelético, caps. 1 e 6 · Winter. Biomechanics and Motor Control of Human Movement (parâmetros dos segmentos)',
  },
  joelho: {
    titulo: 'Joelho · biomecânica', eixo: 'eixo do joelho', s: 1, max: 140, seg: 'perna', ang0: 90, carga0: 20,
    distal: /^(Tibia|Fibula|Patella|Talus|Calcaneus|Navicular bone|Cuboid bone)$|cuneiform|metatarsal|of foot/, fator: { 'Patella.r': 0.6 },
    vis: ['Femur.r', 'Hip bone.r'],
    centro: () => extremo('Femur.r', 0.03, 0.022),
    pontos(J) {   // A = tornozelo (rolo do aparelho / caneleira), P = centro do pé
      const A = extremo('Tibia.r', 0.02, 0.045);
      const pe = J.dist.map(d => d.m).filter(m => !/Tibia|Fibula|Patella/.test(m.name));
      return { A, P: caixa(pe).getCenter(new THREE.Vector3()) };
    },
    zonas: (a, alfa) => [
      alfa === 90 && a <= 40 && ['0° a 40° na cadeira extensora', 'Faixa de maior tensão no LCA com carga no tornozelo, porque o quadríceps puxa a tíbia para a frente. Em joelho saudável é seguro; na reabilitação do LCA, essa faixa é liberada aos poucos.'],
      alfa === 90 && a <= 30 && ['Patelofemoral na cadeia aberta', 'O estresse entre a patela e o fêmur é maior perto da extensão na cadeira extensora (no agachamento é o contrário: maior com o joelho muito flexionado). Quem tem dor na frente do joelho pode usar a faixa sem dor.'],
      alfa !== 90 && a >= 90 && ['Isquiotibiais encurtados', 'Acima de 90° de flexão os isquiotibiais trabalham muito encurtados e perdem força (insuficiência ativa). Cãibra aqui é comum, não é sinal de lesão.'],
      a >= 125 && ['Flexão profunda', 'O contato da panturrilha com a coxa limita o movimento (cerca de 135° a 140°).'],
    ],
    carga: 'A', segs: [[0.0465, 'A', 0.433], [0.0145, 'P', 1]], objeto: 'rolo', rotCarga: 'Força da carga no tornozelo', cargaMax: 80,
    musculos: [
      ['Rectus femoris muscle', 'Quadriceps femoris muscle', 'Reto femoral', '#ff5d73', -0.04], ['Vastus lateralis muscle', 'Quadriceps femoris muscle', 'Vasto lateral', '#ff8fa3', -0.04],
      ['Vastus medialis muscle', 'Quadriceps femoris muscle', 'Vasto medial', '#ff9f43', -0.04], ['Vastus intermedius muscle', 'Quadriceps femoris muscle', 'Vasto intermédio', '#ffc078', -0.04],
      ['Long head of biceps femoris', 'Biceps femoris muscle', 'Bíceps femoral (cabeça longa)', '#4dabf7'], ['Semitendinosus muscle', 'Semitendinosus muscle', 'Semitendíneo', '#74c0fc'],
      ['Semimembranosus muscle', 'Semimembranosus muscle', 'Semimembranáceo', '#a5d8ff'], ['Gracilis muscle', 'Gracilis muscle', 'Grácil', '#c084fc'],
      ['Medial head of gastrocnemius', 'Triceps surae muscle', 'Gastrocnêmio (cabeça medial)', '#94d82d'], ['Lateral head of gastrocnemius', 'Triceps surae muscle', 'Gastrocnêmio (cabeça lateral)', '#b2f2bb'],
    ],
    posicoes: [[90, 'Sentado (cadeira extensora)'], [-90, 'Deitado de bruços (mesa flexora)'], [0, 'Em pé (flexão com caneleira)']],
    cam: { cel: [0, 0.0, 0.0, 2.3], pc: [0, -0.05, 0.12, 1.45] },
    texto: `<p><b>Torque externo</b> = peso × d⊥, a distância perpendicular entre a linha da gravidade (seta amarela) e o eixo do joelho (linha verde-água). O peso inclui a carga no tornozelo e a própria perna e pé.</p>
    <p><b>Cadeira extensora:</b> com a perna pendurada (90°), a gravidade passa quase pelo eixo e o torque é pequeno. Conforme o joelho estende, a perna fica horizontal e o torque chega ao máximo na extensão completa. É o oposto do agachamento, que pesa mais no fundo.</p>
    <p><b>Mesa flexora:</b> deitado, o torque é máximo com o joelho estendido e cai até perto de zero aos 90°. <b>Em pé</b> (caneleira), acontece o contrário: começa leve e fica pesado perto de 90°.</p>
    <p><b>Quadríceps e patela:</b> a patela afasta o tendão do eixo e aumenta o braço de momento do quadríceps (cerca de 4 a 5 cm). Os isquiotibiais e o gastrocnêmio puxam atrás do eixo, como flexores.</p>
    <p style="font-size:12.5px;color:var(--ink3)">O agachamento é uma cadeia fechada (pé no chão) e depende do quadril e do tronco: ele entra na próxima fase.</p>`,
    aviso: 'cada músculo é traçado em linha reta da origem à inserção do modelo 3D (o quadríceps contorna a patela, modelada como um cilindro de 4 cm em volta do eixo), a patela acompanha a tíbia de forma simplificada, e o peso da perna e do pé usa as proporções médias de Winter.',
    fontes: 'Neumann. Cinesiologia do aparelho musculoesquelético, caps. 1 e 13 · Winter. Biomechanics and Motor Control of Human Movement (parâmetros dos segmentos)',
  },
};
const MOV = { on: false, j: null, J: null, ang: 0, carga: 8, massa: 75, alfa: 0, arrastando: false, vis: new Set() };
const rotX = (C, ang) => new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(new THREE.Matrix4().makeRotationX(ang * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
const rotacao = (ang, J = MOV.J, k = 1) => rotX(J.C, J.cfg.s * ang * k);
async function prepararMov(id) {
  const cfg = JMOV[id]; if (cfg.J) return cfg.J;
  await garantir('insercoes');
  const J = { cfg, dist: [], mus: [] };
  J.C = cfg.centro();
  for (const [n, m] of Object.entries(MESH)) {
    const e = E[n] || {};
    if (m.userData.camada !== 'ossos' || e.l !== 'direito' || !cfg.distal.test(e.b)) continue;
    m.updateWorldMatrix(true, false); J.dist.push({ m, k: cfg.fator[n] ?? 1, M0: m.matrixWorld.clone(), Pi: m.parent.matrixWorld.clone().invert() });
  }
  J.vis = new Set([...J.dist.map(d => d.m.name), ...cfg.vis]);
  J.P = cfg.pontos(J); const L = J.P[cfg.carga];
  J.phi0 = Math.atan2(L.z - J.C.z, -(L.y - J.C.y));
  const centro = (b, t) => {   // centro da área de origem/inserção do lado direito (se faltar, espelha o esquerdo)
    for (const [lado, sx] of [['direito', 1], ['esquerdo', -1]]) {
      const vs = []; for (const [n, e] of Object.entries(E)) if (e.c === 'insercoes' && e.b === b && e.t === t && e.l === lado && MESH[n]) vs.push(...vertsMundo(MESH[n]));
      if (vs.length) { const c = media(vs); c.x *= sx; return c; }
    }
    return null;
  };
  const grupo = new THREE.Group(); grupo.visible = false; scene.add(grupo); J.grupo = grupo;
  const cil = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), esf = new THREE.SphereGeometry(1, 16, 12);
  for (const [b, bi, nome, cor, min] of cfg.musculos) {
    const O = centro(b, 'origem'), I = centro(bi, 'inserção'); if (!O || !I) continue;
    const mat = new THREE.MeshBasicMaterial({ color: cor, depthTest: false, transparent: true, opacity: 0.8 });
    const tubo = new THREE.Mesh(cil, mat), po = new THREE.Mesh(esf, mat), pi = new THREE.Mesh(esf, mat);
    po.scale.setScalar(0.006); po.position.copy(O); pi.scale.setScalar(0.006); [tubo, po, pi].forEach(o => o.renderOrder = 10);
    grupo.add(tubo, po, pi); J.mus.push({ nome, cor, O, I0: I, I: I.clone(), tubo, pi, min });
  }
  const verde = new THREE.MeshBasicMaterial({ color: '#3fd8cb', depthTest: false });
  const eixo = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.18, 12).rotateZ(Math.PI / 2), verde); eixo.position.copy(J.C); eixo.renderOrder = 11; grupo.add(eixo);
  const bola = new THREE.Mesh(esf, verde); bola.scale.setScalar(0.008); bola.position.copy(J.C); bola.renderOrder = 11; grupo.add(bola);
  J.seta = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), L, 0.16, '#ffd43b', 0.03, 0.018);
  J.seta.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 12; } }); grupo.add(J.seta);
  J.perp = new THREE.Line(new THREE.BufferGeometry().setFromPoints([J.C, J.C]), new THREE.LineDashedMaterial({ color: '#ffd43b', dashSize: 0.008, gapSize: 0.006, depthTest: false })); J.perp.renderOrder = 12; grupo.add(J.perp);
  const ferro = new THREE.MeshStandardMaterial({ color: '#9aa6b5', metalness: 0.5, roughness: 0.3, emissive: '#1b2430' });
  const obj = new THREE.Group();
  if (cfg.objeto === 'halter') {
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 16).rotateZ(Math.PI / 2), ferro));
    for (const s of [-1, 1]) { const an = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 24).rotateZ(Math.PI / 2), ferro); an.position.x = s * 0.085; obj.add(an); }
  } else {   // rolo acolchoado do aparelho, encostado na frente do tornozelo
    const espuma = new THREE.MeshStandardMaterial({ color: '#2b3442', roughness: 0.8 });
    const rolo = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 24).rotateZ(Math.PI / 2), espuma); rolo.position.z = 0.075; obj.add(rolo); J.rolo = rolo;
    const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 12).rotateZ(Math.PI / 2), ferro); haste.position.set(0.02, 0, 0.075); obj.add(haste); J.haste = haste;
  }
  obj.position.copy(L); obj.updateMatrix(); obj.matrixAutoUpdate = false; J.objM0 = obj.matrix.clone(); J.obj = obj; grupo.add(obj);
  cfg.J = J; return J;
}
function gravidade(alfa = MOV.alfa) { const a = alfa * Math.PI / 180; return new THREE.Vector3(0, -Math.cos(a), -Math.sin(a)); }
const torqueX = (r, F) => r.y * F.z - r.z * F.y;
function calcular(ang, alfa = MOV.alfa) {
  const J = MOV.J, cfg = J.cfg, R = rotacao(ang), C = J.C, g = gravidade(alfa), s = cfg.s;
  const pts = {}; for (const [k, p] of Object.entries(J.P)) pts[k] = p.clone().applyMatrix4(R).sub(C);
  const L = pts[cfg.carga];
  let mseg = 0; const com = new THREE.Vector3();
  for (const [f, k, frac] of cfg.segs) { com.addScaledVector(pts[k], f * frac * MOV.massa); mseg += f * MOV.massa; }
  com.multiplyScalar(1 / mseg);
  const tCarga = torqueX(L, g.clone().multiplyScalar(MOV.carga * G)), tSeg = torqueX(com, g.clone().multiplyScalar(mseg * G));
  const mus = J.mus.map(u => { const I = u.I0.clone().applyMatrix4(R).sub(C), O = u.O.clone().sub(C), F = O.clone().sub(I).normalize(); const ma = s * torqueX(I, F); return u.min ? Math.sign(u.min) * Math.max(Math.abs(ma), Math.abs(u.min)) : ma; }); // >0 flexor
  return { total: tCarga + tSeg, mus, dCarga: Math.abs(torqueX(L, g)), flexiona: s * (tCarga + tSeg) > 0 };
}
function movAplicar() {
  const J = MOV.J, C = J.C;
  // posição do corpo (sentado, deitado, banco Scott...): gira a cena em torno da articulação para a gravidade continuar "para baixo" na tela
  scene.matrixAutoUpdate = false; scene.matrix.copy(rotX(C, -MOV.alfa)); scene.matrixWorldNeedsUpdate = true; MOV.sInv = scene.matrix.clone().invert();
  const R = rotacao(MOV.ang);
  for (const d of J.dist) { d.m.matrixAutoUpdate = false; d.m.matrix.copy(d.Pi).multiply(d.k === 1 ? R : rotacao(MOV.ang, J, d.k)).multiply(d.M0); }
  J.obj.matrix.copy(R).multiply(J.objM0); J.obj.visible = MOV.carga > 0;
  if (J.rolo) { const z = MOV.alfa === 90 ? 0.075 : -0.06; J.rolo.position.z = z; J.haste.position.z = z; }   // extensora: rolo na frente; flexoras: atrás do tornozelo
  for (const u of J.mus) {
    u.I.copy(u.I0).applyMatrix4(R); u.pi.position.copy(u.I);
    const d = _v.subVectors(u.I, u.O), L = d.length();
    u.tubo.position.copy(u.O); u.tubo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()); u.tubo.scale.set(0.002, 0.002, L);
  }
  const Lp = J.P[J.cfg.carga].clone().applyMatrix4(R), g = gravidade();
  J.seta.position.copy(Lp); J.seta.setDirection(g);
  const P = Lp.clone().addScaledVector(g, _v.subVectors(C, Lp).dot(g));
  J.perp.geometry.setFromPoints([C, P]); J.perp.computeLineDistances(); MOV.Pp = P;
  movPainel();
}
const f1 = (x, d = 1) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
function movPainel() {
  if (!$('mvA')) return;
  const J = MOV.J, r = calcular(MOV.ang); MOV.ult = r;
  $('mvA').textContent = Math.round(MOV.ang) + '°'; $('mvS').value = MOV.ang;
  $('mvT').innerHTML = f1(Math.abs(r.total)) + '<i>N·m</i>'; $('mvD').innerHTML = f1(r.dCarga * 100) + '<i>cm</i>';
  const quase = Math.abs(r.total) < 0.05, precisa = quase ? null : r.flexiona ? 'extensores' : 'flexores';
  $('mvQ').textContent = precisa ? `A gravidade tende a ${r.flexiona ? 'flexionar' : 'estender'} o ${J.cfg.titulo.split(' ')[0].toLowerCase()}: quem segura a carga são os ${precisa}.` : 'O segmento está alinhado com a gravidade: quase nenhum torque.';
  $('mvM').innerHTML = J.mus.map((u, i) => {
    const ma = r.mus[i], flex = ma > 0, util = precisa && ((precisa === 'flexores') === flex) && Math.abs(ma) > 0.004;
    const F = util ? Math.abs(r.total) / Math.abs(ma) : null;
    return `<tr><td><span class="dot" style="background:${u.cor}"></span>${esc(u.nome)}<br><small style="color:var(--ink3)">${flex ? 'flexor' : 'extensor'}</small></td><td>${f1(Math.abs(ma) * 100)} cm</td><td>${F ? f1(F, 0) + ' N<br><small style="color:var(--ink3)">≈ ' + f1(F / G, 0) + ' kgf</small>' : '—'}</td></tr>`;
  }).join('');
  desenharGraf();
  const pico = Math.max(...MOV.curva.map(c => c[1])), z = (J.cfg.zonas ? J.cfg.zonas(MOV.ang, MOV.alfa) : []).filter(Boolean);
  if (pico > 1 && Math.abs(r.total) >= 0.9 * pico) z.unshift(['Perto do pico de torque', 'Este é o ponto mais pesado do exercício nesta posição: é aqui que a carga "trava" e onde a técnica costuma se perder.', 1]);
  $('mvZ').innerHTML = z.map(([t, x, ok]) => `<div class="zona${ok ? ' ok' : ''}"><b>${t}</b><br>${x}</div>`).join('');
}
function desenharGraf() {
  const cv = $('graf'); if (!cv) return; const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const J = MOV.J, mx = J.cfg.max, chave = [MOV.j, MOV.carga, MOV.massa, MOV.alfa].join('|');
  if (MOV.curvaK !== chave) { MOV.curva = []; for (let a = 0; a <= mx; a += 2.5) { const r = calcular(a); MOV.curva.push([a, Math.abs(r.total), Math.abs(r.mus[0] || 0) * 100]); } MOV.curvaK = chave; }
  const pl = 34, pr = 34, pt = 10, pb = 22, W = w - pl - pr, H = h - pt - pb;
  const tMax = Math.max(1, ...MOV.curva.map(c => c[1])) * 1.1, mMax = Math.max(1, ...MOV.curva.map(c => c[2])) * 1.15;
  const X = a => pl + a / mx * W, Yt = t => pt + H - t / tMax * H, Ym = m => pt + H - m / mMax * H;
  x.font = '10px Instrument Sans, sans-serif'; x.fillStyle = '#939dba'; x.strokeStyle = '#243344'; x.lineWidth = 1;
  for (const a of [0, 45, 90, 135]) { if (a > mx) continue; x.beginPath(); x.moveTo(X(a), pt); x.lineTo(X(a), pt + H); x.stroke(); x.textAlign = 'center'; x.fillText(a + '°', X(a), h - 6); }
  x.textAlign = 'right'; x.fillText(f1(tMax / 1.1, 0), pl - 4, Yt(tMax / 1.1) + 3); x.fillText('0', pl - 4, pt + H + 3);
  x.textAlign = 'left'; x.fillText(f1(mMax / 1.15, 1), w - pr + 4, Ym(mMax / 1.15) + 3);
  const linha = (f, cor, lw) => { x.beginPath(); MOV.curva.forEach((c, i) => { const px = X(c[0]), py = f(c); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.strokeStyle = cor; x.lineWidth = lw; x.stroke(); };
  linha(c => Ym(c[2]), J.mus[0] ? J.mus[0].cor : '#ff5d73', 1.6); linha(c => Yt(c[1]), '#ffd43b', 2.4);
  x.strokeStyle = '#3fd8cb'; x.lineWidth = 1.5; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(MOV.ang), pt); x.lineTo(X(MOV.ang), pt + H); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#ffd43b'; x.beginPath(); x.arc(X(MOV.ang), Yt(Math.abs(MOV.ult.total)), 4, 0, 7); x.fill();
}
function painelMov() {
  const J = MOV.J, c = J.cfg, art = c.titulo.split(' ')[0].toLowerCase();
  $('pT').textContent = c.titulo; $('pS').innerHTML = '<span class="tag">modo movimento</span>flexão e extensão';
  $('pB').innerHTML = `<div class="mv">
    <p style="margin-top:2px">Arraste a <b>${c.seg}</b> no modelo, ou use a barra abaixo.</p>
    <div class="mv-ang"><b id="mvA">0°</b><span>de flexão do ${art}<br>plano sagital · eixo látero-lateral</span></div>
    <input id="mvS" type="range" min="0" max="${c.max}" step="1" value="${MOV.ang}">
    <div class="mv-ctl"><span>${c.rotCarga}</span><output id="mvCo">${MOV.carga} kg</output><input id="mvC" type="range" min="0" max="${c.cargaMax}" step="1" value="${MOV.carga}"></div>
    <div class="mv-ctl"><span>Massa corporal (peso do próprio segmento)</span><output id="mvPo">${MOV.massa} kg</output><input id="mvP" type="range" min="40" max="140" step="1" value="${MOV.massa}"></div>
    <div class="seg" id="mvB">${c.posicoes.map(([a, t]) => `<button data-a="${a}" class="${a === MOV.alfa ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="kp"><div><small>Torque externo no ${art}</small><b id="mvT"></b></div><div><small>Distância perpendicular da carga até o eixo</small><b id="mvD"></b></div></div>
    <p id="mvQ" style="font-size:13px"></p><div id="mvZ"></div>
    <h3>Torque ao longo do movimento</h3>
    <div class="leg"><span><i style="background:#ffd43b"></i>torque externo (N·m)</span><span><i style="background:${J.mus[0] ? J.mus[0].cor : '#ff5d73'}"></i>braço de momento: ${esc(J.mus[0] ? J.mus[0].nome.toLowerCase() : '')} (cm)</span></div>
    <canvas id="graf"></canvas>
    <h3>Músculos: braço de momento e força</h3>
    <table class="ac mt"><tr><th>Músculo</th><th>Braço de momento</th><th>Força p/ equilibrar</th></tr><tbody id="mvM"></tbody></table>
    <p style="font-size:12px;color:var(--ink3)">"Força p/ equilibrar" é a força que o músculo teria que fazer se trabalhasse sozinho. Na prática, os músculos dividem a tarefa.</p>
    <h3>Como ler</h3>${c.texto}
    <div class="aviso">Valores aproximados para estudo: ${c.aviso}</div>
    <div class="fontes">Fontes: ${c.fontes} · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div></div>`;
  $('painel').classList.add('on'); painelAberto = true; resize();
  $('mvS').oninput = e => { MOV.ang = +e.target.value; movAplicar(); };
  $('mvC').oninput = e => { MOV.carga = +e.target.value; $('mvCo').textContent = MOV.carga + ' kg'; movAplicar(); };
  $('mvP').oninput = e => { MOV.massa = +e.target.value; $('mvPo').textContent = MOV.massa + ' kg'; movAplicar(); };
  $('mvB').onclick = e => { const b = e.target.closest('button'); if (!b) return; MOV.alfa = +b.dataset.a; $('mvB').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); movAplicar(); enquadrar(); };
}
async function entrarMov(id = 'cotovelo') {
  if (typeof id !== 'string') id = 'cotovelo';
  toast('Preparando o modo movimento…'); const J = await prepararMov(id);
  if (MOV.on) sairMov(false); if (AG.on) sairAg(false);
  const c = J.cfg;
  Object.assign(MOV, { on: true, j: id, J, vis: J.vis, ang: c.ang0, carga: c.carga0, alfa: c.posicoes[0][0] });
  document.body.classList.add('mov'); if (modoTirar) $('bTirar').click();
  J.grupo.visible = true; grid.visible = false;
  $('rot').innerHTML = `<span id="rAng" style="color:#3fd8cb"></span><span id="rD" style="color:#ffd43b"></span><span id="rEixo" style="color:#3fd8cb;font-weight:500;font-size:11px">${c.eixo}</span>`; $('rot').style.display = '';
  aplicarVis(); destacar(null); painelMov(); movAplicar();
  enquadrar();
  toast(`Arraste a ${c.seg} para mover o ${c.titulo.split(' ')[0].toLowerCase()}`);
}
// enquadra a câmera (vista lateral direita) no braço/perna inteiro e em todo o arco do movimento, descontando o painel
function enquadrar() {
  const J = MOV.J, S = scene.matrix, b = new THREE.Box3();
  scene.updateMatrixWorld(true);
  for (const n of J.cfg.vis) if (MESH[n]) b.expandByObject(MESH[n]);
  b.expandByPoint(J.C.clone().applyMatrix4(S));
  for (let a = 0; a <= J.cfg.max; a += 10) for (const k of Object.keys(J.P)) b.expandByPoint(J.P[k].clone().applyMatrix4(rotacao(a)).applyMatrix4(S));
  const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  const W = innerWidth, H = innerHeight, area = areaLivre();
  const t = Math.tan(cam.fov * Math.PI / 360), aw = (area.x1 - area.x0) / W, ah = (area.y1 - area.y0) / H;
  const dist = 1.12 * Math.max(sz.y / 2 / (t * ah), sz.z / 2 / (t * cam.aspect * aw)) + sz.x / 2;
  const dir = new THREE.Vector3(-1, 0.06, 0.06).normalize();
  const fwd = dir.clone().negate(), dir_r = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(dir_r, fwd);
  const wpp = 2 * dist * t / H, dx = (area.x0 + area.x1) / 2 - W / 2, dy = (area.y0 + area.y1) / 2 - H / 2;
  const alvo = c.clone().addScaledVector(dir_r, -dx * wpp).addScaledVector(up, dy * wpp);
  voar(alvo.toArray(), dist, dir, false);
}
function sairMov(fechaPainel = true) {
  const J = MOV.J; MOV.on = false; MOV.arrastando = false; ctl.enabled = true; document.body.classList.remove('mov');
  scene.matrix.identity(); scene.matrixAutoUpdate = true; scene.matrixWorldNeedsUpdate = true; grid.visible = true;
  if (J) { for (const d of J.dist) { d.m.matrixAutoUpdate = true; d.m.updateMatrix(); } J.grupo.visible = false; }
  $('rot').style.display = 'none'; aplicarVis(); if (fechaPainel) fechar();
}
$('bSairMov').onclick = () => { if (AG.on) { sairAg(); regiao('joelho'); return; } const j = MOV.j; sairMov(); regiao(j); };
$('bDados').onclick = () => { if (MOV.on) { painelMov(); movPainel(); } else if (AG.on) { painelAg(); agPainel(); } };
const planoSag = new THREE.Plane(), _p = new THREE.Vector3();
function movDown(e) {
  mirar(e); const J = MOV.J;
  if (!ray.intersectObjects([...J.dist.map(d => d.m), J.obj], true).length) return;
  MOV.arrastando = true; ctl.enabled = false; planoSag.setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), J.C);
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
}
function movMove(e) {
  const J = MOV.J; mirar(e); if (!ray.ray.clone().applyMatrix4(MOV.sInv).intersectPlane(planoSag, _p)) return;
  let a = -J.cfg.s * (Math.atan2(_p.z - J.C.z, -(_p.y - J.C.y)) - J.phi0) * 180 / Math.PI;
  if (a < -60) a += 360; if (a > 300) a -= 360;
  const novo = Math.max(0, Math.min(J.cfg.max, a));
  if (Math.abs(novo - MOV.ang) > 0.2) { MOV.ang = novo; movAplicar(); }
}
const _s = new THREE.Vector3();
function movQuadro() {
  const J = MOV.J; if (!MOV.Pp) return;
  const pos = (id, v) => { const el = $(id); if (!el) return; _s.copy(v).applyMatrix4(scene.matrix).project(cam); el.style.display = _s.z < 1 ? '' : 'none'; el.style.left = (_s.x + 1) / 2 * innerWidth + 'px'; el.style.top = (1 - _s.y) / 2 * innerHeight + 'px'; };
  $('rAng').textContent = Math.round(MOV.ang) + '°'; pos('rAng', J.C.clone().add(new THREE.Vector3(0, 0.035, -0.04)));
  $('rD').textContent = 'd⊥ ' + f1((MOV.ult ? MOV.ult.dCarga : 0) * 100) + ' cm'; pos('rD', J.C.clone().lerp(MOV.Pp, 0.5).add(new THREE.Vector3(0, 0.02, 0)));
  pos('rEixo', J.C.clone().add(new THREE.Vector3(0.1, 0, 0)));
}

/* ---------- agachamento: cadeia fechada (tornozelo, joelho, quadril e tronco) ---------- */
// Modelo sagital de 4 segmentos rígidos: pé fixo no chão; perna gira no tornozelo; coxa no joelho; tronco (com cabeça) no quadril.
// O tronco se inclina o quanto for preciso para o centro de massa (corpo + barra) ficar sobre o meio do pé.
const AG = { on: false, k: 90, mob: 35, carga: 60, massa: 75, barra: 'alta', pronto: false, seg: { pe: [], perna: [], coxa: [], tronco: [] }, mus: [], vis: new Set() };
// [nome, altura em relação ao ombro, posição à frente(+)/atrás(-), quanto o joelho avança por grau de flexão]
const BARRAS = { alta: ['Barra alta', 0.045, -0.06, 0.4], baixa: ['Barra baixa', -0.025, -0.08, 0.3], frontal: ['Frontal', 0.05, 0.07, 0.5] };
const AG_MUS = [   // [origem, segmento, inserção, segmento, nome, cor]
  ['Gluteus maximus muscle', 'tronco', 'Gluteus maximus muscle', 'coxa', 'Glúteo máximo', '#ff5d73'],
  ['Adductor magnus', 'tronco', 'Adductor magnus', 'coxa', 'Adutor magno', '#c084fc'],
  ['Semitendinosus muscle', 'tronco', 'Semitendinosus muscle', 'perna', 'Isquiotibiais (semitendíneo)', '#4dabf7'],
  ['Rectus femoris muscle', 'tronco', 'Quadriceps femoris muscle', 'perna', 'Reto femoral', '#ff9f43'],
  ['Vastus lateralis muscle', 'coxa', 'Quadriceps femoris muscle', 'perna', 'Vasto lateral', '#ffd43b'],
  ['Soleus muscle', 'perna', 'Triceps surae muscle', 'pe', 'Sóleo', '#94d82d'],
  ['Medial head of gastrocnemius', 'coxa', 'Triceps surae muscle', 'pe', 'Gastrocnêmio', '#b2f2bb'],
];
const SEG_RE = { pe: /^(Talus|Calcaneus|Navicular bone|Cuboid bone)$|cuneiform|metatarsal|of foot/, perna: /^(Tibia|Fibula)$/, coxa: /^(Femur|Patella)$/,
  braco: /^(Humerus|Radius|Ulna)$|of hand|metacarpal|Scaphoid|Lunate|Triquetrum|Pisiform|Trapezium|Trapezoid|Capitate|Hamate/ };
const plano = v => new THREE.Vector3(0, v.y, v.z);   // eixo de todas as articulações é látero-lateral (X): só y e z importam
async function prepararAg() {
  if (AG.pronto) return;
  await garantir('insercoes');
  const mediaLados = (n, f) => plano(f(n + '.r').add(f(n + '.l')).multiplyScalar(0.5));
  AG.A = mediaLados('Tibia', n => { const vs = vertsMundo(MESH[n]); const mn = Math.min(...vs.map(v => v.y)); const c = media(vs.filter(v => v.y < mn + 0.015)); c.y = mn + 0.012; return c; });
  AG.K = mediaLados('Femur', n => { const vs = vertsMundo(MESH[n]); const mn = Math.min(...vs.map(v => v.y)); const c = media(vs.filter(v => v.y < mn + 0.03)); c.y = mn + 0.022; return c; });
  AG.H = mediaLados('Femur', n => {   // centro da cabeça do fêmur: parte mais alta e mais medial do fêmur
    const vs = vertsMundo(MESH[n]); const mx = Math.max(...vs.map(v => v.y)); const top = vs.filter(v => v.y > mx - 0.05);
    const mid = top.reduce((a, v) => a + Math.abs(v.x), 0) / top.length; const c = media(top.filter(v => Math.abs(v.x) < mid)); c.y = mx - 0.024; return c; });
  AG.S = mediaLados('Humerus', n => { const vs = vertsMundo(MESH[n]); const mx = Math.max(...vs.map(v => v.y)); const c = media(vs.filter(v => v.y > mx - 0.03)); c.y = mx - 0.02; return c; });
  for (const [n, m] of Object.entries(MESH)) {
    if (m.userData.camada !== 'ossos') continue; const b = (E[n] || {}).b || '';
    if (SEG_RE.braco.test(b)) continue;
    const s = SEG_RE.pe.test(b) ? 'pe' : SEG_RE.perna.test(b) ? 'perna' : SEG_RE.coxa.test(b) ? 'coxa' : 'tronco';
    m.updateWorldMatrix(true, false); AG.seg[s].push({ m, M0: m.matrixWorld.clone(), Pi: m.parent.matrixWorld.clone().invert() }); AG.vis.add(n);
  }
  const pe = caixa(AG.seg.pe.map(d => d.m)); AG.M = AG.A.clone(); AG.M.z += 0.045;   // meio do pé: cerca de 4 a 5 cm à frente do tornozelo AG.chao = pe.min.y;
  const centro = (b, t) => { const vs = []; for (const [n, e] of Object.entries(E)) if (e.c === 'insercoes' && e.b === b && e.t === t && e.l === 'direito' && MESH[n]) vs.push(...vertsMundo(MESH[n])); return vs.length ? media(vs) : null; };
  const grupo = new THREE.Group(); grupo.visible = false; scene.add(grupo); AG.grupo = grupo;
  const cil = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), esf = new THREE.SphereGeometry(1, 16, 12);
  for (const [bo, so, bi, si, nome, cor] of AG_MUS) {
    const O = centro(bo, 'origem'), I = centro(bi, 'inserção'); if (!O || !I) continue;
    const mat = new THREE.MeshBasicMaterial({ color: cor, depthTest: false, transparent: true, opacity: 0.85 });
    const tubo = new THREE.Mesh(cil, mat), po = new THREE.Mesh(esf, mat), pi = new THREE.Mesh(esf, mat); po.scale.setScalar(0.007); pi.scale.setScalar(0.007);
    [tubo, po, pi].forEach(o => o.renderOrder = 10); grupo.add(tubo, po, pi); AG.mus.push({ O, so, I, si, nome, cor, tubo, po, pi });
  }
  // barra olímpica (2,2 m) com anilhas
  const ferro = new THREE.MeshStandardMaterial({ color: '#9aa6b5', metalness: 0.6, roughness: 0.3, emissive: '#1b2430' });
  const anilha = new THREE.MeshStandardMaterial({ color: '#3b4a5e', roughness: 0.6, transparent: true, opacity: 0.28, depthWrite: false });
  const barra = new THREE.Group();
  barra.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 16).rotateZ(Math.PI / 2), ferro));
  AG.anilhas = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.03, 32).rotateZ(Math.PI / 2), anilha); a.position.x = s * (0.6 + i * 0.035); barra.add(a); AG.anilhas.push(a); }
  barra.position.x = AG.H.x; grupo.add(barra); AG.barra3d = barra;
  // linha da gravidade da barra e distâncias horizontais até cada articulação
  const tr = (cor, dash) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), dash ? new THREE.LineDashedMaterial({ color: cor, dashSize: 0.012, gapSize: 0.008, depthTest: false }) : new THREE.LineBasicMaterial({ color: cor, depthTest: false })); l.renderOrder = 12; grupo.add(l); return l; };
  AG.linhaG = tr('#ffd43b'); AG.dH = tr('#ff5d73', 1); AG.dK = tr('#ff9f43', 1); AG.dA = tr('#94d82d', 1);
  const verde = new THREE.MeshBasicMaterial({ color: '#3fd8cb', depthTest: false });
  AG.juntas = ['A', 'K', 'H'].map(() => { const b = new THREE.Mesh(esf, verde); b.scale.setScalar(0.012); b.renderOrder = 11; grupo.add(b); return b; });
  AG.pronto = true;
}
const T = (P, ang, Pn = P) => new THREE.Matrix4().makeTranslation(0, Pn.y, Pn.z).multiply(new THREE.Matrix4().makeRotationX(ang * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(0, -P.y, -P.z));
// posição do corpo para uma flexão de joelho k; devolve transformações, ângulos, pontos e momentos
function agPose(k, u = null) {
  const s = Math.min(AG.mob, BARRAS[AG.barra][3] * k), t = k - s;                       // dorsiflexão (canela à frente) e inclinação da coxa
  const Mp = T(AG.A, s), Kp = AG.K.clone().applyMatrix4(Mp);
  const Mc = T(AG.K, -t, Kp), Hp = AG.H.clone().applyMatrix4(Mc);
  const B0 = (() => { const [, dy, dz] = BARRAS[AG.barra]; return new THREE.Vector3(0, AG.S.y + dy, AG.S.z + dz); })();
  const HAT0 = AG.H.clone().lerp(AG.S, 0.626);                           // centro de massa de cabeça, braços e tronco (Winter)
  const coxa0 = AG.H.clone().lerp(AG.K, 0.433), perna0 = AG.K.clone().lerp(AG.A, 0.433);
  const m = { barra: AG.carga, hat: 0.678 * AG.massa, coxa: 0.2 * AG.massa, perna: 0.093 * AG.massa };
  const montar = u => {
    const Mt = T(AG.H, u, Hp);
    const B = B0.clone().applyMatrix4(Mt), HAT = HAT0.clone().applyMatrix4(Mt), C = coxa0.clone().applyMatrix4(Mc), P = perna0.clone().applyMatrix4(Mp);
    const zcm = (m.barra * B.z + m.hat * HAT.z + m.coxa * C.z + m.perna * P.z) / (m.barra + m.hat + m.coxa + m.perna);
    return { Mt, B, HAT, C, P, zcm };
  };
  if (u === null) {   // equilíbrio: centro de massa sobre o meio do pé (busca binária na inclinação do tronco)
    let lo = -15, hi = 85;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; montar(mid).zcm > AG.M.z ? (hi = mid) : (lo = mid); }
    u = (lo + hi) / 2;
  }
  const r = montar(u), g = G;
  // momentos externos por perna (N·m); positivo = pede extensores no quadril e no joelho, flexores plantares no tornozelo
  const mQ = (m.barra * (r.B.z - Hp.z) + m.hat * (r.HAT.z - Hp.z)) * g / 2;
  const mJ = (m.barra * (Kp.z - r.B.z) + m.hat * (Kp.z - r.HAT.z) + m.coxa * (Kp.z - r.C.z)) * g / 2;
  const mT = (m.barra * (r.B.z - AG.A.z) + m.hat * (r.HAT.z - AG.A.z) + m.coxa * (r.C.z - AG.A.z) + m.perna * (r.P.z - AG.A.z)) * g / 2;
  return { s, t, u, k, quadril: t + u, Mp, Mc, Mt: r.Mt, Kp, Hp, B: r.B, mQ, mJ, mT };
}
function agAplicar() {
  const p = agPose(AG.k); AG.p = p;
  const M = { pe: new THREE.Matrix4(), perna: p.Mp, coxa: p.Mc, tronco: p.Mt };
  for (const [s, lst] of Object.entries(AG.seg)) for (const d of lst) { d.m.matrixAutoUpdate = false; d.m.matrix.copy(d.Pi).multiply(M[s]).multiply(d.M0); }
  for (const u of AG.mus) {
    const O = u.O.clone().applyMatrix4(M[u.so]), I = u.I.clone().applyMatrix4(M[u.si]); u.po.position.copy(O); u.pi.position.copy(I);
    const d = _v.subVectors(I, O); u.tubo.position.copy(O); u.tubo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()); u.tubo.scale.set(0.0025, 0.0025, d.length());
  }
  const x = AG.H.x, B = p.B; AG.barra3d.position.set(0, B.y, B.z); AG.barra3d.visible = AG.carga > 0;
  const nAn = AG.carga <= 0 ? 0 : AG.carga <= 60 ? 1 : AG.carga <= 140 ? 2 : 3; AG.anilhas.forEach((a, i) => a.visible = (i % 3) < nAn);
  const v = (y, z) => new THREE.Vector3(x, y, z);
  AG.linhaG.geometry.setFromPoints([v(B.y, B.z), v(AG.chao, B.z)]);
  const hz = (L, P) => { L.geometry.setFromPoints([v(P.y, P.z), v(P.y, B.z)]); L.computeLineDistances(); };
  hz(AG.dH, p.Hp); hz(AG.dK, p.Kp); hz(AG.dA, AG.A);
  [AG.A, p.Kp, p.Hp].forEach((P, i) => AG.juntas[i].position.set(x, P.y, P.z));
  agPainel();
}
function agPainel() {
  if (!$('agK')) return; const p = AG.p;
  $('agK').textContent = Math.round(AG.k) + '°'; $('agS').value = AG.k;
  $('agAng').innerHTML = [['Tornozelo', p.s, 'dorsiflexão'], ['Joelho', p.k, 'flexão'], ['Quadril', p.quadril, 'flexão'], ['Tronco', p.u, 'inclinação à frente']].map(([n, a, d]) => `<div><small>${n} · ${d}</small><b>${Math.round(a)}°</b></div>`).join('');
  const mx = Math.max(10, Math.abs(p.mQ), Math.abs(p.mJ), Math.abs(p.mT));
  const barra = (nome, val, cor, quem, braco) => {
    const F = Math.abs(val) / braco;
    return `<div class="agm"><div class="agm-t"><span><i style="background:${cor}"></i>${nome}</span><b>${f1(Math.abs(val), 0)} N·m</b></div><div class="agm-b"><i style="width:${Math.abs(val) / mx * 100}%;background:${cor}"></i></div><small>${val >= 0 ? quem : 'pede o grupo oposto'} · força estimada ≈ ${f1(F, 0)} N (${f1(F / G, 0)} kgf)</small></div>`;
  };
  $('agM').innerHTML = barra('Quadril', p.mQ, '#ff5d73', 'extensores do quadril (glúteo máximo, adutor magno, isquiotibiais)', 0.07)
    + barra('Joelho', p.mJ, '#ff9f43', 'extensores do joelho (quadríceps)', 0.045) + barra('Tornozelo', p.mT, '#94d82d', 'flexores plantares (sóleo e gastrocnêmio)', 0.05);
  const soma = Math.abs(p.mQ) + Math.abs(p.mJ);
  $('agR').innerHTML = soma > 1 ? `Divisão do esforço entre quadril e joelho: <b style="color:#ff5d73">${Math.round(Math.abs(p.mQ) / soma * 100)}% quadril</b> · <b style="color:#ff9f43">${Math.round(Math.abs(p.mJ) / soma * 100)}% joelho</b>` : '';
  agGraf();
  const toe = Math.max(...AG.seg.pe.map(d => new THREE.Box3().setFromObject(d.m).max.z));
  const z = [
    p.k >= 100 && ['Agachamento profundo', 'A compressão no joelho aumenta com a flexão, mas fica abaixo da capacidade dos tecidos em pessoas treinadas. Com boa técnica e progressão, o agachamento profundo não aumenta o risco de lesão em joelhos saudáveis (Hartmann et al., 2013).', 1],
    p.Kp.z > toe && ['Joelho à frente da ponta do pé', 'É normal e esperado. Impedir o joelho de avançar diminui o torque no joelho, mas aumenta muito o do quadril e a inclinação do tronco (Fry et al., 2003).', 1],
    p.s >= AG.mob - 0.5 && p.k > 30 && ['Tornozelo no limite', 'A dorsiflexão chegou ao máximo: daqui em diante o tronco precisa inclinar mais para o corpo não cair para trás. Calço no calcanhar ou sapato de levantamento ajudam quem tem pouca mobilidade.'],
    p.u >= 45 && ['Tronco muito inclinado', 'Mais exigência para os extensores do quadril e da coluna. Observe se a lombar consegue manter a posição; se ela arredondar sob carga alta, reduza a profundidade ou a carga.'],
    p.quadril >= 115 && ['Fundo do agachamento', 'Com o quadril muito flexionado, a pelve pode girar para trás e a lombar arredondar no fundo. Pouca amplitude não é problema em si; a profundidade ideal é a que a pessoa controla sem dor.'],
  ].filter(Boolean);
  $('agZ').innerHTML = z.map(([t, x, ok]) => `<div class="zona${ok ? ' ok' : ''}"><b>${t}</b><br>${x}</div>`).join('');
}
function agGraf() {
  const cv = $('agG'); if (!cv) return; const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const chave = [AG.mob, AG.carga, AG.massa, AG.barra].join('|');
  if (AG.curvaK !== chave) { AG.curva = []; for (let k = 0; k <= 130; k += 5) { const p = agPose(k); AG.curva.push([k, p.mQ, p.mJ, p.mT]); } AG.curvaK = chave; }
  const pl = 34, pr = 10, pt = 10, pb = 22, W = w - pl - pr, H = h - pt - pb;
  const vals = AG.curva.flatMap(c => c.slice(1)), mx = Math.max(10, ...vals) * 1.1, mn = Math.min(0, ...vals) * 1.1;
  const X = k => pl + k / 130 * W, Y = v => pt + H - (v - mn) / (mx - mn) * H;
  x.font = '10px Instrument Sans, sans-serif'; x.fillStyle = '#939dba'; x.strokeStyle = '#243344'; x.lineWidth = 1;
  for (const k of [0, 45, 90, 120]) { x.beginPath(); x.moveTo(X(k), pt); x.lineTo(X(k), pt + H); x.stroke(); x.textAlign = 'center'; x.fillText(k + '°', X(k), h - 6); }
  x.beginPath(); x.moveTo(pl, Y(0)); x.lineTo(pl + W, Y(0)); x.stroke();
  x.textAlign = 'right'; x.fillText(f1(mx / 1.1, 0), pl - 4, Y(mx / 1.1) + 3); x.fillText('0', pl - 4, Y(0) + 3);
  [[1, '#ff5d73'], [2, '#ff9f43'], [3, '#94d82d']].forEach(([i, cor]) => { x.beginPath(); AG.curva.forEach((c, j) => { j ? x.lineTo(X(c[0]), Y(c[i])) : x.moveTo(X(c[0]), Y(c[i])); }); x.strokeStyle = cor; x.lineWidth = 2; x.stroke(); });
  x.strokeStyle = '#3fd8cb'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(X(AG.k), pt); x.lineTo(X(AG.k), pt + H); x.stroke(); x.setLineDash([]);
}
function painelAg() {
  $('pT').textContent = 'Agachamento · biomecânica'; $('pS').innerHTML = '<span class="tag">cadeia fechada</span>tornozelo, joelho e quadril';
  $('pB').innerHTML = `<div class="mv">
    <p style="margin-top:2px">Arraste o corpo para <b>cima e para baixo</b> no modelo, ou use a barra abaixo.</p>
    <div class="mv-ang"><b id="agK">0°</b><span>de flexão do joelho<br>(profundidade do agachamento)</span></div>
    <input id="agS" type="range" min="0" max="130" step="1" value="${AG.k}">
    <div class="kp ag4" id="agAng"></div>
    <div class="seg" id="agB">${Object.entries(BARRAS).map(([k, [t]]) => `<button data-b="${k}" class="${k === AG.barra ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="mv-ctl"><span>Carga na barra</span><output id="agCo">${AG.carga} kg</output><input id="agC" type="range" min="0" max="200" step="5" value="${AG.carga}"></div>
    <div class="mv-ctl"><span>Mobilidade de tornozelo (dorsiflexão máxima)</span><output id="agMo">${AG.mob}°</output><input id="agMob" type="range" min="10" max="45" step="1" value="${AG.mob}"></div>
    <div class="mv-ctl"><span>Massa corporal</span><output id="agPo">${AG.massa} kg</output><input id="agP" type="range" min="40" max="140" step="1" value="${AG.massa}"></div>
    <h3>Momento externo em cada articulação (por perna)</h3><div id="agM"></div><p id="agR" style="font-size:13px"></p><div id="agZ"></div>
    <h3>Ao longo da descida</h3>
    <div class="leg"><span><i style="background:#ff5d73"></i>quadril</span><span><i style="background:#ff9f43"></i>joelho</span><span><i style="background:#94d82d"></i>tornozelo</span><span>(N·m por perna × flexão do joelho)</span></div>
    <canvas id="agG" style="width:100%;height:170px;display:block;margin-top:6px"></canvas>
    <h3>Como ler</h3>
    <p>A <b>linha amarela</b> desce da barra até o chão. Para ficar em equilíbrio, o corpo se ajusta para o centro de massa (corpo + barra) ficar sobre o <b>meio do pé</b>. As linhas tracejadas mostram a <b>distância horizontal</b> de cada articulação até essa linha: quanto maior, maior o momento que os músculos daquela articulação precisam vencer.</p>
    <p><b>Barra alta x barra baixa x frontal:</b> com a barra mais baixa nas costas, o tronco inclina mais, o quadril se afasta da linha e o esforço vai para os extensores do quadril. Na frontal, o tronco fica mais vertical e o joelho avança mais (se a mobilidade de tornozelo permitir), e o quadríceps assume mais.</p>
    <p><b>Mobilidade de tornozelo:</b> diminua a dorsiflexão e veja o que acontece: o joelho avança menos, o tronco precisa inclinar mais para o corpo não cair para trás, e o esforço migra do joelho para o quadril e a lombar.</p>
    <p><b>Tornozelo:</b> como o centro de massa fica sempre sobre o meio do pé, o momento no tornozelo quase não muda com a profundidade. Ele cresce com o peso total (corpo + barra).</p>
    <p><b>Profundidade:</b> os momentos no quadril e no joelho aumentam conforme você desce. O joelho chega perto do máximo por volta da paralela e o quadril continua subindo.</p>
    <div class="aviso">Valores aproximados para estudo: modelo no plano sagital com segmentos rígidos (o tronco não flexiona a coluna), carga dividida igualmente entre as pernas, centro de massa dos segmentos e massas pelas proporções de Winter. A força estimada usa braços de momento médios: 7 cm para os extensores do quadril, 4,5 cm para o quadríceps e 5 cm para o tendão do calcâneo. As linhas coloridas mostram a linha de tração de alguns músculos do lado direito.</div>
    <div class="fontes">Fontes: Neumann. Cinesiologia do aparelho musculoesquelético, caps. 12 e 13 · Escamilla (2001), Knee biomechanics of the dynamic squat exercise, Med Sci Sports Exerc · Hartmann, Wirth e Klusemann (2013), Sports Med · Fry, Smith e Schilling (2003), J Strength Cond Res · Winter. Biomechanics and Motor Control of Human Movement · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div></div>`;
  $('painel').classList.add('on'); painelAberto = true; resize();
  $('agS').oninput = e => { AG.k = +e.target.value; agAplicar(); };
  $('agC').oninput = e => { AG.carga = +e.target.value; $('agCo').textContent = AG.carga + ' kg'; agAplicar(); };
  $('agMob').oninput = e => { AG.mob = +e.target.value; $('agMo').textContent = AG.mob + '°'; agAplicar(); };
  $('agP').oninput = e => { AG.massa = +e.target.value; $('agPo').textContent = AG.massa + ' kg'; agAplicar(); };
  $('agB').onclick = e => { const b = e.target.closest('button'); if (!b) return; AG.barra = b.dataset.b; $('agB').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); agAplicar(); };
}
async function entrarAg() {
  toast('Preparando o agachamento…'); await prepararAg();
  if (MOV.on) sairMov(false);
  AG.on = true; MOV.vis = AG.vis; document.body.classList.add('mov'); if (modoTirar) $('bTirar').click();
  AG.grupo.visible = true; grid.visible = true; $('rot').innerHTML = '<span id="rA" style="color:#94d82d"></span><span id="rK" style="color:#ff9f43"></span><span id="rH" style="color:#ff5d73"></span>'; $('rot').style.display = '';
  aplicarVis(); destacar(null); painelAg(); agAplicar(); agEnquadrar();
  toast('Arraste o corpo para cima e para baixo');
}
function agEnquadrar() {
  // vista lateral direita do corpo inteiro em pé até o agachamento profundo, descontando o painel
  scene.updateMatrixWorld(true); const b = new THREE.Box3(); for (const lst of Object.values(AG.seg)) for (const d of lst) b.expandByObject(d.m);
  const pf = agPose(120); b.expandByPoint(pf.B.clone().setX(AG.H.x)); b.expandByPoint(pf.Hp.clone().setX(AG.H.x));
  const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()); sz.x = 0.3;
  const W = innerWidth, H = innerHeight, area = areaLivre();
  const t = Math.tan(cam.fov * Math.PI / 360), aw = (area.x1 - area.x0) / W, ah = (area.y1 - area.y0) / H;
  const dist = 1.08 * Math.max(sz.y / 2 / (t * ah), sz.z / 2 / (t * cam.aspect * aw)) + 0.3;
  const dir = new THREE.Vector3(-1, 0.05, 0.12).normalize(), fwd = dir.clone().negate(), dr = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(dr, fwd);
  const wpp = 2 * dist * t / H, dx = (area.x0 + area.x1) / 2 - W / 2, dy = (area.y0 + area.y1) / 2 - H / 2;
  voar(c.clone().addScaledVector(dr, -dx * wpp).addScaledVector(up, dy * wpp).toArray(), dist, dir, false);
}
function sairAg(fechaPainel = true) {
  AG.on = false; AG.arrastando = false; ctl.enabled = true; document.body.classList.remove('mov');
  for (const lst of Object.values(AG.seg)) for (const d of lst) { d.m.matrixAutoUpdate = true; d.m.updateMatrix(); }
  AG.grupo.visible = false; $('rot').style.display = 'none'; aplicarVis(); if (fechaPainel) fechar();
}
function agDown(e) {
  mirar(e); const alvos = Object.values(AG.seg).flat().map(d => d.m);
  if (!ray.intersectObjects([...alvos, AG.barra3d], true).length) return;
  AG.arrastando = { y: e.clientY, k: AG.k }; ctl.enabled = false; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
}
function agMove(e) {
  const d = AG.arrastando; const k = Math.max(0, Math.min(130, d.k + (e.clientY - d.y) * 0.45));
  if (Math.abs(k - AG.k) > 0.3) { AG.k = k; agAplicar(); }
}
function agQuadro() {
  const p = AG.p; if (!p) return;
  const pos = (id, P, txt, dx = 0.0) => { const el = $(id); el.textContent = txt; _s.set(AG.H.x - 0.06, P.y, P.z + dx).project(cam); el.style.left = (_s.x + 1) / 2 * innerWidth + 'px'; el.style.top = (1 - _s.y) / 2 * innerHeight + 'px'; };
  pos('rA', AG.A, 'tornozelo ' + Math.round(p.s) + '°', -0.07); pos('rK', p.Kp, 'joelho ' + Math.round(p.k) + '°', 0.09); pos('rH', p.Hp, 'quadril ' + Math.round(p.quadril) + '°', -0.1);
}

/* ---------- motor de pose (GPU): desvios posturais e corpo inteiro em movimento ---------- */
const POST = DADOS.posturas; let desvioAtivo = null;
const CORES_P = { enc: '#ff8a3d', alo: '#4dabf7', ten: '#c084fc' };
const ROT_P = { enc: 'Encurtados', alo: 'Alongados ou enfraquecidos', ten: 'Tensionados (hiperativos)' };
const LOCAIS = ['Pé e tornozelo', 'Joelho', 'Quadril', 'Pelve e lombar', 'Pelve e tronco', 'Coluna torácica', 'Coluna (plano frontal)', 'Cintura escapular', 'Coluna cervical', 'Padrão global do tronco superior'];
const QUADRO = { pes: [0.25, 0.75, -0.1], antebraco: [0.86, 0.62, -0.24], ombro: [1.5, 1.5], pernas: [0.56, 1.22], corpo: [0.9, 1.92], alto: [1.08, 2.32], tronco: [1.22, 1.0], braco: [1.2, 1.1, -0.12], cabeca: [1.47, 0.62], deitado: [0.48, 1.0, 0, -0.62, 1.85] };   // [altura do centro, altura visível, x, z, largura visível] em metros
const VISTAS = { lat: [-1, 0.06, 0.14], post: [0.14, 0.08, -1], ant: [-0.22, 0.08, 1], obl: [0.8, 0.28, -1], frente: [-0.75, 0.16, 0.65], pl: [-1, 0.1, -0.5], alto: [-0.55, 1.15, 0.8] };
// Pose de cada desvio no grau máximo (graus; cm em "dentro", "tras", "comp" e "elev"). col: [flexão(+)/extensão(-), inclinação lateral, rotação axial] somados na região.
const POSES = {
  'pe-plano': { pe: { ev: 10, abd: 6 }, perna: { tibRot: 7, femRot: 4, dentro: 1.2 }, pelve: { ant: 3 }, col: { lum: [-3] }, fer: ['post', 'q'], vista: 'post', quadro: 'pernas' },
  'pe-cavo': { pe: { ev: -8 }, perna: { tibRot: -4, dentro: -1 }, fer: ['post'], vista: 'post', quadro: 'pernas' },
  valgo: { perna: { dentro: 3.2, femRot: 5 }, pe: { ev: 6 }, fer: ['q', 'post'], vista: 'ant', quadro: 'pernas' },
  varo: { perna: { dentro: -4 }, pe: { ev: -4 }, fer: ['q', 'post'], vista: 'ant', quadro: 'pernas' },
  recurvato: { perna: { tras: 4.5 }, pelve: { ant: 4 }, col: { lum: [-4] }, fer: ['lat'], vista: 'lat', quadro: 'pernas' },
  'rot-medial-femur': { perna: { femRot: 18, dentro: 1.5 }, pe: { abd: -10, ev: 4 }, pelve: { ant: 4 }, col: { lum: [-4] }, fer: ['q'], vista: 'ant', quadro: 'pernas' },
  anteversao: { perna: { inclina: -2.2 }, pelve: { ant: 13 }, col: { lum: [-15], torI: [5], torS: [3], cerI: [2], cerS: [-8] }, fer: ['lat'], vista: 'lat', quadro: 'corpo' },
  retroversao: { pelve: { ant: -10 }, col: { lum: [10] }, fer: ['lat'], vista: 'lat', quadro: 'corpo' },
  obliquidade: { perna: { comp: { d: 2 } }, compLat: 1, fer: ['post'], vista: 'post', quadro: 'corpo' },
  swayback: { perna: { inclina: 4, tras: 2 }, pelve: { ant: -10 }, col: { lum: [-2], torI: [8], torS: [8], cerI: [8], cerS: [-12] }, fer: ['lat'], vista: 'lat', quadro: 'corpo' },
  cifose: { col: { lum: [-6], torI: [12], torS: [14], cerI: [6], cerS: [-26] }, esc: { prot: 8, tilt: 6 }, braco: { rot: 10 }, fer: ['lat'], vista: 'lat', quadro: 'corpo' },
  escoliose: { col: { lum: [0, 11, 5], torI: [0, -22, -9], torS: [0, 11, 4] }, fer: ['post'], vista: 'post', quadro: 'corpo' },
  ombros: { esc: { prot: 14, tilt: 10 }, braco: { rot: 22 }, col: { torS: [6], cerI: [4], cerS: [-10] }, fer: ['lat'], vista: 'lat', quadro: 'tronco' },
  'escapula-alada': { esc: { wing: 24, tilt: 7, lado: 'd' }, fer: ['post'], vista: 'obl', quadro: 'tronco' },
  'ombro-elevado': { esc: { elev: 2.6, rotInf: 6 }, col: { cerI: [6], cerS: [-6] }, fer: ['post'], vista: 'post', quadro: 'tronco' },
  cabeca: { col: { torS: [4], cerI: [24], cerS: [-28] }, fer: ['lat'], vista: 'lat', quadro: 'cabeca' },
  'cruzada-superior': { esc: { prot: 14, tilt: 10, elev: 1 }, braco: { rot: 22 }, col: { lum: [-4], torI: [6], torS: [12], cerI: [22], cerS: [-36] }, fer: ['lat'], vista: 'lat', quadro: 'tronco' },
};
const FER_N = { lat: 'Prumo lateral', post: 'Prumo posterior', q: 'Ângulo Q' };

// Pesos de pele (quanto cada vértice de músculo segue cada osso). Roda num Web Worker; o código vai para o worker pelo toString().
function* pesosGen(d) {
  const { px, py, pz, ps, cel, nseg, FY, malhas, segs, pares } = d, U = FY.length - 1, mapa = new Map();
  const chave = (a, b, c) => (a + 512) | ((b + 512) << 10) | ((c + 512) << 20);
  for (let q = 0; q < px.length; q++) { const k = chave(Math.floor(px[q] / cel), Math.floor(py[q] / cel), Math.floor(pz[q] / cel)); let a = mapa.get(k); if (!a) mapa.set(k, a = []); a.push(q); }
  // cadeias dos membros: nível de cada segmento (escápula e clavícula → úmero → antebraço; pelve → coxa → perna → pé → dedos)
  const NIVEL = { esc: 0, cla: 0, umero: 1, ulna: 2, radio: 2, mao: 3, fp: 4, po: 4, fm: 5, fd: 6, coxa: 1, perna: 2, pe: 3, dedos: 4 };
  const info = ['campo', ...segs].map(n => { if (n === 'pelve') return { t: 'membro', c: '*', n: 0 }; const m = /^(esc|cla|umero|ulna|radio|mao|fp|fm|fd|po|coxa|perna|pe|dedos)([de])$/.exec(n); if (!m) return { t: 'tronco' }; return { t: 'membro', c: (/^(esc|cla|umero|ulna|radio|mao|fp|fm|fd|po)$/.test(m[1]) ? 'b' : 'p') + m[2], n: NIVEL[m[1]] }; });
  // ossos intermediários de cada articulação (1/4, 1/2 e 3/4 da rotação): evitam que o músculo "murche" quando a articulação gira muito
  const idxSeg = new Map(['campo', ...segs].map((n, i) => [n, i])), parMap = new Map();
  idxSeg.set('tord', -2); idxSeg.set('tore', -3);   // tronco (para pares tronco → úmero)
  for (const p of pares) { const a = idxSeg.get(p.a) ?? -1, b = idxSeg.get(p.b), o = { P: p.P, D: p.D, ombro: /^(esc|cla)/.test(p.a), quad: p.a === 'pelve' }; parMap.set(a + '|' + b, { a, b, h: p.h, ...o, inv: false }); parMap.set(b + '|' + a, { a: b, b: a, h: [...p.h].reverse(), ...o, inv: true }); }
  const melhor = new Float32Array(nseg + 1), lista = [], cb = new Int16Array(16), cp = new Float32Array(16), livre = new Uint8Array(nseg + 1); let nc = 0;
  const add = (b, p) => { if (p <= 1e-6) return; for (let t = 0; t < nc; t++) if (cb[t] === b) { cp[t] += p; return; } if (nc < 16) { cb[nc] = b; cp[nc++] = p; } };
  let fj = 0, ff = 0;
  const campoAdd = p => { add(nseg + fj, p * (1 - ff)); add(nseg + fj + 1, p * ff); };
  const seg1 = (s, p) => s === 0 ? campoAdd(p) : add(s - 1, p);
  // ossos mais próximos do ponto (só entre os segmentos liberados); escala tudo por "peso"
  function prox(x, y, z, peso, filtro) {
    const ix = Math.floor(x / cel), iy = Math.floor(y / cel), iz = Math.floor(z / cel); lista.length = 0;
    for (const r of [1, 2, 4]) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        const arr = mapa.get(chave(ix + a, iy + b, iz + c)); if (!arr) continue;
        for (let t = 0; t < arr.length; t++) { const q = arr[t], s = ps[q]; if (filtro && !livre[s]) continue; const dx = px[q] - x, dy = py[q] - y, dz = pz[q] - z, d2 = dx * dx + dy * dy + dz * dz + 1e-9; if (melhor[s] === 0) { lista.push(s); melhor[s] = d2; } else if (d2 < melhor[s]) melhor[s] = d2; }
      }
      if (lista.length) break;
    }
    if (!lista.length) { if (filtro) return prox(x, y, z, peso, false); campoAdd(peso); return; }
    lista.sort((a, b) => melhor[a] - melhor[b]); const lim = (2.2 * Math.sqrt(melhor[lista[0]]) + 0.012) ** 2, sel = [], pw = []; let tot = 0;
    for (const s of lista) { if (sel.length < 3 && melhor[s] <= lim) { const p = 1 / (melhor[s] + 4e-5) ** 2; sel.push(s); pw.push(p); tot += p; } melhor[s] = 0; }
    for (let k = 0; k < sel.length; k++) seg1(sel[k], peso * pw[k] / tot);
  }
  function maisPerto(x, y, z) { prox(x, y, z, 1, false); let m = -1, best = -1; for (let t = 0; t < nc; t++) if (cp[t] > best) { best = cp[t]; m = cb[t]; } nc = 0; return m >= nseg ? 0 : m + 1; }
  // distribui "peso" ao longo da cadeia sa → (3 intermediários) → sb, na fração f (0 = sa, 1 = sb); noTronco: a ponta sa segue os ossos do tronco mais próximos
  function cadeia(p, f, peso, x, y, z, noTronco) {
    const k = Math.min(3, Math.floor(f * 4)), t = f * 4 - k;
    const no = (j, w) => { if (w <= 1e-6) return; if (j === 0) { if (noTronco) prox(x, y, z, w, true); else seg1(p.a, w); } else if (j === 4) seg1(p.b, w); else add(nseg + U + 1 + p.h[j - 1], w); };
    no(k, peso * (1 - t)); no(k + 1, peso * t);
  }
  // depois da proximidade: se os dois ossos principais forem os dois lados de uma articulação, troca pela cadeia de intermediários
  function converter(x, y, z) {
    let i1 = -1, i2 = -1; for (let t = 0; t < nc; t++) { if (cb[t] >= nseg) continue; if (i1 < 0 || cp[t] > cp[i1]) { i2 = i1; i1 = t; } else if (i2 < 0 || cp[t] > cp[i2]) i2 = t; }
    if (i1 < 0 || i2 < 0) return; const p = parMap.get((cb[i1] + 1) + '|' + (cb[i2] + 1)); if (!p) return;
    const w1 = cp[i1], w2 = cp[i2]; cp[i1] = 0; cp[i2] = 0; let f = w2 / (w1 + w2);
    if (!p.ombro && p.P) { const fd = suave(-0.035, 0.035, (x - p.P[0]) * p.D[0] + (y - p.P[1]) * p.D[1] + (z - p.P[2]) * p.D[2]); f = 0.35 * f + 0.65 * (p.inv ? 1 - fd : fd); }
    cadeia(p, f, w1 + w2, x, y, z, false);
  }
  const parTronco = sb => parMap.get((idxSeg.get(/^umero/.test(['campo', ...segs][sb]) ? 'tor' + ['campo', ...segs][sb].slice(-1) : 'pelve') ?? -9) + '|' + sb);
  const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const yMao = d.yMao ?? -9, dedosLivre = {}; info.forEach((f, s) => { if (f.t === 'membro' && f.c[0] === 'b' && f.n >= 3) (dedosLivre[f.c] = dedosLivre[f.c] || new Uint8Array(nseg + 1))[s] = 1; });
  const temDedos = Object.values(dedosLivre).some(a => a.reduce((x, y) => x + y, 0) > 1);
  // Suaviza os pesos pela superfície do músculo: vizinhos passam a seguir os ossos de forma parecida.
  // Sem isso, cada vértice escolhe sozinho e aparecem "dentes", lascas e rasgos nas bordas e nas articulações.
  function suavizar(n, w, ix, idx, wt, fixo, voltas = 4) {
    const rep = new Int32Array(n), mp = new Map();
    for (let i = 0; i < n; i++) { const k = Math.round(w[3 * i] * 2e4) + ',' + Math.round(w[3 * i + 1] * 2e4) + ',' + Math.round(w[3 * i + 2] * 2e4); const r = mp.get(k); if (r === undefined) { mp.set(k, i); rep[i] = i; } else rep[i] = r; }
    const ini = new Int32Array(n + 1), cont = new Int32Array(n);
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[ix[t + e]], b = rep[ix[t + (e + 1) % 3]]; if (a !== b) { cont[a]++; cont[b]++; } }
    for (let i = 0; i < n; i++) ini[i + 1] = ini[i] + cont[i];
    const viz = new Int32Array(ini[n]), pos = ini.slice(0, n);
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[ix[t + e]], b = rep[ix[t + (e + 1) % 3]]; if (a !== b) { viz[pos[a]++] = b; viz[pos[b]++] = a; } }
    let I0 = idx, W0 = wt; const bI = new Int32Array(24), bW = new Float32Array(24);
    for (let v = 0; v < voltas; v++) {
      const I1 = new Uint8Array(n * 4), W1 = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        if (rep[i] !== i) continue;
        if (fixo[i] || ini[i + 1] === ini[i]) { for (let k = 0; k < 4; k++) { I1[4 * i + k] = I0[4 * i + k]; W1[4 * i + k] = W0[4 * i + k]; } continue; }
        let m = 0; const soma = (j, f) => { for (let k = 0; k < 4; k++) { const p = W0[4 * j + k] * f; if (p <= 0) continue; const b = I0[4 * j + k]; let t = 0; for (; t < m; t++) if (bI[t] === b) { bW[t] += p; break; } if (t === m && m < 24) { bI[m] = b; bW[m++] = p; } } };
        soma(i, 0.5); const f = 0.5 / (ini[i + 1] - ini[i]); for (let q = ini[i]; q < ini[i + 1]; q++) soma(viz[q], f);
        let tot = 0; for (let k = 0; k < 4; k++) { let b = -1; for (let t = 0; t < m; t++) if (bW[t] > 0 && (b < 0 || bW[t] > bW[b])) b = t; if (b < 0) break; I1[4 * i + k] = bI[b]; W1[4 * i + k] = bW[b]; tot += bW[b]; bW[b] = -1; }
        for (let k = 0; k < 4; k++) W1[4 * i + k] /= tot || 1;
      }
      for (let i = 0; i < n; i++) { const r = rep[i]; if (r !== i) for (let k = 0; k < 4; k++) { I1[4 * i + k] = I1[4 * r + k]; W1[4 * i + k] = W1[4 * r + k]; } }
      I0 = I1; W0 = W1;
    }
    idx.set(I0); wt.set(W0);
  }
  // malha soldada (vértices repetidos nas costuras contam como um só) e seus vizinhos
  function grafo(n, w, ix) {
    const rep = new Int32Array(n), mp = new Map();
    for (let i = 0; i < n; i++) { const k = Math.round(w[3 * i] * 2e4) + ',' + Math.round(w[3 * i + 1] * 2e4) + ',' + Math.round(w[3 * i + 2] * 2e4); const r = mp.get(k); if (r === undefined) { mp.set(k, i); rep[i] = i; } else rep[i] = r; }
    const cont = new Int32Array(n), ini = new Int32Array(n + 1);
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[ix[t + e]], b = rep[ix[t + (e + 1) % 3]]; if (a !== b) { cont[a]++; cont[b]++; } }
    for (let i = 0; i < n; i++) ini[i + 1] = ini[i] + cont[i];
    const viz = new Int32Array(ini[n]), pos = ini.slice(0, n);
    for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[ix[t + e]], b = rep[ix[t + (e + 1) % 3]]; if (a !== b) { viz[pos[a]++] = b; viz[pos[b]++] = a; } }
    return { rep, ini, viz };
  }
  // distância medida pela superfície do músculo até um conjunto de vértices (e qual deles é o mais próximo)
  function geod(G, w, n, fontes) {
    const { rep, ini, viz } = G, d = new Float64Array(n).fill(1e9), src = new Int32Array(n).fill(-1), hp = [], hd = [];
    const push = (v, dv) => { let i = hp.length; hp.push(v); hd.push(dv); while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= dv) break; hp[i] = hp[p]; hd[i] = hd[p]; i = p; } hp[i] = v; hd[i] = dv; };
    for (const f of fontes) { const r = rep[f]; if (d[r] > 0) { d[r] = 0; src[r] = r; push(r, 0); } }
    while (hp.length) {
      const v = hp[0], dv = hd[0], lv = hp.pop(), ld = hd.pop(), m = hp.length;
      if (m) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= m) break; if (c + 1 < m && hd[c + 1] < hd[c]) c++; if (hd[c] >= ld) break; hp[i] = hp[c]; hd[i] = hd[c]; i = c; } hp[i] = lv; hd[i] = ld; }
      if (dv > d[v]) continue;
      for (let q = ini[v]; q < ini[v + 1]; q++) { const u = viz[q], nd = dv + Math.hypot(w[3 * u] - w[3 * v], w[3 * u + 1] - w[3 * v + 1], w[3 * u + 2] - w[3 * v + 2]); if (nd < d[u]) { d[u] = nd; src[u] = src[v]; push(u, nd); } }
    }
    return { d, src };
  }
  for (let mi = 0; mi < malhas.length; mi++) {
    const { id, w, campo, ix } = malhas[mi], n = w.length / 3, idx = new Uint8Array(n * 4), wt = new Float32Array(n * 4), fv = new Float32Array(n).fill(-1), fixo = new Uint8Array(n);
    // eixo mais longo do músculo e os ossos em cada ponta
    let modo = 'prox', ax = 1, lo = 0, hi = 1, sA = 0, sB = 0, ptA = [0, 0, 0], ptB = [0, 0, 0], raioB = 0.15;
    let bi = null, soTronco = false;   // bi: músculo de duas articulações que nasce na pelve, na escápula ou na clavícula
    let serr = null; { const sz = /^Serratus anterior.*\.([rl])$/.exec(id), es = sz && idxSeg.get('esc' + (sz[1] === 'r' ? 'd' : 'e')); if (es != null) { let z0 = 1e9, z1 = -1e9; for (let i = 0; i < n; i++) { const z = w[3 * i + 2]; if (z < z0) z0 = z; if (z > z1) z1 = z; } const zc = (z0 + z1) / 2, th = new Float32Array(n); let t0 = 1e9, t1 = -1e9; for (let i = 0; i < n; i++) { const t = Math.atan2(w[3 * i + 2] - zc, Math.abs(w[3 * i])); th[i] = t; if (t < t0) t0 = t; if (t > t1) t1 = t; } serr = { es, th, t0, t1 }; } }
    if (!campo) {
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = w[3 * i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
      ax = [0, 1, 2].reduce((a, b) => (mx[b] - mn[b] > mx[a] - mn[a] ? b : a), 0); lo = mn[ax]; hi = mx[ax];
      const votos = [new Map(), new Map()], passo = Math.max(1, Math.floor(n / 600)), pont = [[0, 0, 0, 0], [0, 0, 0, 0]];
      for (let i = 0; i < n; i += passo) { const s = (w[3 * i + ax] - lo) / (hi - lo || 1), e = s < 0.12 ? 0 : s > 0.88 ? 1 : -1; if (e < 0) continue; const y = w[3 * i + 1]; fj = 0; ff = 0; if (y >= FY[U]) { fj = U - 1; ff = 1; } else if (y > FY[0]) { while (y >= FY[fj + 1]) fj++; ff = (y - FY[fj]) / (FY[fj + 1] - FY[fj]); } const sg = maisPerto(w[3 * i], y, w[3 * i + 2]); votos[e].set(sg, (votos[e].get(sg) || 0) + 1); const pp = pont[e]; pp[0] += w[3 * i]; pp[1] += y; pp[2] += w[3 * i + 2]; pp[3]++; }
      const tip = e => { const pp = pont[e]; return [pp[0] / (pp[3] || 1), pp[1] / (pp[3] || 1), pp[2] / (pp[3] || 1)]; }; ptA = tip(0); ptB = tip(1); raioB = Math.min(0.2, Math.max(0.08, 0.45 * (hi - lo)));
      const top = m => { let b = 0, c = -1; for (const [s, v] of m) if (v > c) { c = v; b = s; } return b; };
      sA = top(votos[0]); sB = top(votos[1]);
      { const fz = /^(Long|Short) head of biceps brachii\.([rl])$/.exec(id); if (fz) { const l = fz[2] === 'r' ? 'd' : 'e', a = idxSeg.get('esc' + l), b = idxSeg.get('radio' + l); if (a != null && b != null) { if (ptA[1] > ptB[1]) { sA = a; sB = b; } else { sA = b; sB = a; } } } }
      const A = info[sA], B = info[sB];
      livre.fill(0);
      const braco = f => f.t === 'membro' && f.c[0] === 'b';
      if ((A.c === '*' && braco(B)) || (B.c === '*' && braco(A))) {   // pelve → braço (grande dorsal): a pelve conta como tronco
        modo = 'misto'; info.forEach((f, s) => { if (f.t === 'tronco' || f.c === '*') livre[s] = 1; });
        if (braco(A)) { const t = sA; sA = sB; sB = t; lo = hi + (hi = lo, 0); ptB = tip(0); }
      } else if (A.t === 'membro' && B.t === 'membro' && (A.c === B.c || A.c === '*' || B.c === '*')) {
        const ca = A.c === '*' ? B.c : A.c, dif = Math.abs(A.n - B.n);
        if (sA === sB) modo = 'rigido';
        else if (dif <= 1) modo = 'eixo';
        else { modo = 'cadeia'; const n0 = Math.min(A.n, B.n), n1 = Math.max(A.n, B.n), o0 = A.n === n0 ? sA : sB;
          if (n0 === 0 && [...parMap.values()].some(p => p.a === o0 && (p.ombro || p.quad))) bi = { o: o0 };   // a primeira articulação (ombro ou quadril) é resolvida por fibras retas; o resto da cadeia, pelos ossos seguintes
          info.forEach((f, s) => { if (f.t === 'membro' && (f.c === ca || f.c === '*') && f.n >= (bi ? 1 : n0) && f.n <= n1) livre[s] = 1; }); }
      } else if (A.t !== B.t) { modo = 'misto'; info.forEach((f, s) => { if (f.t === 'tronco' || f.c === '*') livre[s] = 1; }); if (A.t === 'membro') { const t = sA; sA = sB; sB = t; lo = hi + (hi = lo, 0); ptB = tip(0); } }
      else if (A.t === 'tronco' && B.t === 'tronco') { soTronco = true; info.forEach((f, s) => { if (f.t === 'tronco' || f.c === '*') livre[s] = 1; }); }   // músculo do tronco: nunca segue a escápula nem o braço, mesmo passando por baixo deles
      if (/^Iliopectineal arch/.test(id)) { const pv = idxSeg.get('pelve'); if (pv != null) { modo = 'rigido'; sA = sB = pv; bi = null; } }   // faixa de fáscia da pelve
    }
    for (let i = 0; i < n; i++) {
      const x = w[3 * i], y = w[3 * i + 1], z = w[3 * i + 2]; nc = 0;
      fj = 0; ff = 0; if (y >= FY[U]) { fj = U - 1; ff = 1; } else if (y > FY[0]) { while (y >= FY[fj + 1]) fj++; ff = (y - FY[fj]) / (FY[fj + 1] - FY[fj]); }
      let dedo = false;
      if (!campo && temDedos && y < yMao) {   // perto dos dedos: segue as falanges mais próximas (MCF → IFP → IFD), com transição pelos intermediários
        const s0 = maisPerto(x, y, z), f0 = info[s0];
        if (f0 && f0.t === 'membro' && f0.n >= 4 && f0.c[0] === 'b') { const sv = livre.slice(); livre.set(dedosLivre[f0.c]); prox(x, y, z, 1, true); converter(x, y, z); livre.set(sv); dedo = true; }
        fj = 0; ff = 0; if (y >= FY[U]) { fj = U - 1; ff = 1; } else if (y > FY[0]) { while (y >= FY[fj + 1]) fj++; ff = (y - FY[fj]) / (FY[fj + 1] - FY[fj]); }
      }
      if (dedo) {}
      else if (serr) { const f = suave(0.5, 0.96, (serr.t1 - serr.th[i]) / (serr.t1 - serr.t0 || 1)); campoAdd(1 - f); seg1(serr.es, f); }   // as digitações ficam nas costelas; só o trecho de trás, sob a escápula, vai com ela
      else if (campo) campoAdd(1);
      else if (modo === 'rigido') seg1(sA, 1);
      else if (modo === 'cadeia') { prox(x, y, z, 1, true); converter(x, y, z); }
      else {
        const sv = (w[3 * i + ax] - lo) / (hi - lo || 1), wb = suave(0.3, 0.72, sv);
        if (modo === 'eixo') {
          const p = parMap.get(sA + '|' + sB);
          if (!p) { seg1(sA, 1 - wb); seg1(sB, wb); fv[i] = wb; }
          else if (p.ombro) {   // ombro: só a parte perto do tendão no úmero acompanha o braço
            const um = p.inv ? ptA : ptB, f = 1 - suave(0.015, raioB, Math.hypot(x - um[0], y - um[1], z - um[2])), fb = p.inv ? 1 - f : f; cadeia(p, fb, 1, x, y, z, false); fv[i] = fb;
          } else {   // demais articulações: o que está além da articulação segue o osso de baixo, com transição de ~3,5 cm
            const fd = suave(-0.035, 0.035, (x - p.P[0]) * p.D[0] + (y - p.P[1]) * p.D[1] + (z - p.P[2]) * p.D[2]), fb = p.inv ? 1 - fd : fd; cadeia(p, fb, 1, x, y, z, false); fv[i] = fb;
          }
        }
        else if (modo === 'misto') {   // ponta no tronco segue a coluna; ponta no membro segue o osso, passando pelos intermediários
          const p = parTronco(sB);
          const dB = Math.hypot(x - ptB[0], y - ptB[1], z - ptB[2]), fm = 1 - suave(0.015, raioB, dB);
          if (p) cadeia(p, fm, 1, x, y, z, true); else { prox(x, y, z, 1 - fm, true); seg1(sB, fm); } fv[i] = fm;
        }
        else { prox(x, y, z, 1, soTronco); converter(x, y, z); }
      }
      let tot = 0;
      for (let k = 0; k < 4; k++) { let m = -1; for (let t = 0; t < nc; t++) if (cp[t] > 0 && (m < 0 || cp[t] > cp[m])) m = t; if (m < 0) break; idx[4 * i + k] = cb[m]; wt[4 * i + k] = cp[m]; tot += cp[m]; cp[m] = -1; }
      for (let k = 0; k < 4; k++) wt[4 * i + k] /= tot || 1;
    }
    let fib = null;
    // suaviza as fibras pela malha (vizinhos colados, inclusive nas costuras da textura): fibras vizinhas quase paralelas, sem faixas
    const alisarFib = () => { if (!ix || !fib) return; {
          const rep = new Int32Array(n), mp = new Map();
          for (let i = 0; i < n; i++) { const k = Math.round(w[3 * i] * 2e4) + ',' + Math.round(w[3 * i + 1] * 2e4) + ',' + Math.round(w[3 * i + 2] * 2e4); const r = mp.get(k); if (r === undefined) { mp.set(k, i); rep[i] = i; } else rep[i] = r; }
          const viz = Array.from({ length: n }, () => []);
          for (let t = 0; t < ix.length; t += 3) for (let e = 0; e < 3; e++) { const a = rep[ix[t + e]], b = rep[ix[t + (e + 1) % 3]]; if (a !== b) { viz[a].push(b); viz[b].push(a); } }
          let op = fib.op, ip = fib.ip; const tmpO = new Float32Array(n * 3), tmpI = new Float32Array(n * 3);
          for (let it = 0; it < 14; it++) {
            tmpO.set(op); tmpI.set(ip);
            for (let i = 0; i < n; i++) { if (rep[i] !== i || fib.s[i] < -5) continue; let c = 1, ox = op[3 * i], oy = op[3 * i + 1], oz = op[3 * i + 2], qx = ip[3 * i], qy = ip[3 * i + 1], qz = ip[3 * i + 2];
              for (const j of viz[i]) { if (fib.s[j] < -5) continue; ox += op[3 * j]; oy += op[3 * j + 1]; oz += op[3 * j + 2]; qx += ip[3 * j]; qy += ip[3 * j + 1]; qz += ip[3 * j + 2]; c++; }
              tmpO[3 * i] = ox / c; tmpO[3 * i + 1] = oy / c; tmpO[3 * i + 2] = oz / c; tmpI[3 * i] = qx / c; tmpI[3 * i + 1] = qy / c; tmpI[3 * i + 2] = qz / c; }
            op.set(tmpO); ip.set(tmpI);
          }
          for (let i = 0; i < n; i++) { const r = rep[i]; if (r !== i && fib.s[r] > -5) { for (let a = 0; a < 3; a++) { op[3 * i + a] = op[3 * r + a]; ip[3 * i + a] = ip[3 * r + a]; } } }
          for (let i = 0; i < n; i++) { if (fib.s[i] < -5) continue; const ox = op[3 * i], oy = op[3 * i + 1], oz = op[3 * i + 2], cx = ip[3 * i] - ox, cy = ip[3 * i + 1] - oy, cz = ip[3 * i + 2] - oz, L2 = cx * cx + cy * cy + cz * cz;
            if (L2 > 1e-6) fib.s[i] = Math.max(-0.2, Math.min(1.2, ((w[3 * i] - ox) * cx + (w[3 * i + 1] - oy) * cy + (w[3 * i + 2] - oz) * cz) / L2)); }
        } };
    // músculos em leque (ombro, quadril, tronco → membro): cada vértice vira um ponto de uma "fibra" que liga a origem (fixa no osso de origem)
    // ao tendão (no osso de inserção). A GPU estica a fibra em linha reta, sem dobras nem abas.
    const pq = parMap.get(sA + '|' + sB);
    if (bi || (sB > 0 && sA !== sB && (modo === 'misto' || (modo === 'eixo' && pq && (pq.ombro || pq.quad))) && (info[sB].c !== '*' || /^Gluteus maximus/.test(id)))) {   // glúteo máximo: fibras da pelve ao fêmur, enroladas em volta do quadril
      let sI = sB, ptI = ptB, inv = false;
      const nv = s => info[s].t === 'membro' ? info[s].n : -1;   // tronco/pelve conta como o osso mais proximal
      if (modo === 'eixo' && nv(sA) > nv(sB)) { sI = sA; ptI = ptA; inv = true; }
      if (bi) { inv = bi.o !== sA; sI = inv ? sA : sB; }
      const cI = info[sI].c, nI = info[sI].n;
      livre.fill(0); info.forEach((f, s) => { if (f.t === 'tronco' || f.c === '*' || (modo === 'eixo' && f.c === cI && f.n < nI)) livre[s] = 1; });   // origem: tronco/pelve (e, no eixo, o osso de cima da cadeia)
      const dSeg = (x, y, z, sg) => { const ix = Math.floor(x / cel), iy = Math.floor(y / cel), iz = Math.floor(z / cel); let b = 1e9;
        for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) { const arr = mapa.get(chave(ix + a, iy + bb, iz + c)); if (!arr) continue; for (const q of arr) if (ps[q] === sg) { const dx = px[q] - x, dy = py[q] - y, dz = pz[q] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < b) b = d2; } }
        return Math.sqrt(b); };
      const inI = new Uint8Array(n), Ii = [], Ai = [], dI = new Float32Array(n).fill(9);   // tendão: vértices encostados no osso de inserção
      for (let i = 0; i < n; i++) { const t = (w[3 * i + ax] - lo) / (hi - lo || 1), sv = inv ? 1 - t : t; if (bi) { if (sv > 0.5) dI[i] = 0; } else if (sv > 0.4) dI[i] = dSeg(w[3 * i], w[3 * i + 1], w[3 * i + 2], sI); }   // duas articulações: a metade de baixo faz o papel do tendão (segue os ossos seguintes)
      for (const lim of [0.012, 0.02, 0.03]) { Ii.length = 0; for (let i = 0; i < n; i++) if (dI[i] < lim) Ii.push(i); if (Ii.length >= 8) break; }
      if (/^Ascending part of trapezius/.test(id) && Ii.length > 8) {   // trapézio inferior: desliza sobre a borda medial da escápula e só se prende na raiz da espinha (a ponta mais lateral)
        let x1 = 0; for (const i of Ii) x1 = Math.max(x1, Math.abs(w[3 * i])); const K = Ii.filter(i => Math.abs(w[3 * i]) >= x1 - 0.03); if (K.length >= 8) { Ii.length = 0; Ii.push(...K); } }
      for (const i of Ii) { inI[i] = 1; fixo[i] = 1; }
      if (Ii.length >= 3 && Ii.length < n * (bi ? 0.9 : 0.6)) {
        const amostra = (a, m) => { const st = Math.max(1, Math.floor(a.length / m)), r = []; for (let k = 0; k < a.length; k += st) r.push(a[k]); return r; };
        for (let i = 0; i < n; i++) Ai.push(i);
        const Si = amostra(Ii, 500), Sa = amostra(Ai, 1600), cacheO = new Map();
        const pesoO = j => { let r = cacheO.get(j); if (r) return r; const x = w[3 * j], y = w[3 * j + 1], z = w[3 * j + 2]; nc = 0;
          fj = 0; ff = 0; if (y >= FY[U]) { fj = U - 1; ff = 1; } else if (y > FY[0]) { while (y >= FY[fj + 1]) fj++; ff = (y - FY[fj]) / (FY[fj + 1] - FY[fj]); }
          if (bi) seg1(bi.o, 1); else if (modo === 'eixo') seg1(sI === sA ? sB : sA, 1); else prox(x, y, z, 1, true);   // eixo (escápula → úmero, pelve → fêmur): a origem é o próprio osso de origem
          r = { i: [0, 0, 0, 0], w: [0, 0, 0, 0] }; let tot = 0;
          for (let k = 0; k < 4; k++) { let m = -1; for (let t = 0; t < nc; t++) if (cp[t] > 0 && (m < 0 || cp[t] > cp[m])) m = t; if (m < 0) break; r.i[k] = cb[m]; r.w[k] = cp[m]; tot += cp[m]; cp[m] = -1; }
          for (let k = 0; k < 4; k++) r.w[k] /= tot || 1; nc = 0; cacheO.set(j, r); return r; };
        fib = { op: new Float32Array(n * 3), ip: new Float32Array(n * 3), ib: new Float32Array(n * 4), iw: new Float32Array(n * 4), s: new Float32Array(n).fill(-9) };
        for (let i = 0; i < n; i++) { fib.ib[4 * i] = sI - 1; fib.iw[4 * i] = 1; }   // referencial da inserção: um osso, ou a mistura de ossos do ponto de chegada
        if (ix) {
          // Cada fibra é traçada pela superfície do músculo: do tendão (inserção) para longe, até a ponta onde o músculo acaba (origem).
          // A posição na fibra (0 na origem, 1 no tendão) vem da distância pela superfície, que é contínua: vizinhos têm fibras vizinhas.
          const G = grafo(n, w, ix), rep = G.rep, ini = G.ini, viz = G.viz, gd = geod(G, w, n, Ii), d = gd.d, src = gd.src, ord = [];
          for (let i = 0; i < n; i++) { if (rep[i] !== i) continue; ord.push(i);
            if (d[i] > 1e8) { let q = Si[0], bd = 1e9; const x = w[3 * i], y = w[3 * i + 1], z = w[3 * i + 2]; for (const j of Si) { const dx = w[3 * j] - x, dy = w[3 * j + 1] - y, dz = w[3 * j + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; q = j; } } d[i] = Math.sqrt(bd); src[i] = rep[q]; } }   // pedaço solto, sem tendão: linha reta
          ord.sort((p, q) => d[q] - d[p]); const fim = new Int32Array(n);
          for (const v of ord) { let b = -1, br = 0.6; for (let q = ini[v]; q < ini[v + 1]; q++) { const u = viz[q]; if (d[u] <= d[v]) continue; const r = (d[u] - d[v]) / (Math.hypot(w[3 * u] - w[3 * v], w[3 * u + 1] - w[3 * v + 1], w[3 * u + 2] - w[3 * v + 2]) || 1e-9); if (r > br) { br = r; b = u; } } fim[v] = b < 0 ? v : fim[b]; }
          for (let it = 0; it < 3; it++) for (const v of ord) { let b = v; for (let q = ini[v]; q < ini[v + 1]; q++) { const u = viz[q]; if (d[fim[u]] > d[fim[b]]) b = u; } if (d[fim[v]] < 0.75 * d[fim[b]]) fim[v] = fim[b]; }   // fibra que parou cedo demais segue a vizinha
          const Dm = new Float32Array(n);
          for (const v of ord) { const e = fim[v], q = src[v]; Dm[v] = d[e]; if (inI[v] || Dm[v] < 1e-4) continue; fib.s[v] = 0; fib.op[3 * v] = w[3 * e]; fib.op[3 * v + 1] = w[3 * e + 1]; fib.op[3 * v + 2] = w[3 * e + 2]; fib.ip[3 * v] = w[3 * q]; fib.ip[3 * v + 1] = w[3 * q + 1]; fib.ip[3 * v + 2] = w[3 * q + 2]; }
          { const op = fib.op, ip = fib.ip, tO = new Float32Array(n * 3), tI = new Float32Array(n * 3), tD = new Float32Array(n);   // alisa origem, inserção e comprimento da fibra entre vizinhos
            for (let it = 0; it < 24; it++) { tO.set(op); tI.set(ip); tD.set(Dm);
              for (const v of ord) { if (fib.s[v] < -5) continue; let c = 1, ox = op[3 * v], oy = op[3 * v + 1], oz = op[3 * v + 2], qx = ip[3 * v], qy = ip[3 * v + 1], qz = ip[3 * v + 2], dm = Dm[v];
                for (let q = ini[v]; q < ini[v + 1]; q++) { const j = viz[q]; if (fib.s[j] < -5) continue; ox += op[3 * j]; oy += op[3 * j + 1]; oz += op[3 * j + 2]; qx += ip[3 * j]; qy += ip[3 * j + 1]; qz += ip[3 * j + 2]; dm += Dm[j]; c++; }
                tO[3 * v] = ox / c; tO[3 * v + 1] = oy / c; tO[3 * v + 2] = oz / c; tI[3 * v] = qx / c; tI[3 * v + 1] = qy / c; tI[3 * v + 2] = qz / c; tD[v] = dm / c; }
              op.set(tO); ip.set(tI); Dm.set(tD); } }
          for (let i = 0; i < n; i++) {
            const v = rep[i];
            if (inI[i] || inI[v]) { if (!bi) { idx.fill(0, 4 * i, 4 * i + 4); wt.fill(0, 4 * i, 4 * i + 4); idx[4 * i] = sI - 1; wt[4 * i] = 1; } fib.s[i] = -9; continue; }   // tendão: preso ao osso de inserção (duas articulações: continua com os ossos da cadeia)
            if (fib.s[v] < -5) { fib.s[i] = -9; continue; }
            if (bi) { const q = src[v]; for (let k = 0; k < 4; k++) { fib.ib[4 * i + k] = idx[4 * q + k]; fib.iw[4 * i + k] = wt[4 * q + k]; } }
            const r = pesoO(fim[v]); for (let k = 0; k < 4; k++) { idx[4 * i + k] = r.i[k]; wt[4 * i + k] = r.w[k]; }
            for (let a = 0; a < 3; a++) { fib.op[3 * i + a] = fib.op[3 * v + a]; fib.ip[3 * i + a] = fib.ip[3 * v + a]; }
            if (i !== v) fib.s[i] = 0;
          }
          for (let i = 0; i < n; i++) if (fib.s[i] > -5) { const v = rep[i]; fib.s[i] = Math.max(0, Math.min(1, 1 - d[v] / Math.max(Dm[v], 1e-4))); }
        } else {
          for (let i = 0; i < n; i++) {
            if (inI[i]) { idx.fill(0, 4 * i, 4 * i + 4); wt.fill(0, 4 * i, 4 * i + 4); idx[4 * i] = sI - 1; wt[4 * i] = 1; continue; }   // tendão: preso ao osso de inserção
            const x = w[3 * i], y = w[3 * i + 1], z = w[3 * i + 2];
            let q = Si[0], bd = 1e9; for (const j of Si) { const dx = w[3 * j] - x, dy = w[3 * j + 1] - y, dz = w[3 * j + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; q = j; } }
            const qx = w[3 * q], qy = w[3 * q + 1], qz = w[3 * q + 2], ux = x - qx, uy = y - qy, uz = z - qz, Lq = Math.hypot(ux, uy, uz); if (Lq < 1e-4) continue;
            let o = i, best = Lq;   // origem: o ponto mais distante do músculo na direção tendão → vértice
            for (const j of Sa) { const vx = w[3 * j] - qx, vy = w[3 * j + 1] - qy, vz = w[3 * j + 2] - qz, L = Math.hypot(vx, vy, vz); if (L <= best) continue; if ((vx * ux + vy * uy + vz * uz) / (L * Lq) > 0.992) { best = L; o = j; } }
            const ox = w[3 * o], oy = w[3 * o + 1], oz = w[3 * o + 2], cx = qx - ox, cy = qy - oy, cz = qz - oz, L2 = cx * cx + cy * cy + cz * cz;
            const r = pesoO(o); for (let k = 0; k < 4; k++) { idx[4 * i + k] = r.i[k]; wt[4 * i + k] = r.w[k]; }
            if (L2 < 1e-6) continue;
            fib.s[i] = Math.max(-0.2, Math.min(1.2, ((x - ox) * cx + (y - oy) * cy + (z - oz) * cz) / L2));
            fib.op[3 * i] = ox; fib.op[3 * i + 1] = oy; fib.op[3 * i + 2] = oz; fib.ip[3 * i] = qx; fib.ip[3 * i + 1] = qy; fib.ip[3 * i + 2] = qz;
          }
          alisarFib();
        }
        modo += '+leque';
        if (pq && /Gluteus maximus/i.test(id)) {
          // capa da cabeça do úmero: em vez de esticar em linha reta, gira em volta do centro da cabeça (ossos intermediários), fração pela fibra
          const cuff = /spinatus|Teres minor|Subscapularis/i.test(id);   // manguito: o ventre fica colado na escápula; só o trecho que cruza a articulação gira com o úmero
          for (let i = 0; i < n; i++) { if (inI[i]) continue; const f = cuff ? suave(0.5, 1.0, Math.max(0, fib.s[i])) : suave(0.0, 0.85, Math.max(0, fib.s[i])); nc = 0; cadeia(pq, pq.a === sI ? 1 - f : f, 1, w[3 * i], w[3 * i + 1], w[3 * i + 2], false);
            let tot = 0; idx.fill(0, 4 * i, 4 * i + 4); wt.fill(0, 4 * i, 4 * i + 4);
            for (let k = 0; k < 4; k++) { let m = -1; for (let t = 0; t < nc; t++) if (cp[t] > 0 && (m < 0 || cp[t] > cp[m])) m = t; if (m < 0) break; idx[4 * i + k] = cb[m]; wt[4 * i + k] = cp[m]; tot += cp[m]; cp[m] = -1; }
            for (let k = 0; k < 4; k++) wt[4 * i + k] /= tot || 1; nc = 0; }
          fib = null; modo += '+capa';
        }
      }
    }
    if (!fib && (modo === 'eixo' || modo === 'misto') && sB > 0) {
      const O = [], Ip = []; for (let i = 0; i < n; i++) { if (fv[i] < 0) continue; if (fv[i] <= 0.03) O.push(i); else if (fv[i] >= 0.97) Ip.push(i); }
      if (O.length >= 3 && Ip.length >= 3) {
        const amostra = a => { const st = Math.max(1, Math.floor(a.length / 450)), r = []; for (let k = 0; k < a.length; k += st) r.push(a[k]); return r; };
        const So = amostra(O), Si = amostra(Ip), perto = (S, x, y, z) => { let b = S[0], bd = 1e9; for (const j of S) { const dx = w[3 * j] - x, dy = w[3 * j + 1] - y, dz = w[3 * j + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; b = j; } } return b; };
        fib = { op: new Float32Array(n * 3), ip: new Float32Array(n * 3), ib: new Float32Array(n * 4), iw: new Float32Array(n * 4), s: new Float32Array(n).fill(-9) }; for (let i = 0; i < n; i++) { fib.ib[4 * i] = sB - 1; fib.iw[4 * i] = 1; }
        for (let i = 0; i < n; i++) {
          const f = fv[i]; if (f <= 0.03 || f >= 0.97 || f < 0) continue;
          const x = w[3 * i], y = w[3 * i + 1], z = w[3 * i + 2], o = perto(So, x, y, z), q = perto(Si, x, y, z);
          const ox = w[3 * o], oy = w[3 * o + 1], oz = w[3 * o + 2], cx = w[3 * q] - ox, cy = w[3 * q + 1] - oy, cz = w[3 * q + 2] - oz, L2 = cx * cx + cy * cy + cz * cz;
          if (L2 < 1e-6) continue;
          fib.s[i] = Math.max(-0.2, Math.min(1.2, ((x - ox) * cx + (y - oy) * cy + (z - oz) * cz) / L2));
          fib.op.set([ox, oy, oz], 3 * i); fib.ip.set([w[3 * q], w[3 * q + 1], w[3 * q + 2]], 3 * i);
          for (let k = 0; k < 4; k++) { idx[4 * i + k] = idx[4 * o + k]; wt[4 * i + k] = wt[4 * o + k]; }   // a ponta de origem segue os ossos da origem
        }
      }
    }
    if (serr) modo = 'serratil';
    if (!campo && !fib && ix && modo !== 'rigido') suavizar(n, w, ix, idx, wt, fixo);   // (os leques já têm as fibras suavizadas)
    yield { id, idx, wt, fib, prog: (mi + 1) / malhas.length, diag: modo + ' ' + (['campo', ...segs][sA] || sA) + '>' + (['campo', ...segs][sB] || sB) };
  }
}

const POSE = (() => {
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, RAD = Math.PI / 180;
  const rX = a => new M4().makeRotationX(a * RAD), rY = a => new M4().makeRotationY(a * RAD), rZ = a => new M4().makeRotationZ(a * RAD);
  const tra = (a, b) => new M4().makeTranslation(a.x - (b ? b.x : 0), a.y - (b ? b.y : 0), a.z - (b ? b.z : 0));
  const neg = p => new M4().makeTranslation(-p.x, -p.y, -p.z);
  const em = (p, R) => tra(p).multiply(R).multiply(neg(p));   // rotação R em torno do ponto p
  const NIV = [...[5, 4, 3, 2, 1].map(i => 'Vertebra L' + i), ...[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(i => 'Vertebra T' + i), ...[7, 6, 5, 4, 3].map(i => 'Vertebra C' + i), 'Axis (C2)', 'Atlas (C1)'];
  const REG = { lum: [0, 5], torI: [5, 6], torS: [11, 6], cerI: [17, 5], cerS: [22, 3] };   // [primeiro nível, nº de articulações]
  const LADOS = [['d', '.r', 1], ['e', '.l', -1]];   // sg = +1 no lado direito (x negativo no modelo)
  const S = { Rh: {}, Uh: {}, Wr: {}, pronto: false, ativo: false, k: 0, def: {}, gen: null, fer: new Set(), rig: [], campo: [], anim: null, mk: {}, A: {}, K: {}, H: {}, G: {}, Cs: {}, sc: {}, ac: {}, Hh: {}, Co: {}, MTP: {},
    pesos: new Map(), clones: new Map(), usar: new Set(), ang: {}, aoMudar: null, rotExtra: null };

  /* --- geometria em coordenadas do mundo (vetores tipados) --- */
  function mundo(m) {
    m.updateWorldMatrix(true, false); const p = m.geometry.attributes.position, n = p.count, o = new Float32Array(n * 3), e = m.matrixWorld.elements;
    for (let i = 0; i < n; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); o[3 * i] = e[0] * x + e[4] * y + e[8] * z + e[12]; o[3 * i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; o[3 * i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
    return o;
  }
  const cacheW = {}; const W = n => cacheW[n] || (cacheW[n] = mundo(MESH[n]));
  const faixa = (w, ax) => { let a = 1e9, b = -1e9; for (let i = ax; i < w.length; i += 3) { if (w[i] < a) a = w[i]; if (w[i] > b) b = w[i]; } return [a, b]; };
  const meio = w => { const a = faixa(w, 0), b = faixa(w, 1), c = faixa(w, 2); return new V3((a[0] + a[1]) / 2, (b[0] + b[1]) / 2, (c[0] + c[1]) / 2); };
  const mediaSe = (w, f) => { let x = 0, y = 0, z = 0, c = 0; for (let i = 0; i < w.length; i += 3) if (f(w[i], w[i + 1], w[i + 2])) { x += w[i]; y += w[i + 1]; z += w[i + 2]; c++; } return c ? new V3(x / c, y / c, z / c) : meio(w); };
  const ponta = (w, ax, sinal, tol, f = () => true) => { let e = -1e9; for (let i = 0; i < w.length; i += 3) if (f(w[i], w[i + 1], w[i + 2])) { const v = sinal * w[i + ax]; if (v > e) e = v; } return mediaSe(w, (x, y, z) => f(x, y, z) && sinal * (ax === 0 ? x : ax === 1 ? y : z) >= e - tol); };
  const um = b => Object.keys(MESH).find(n => E[n].c === 'ossos' && E[n].b === b);
  const osso = (b, suf) => MESH[b + suf] ? b + suf : um(b);
  // cabeça do úmero ou do fêmur: centro da parte mais alta e mais medial do osso
  const cabeca = w => { const [, y1] = faixa(w, 1); let sx = 0, c = 0; for (let i = 0; i < w.length; i += 3) if (w[i + 1] > y1 - 0.045) { sx += Math.abs(w[i]); c++; } const p = mediaSe(w, (x, y) => y > y1 - 0.045 && Math.abs(x) < sx / c); p.y = y1 - 0.024; return p; };

  function segDe(n) {
    const b = E[n].b, l = E[n].l === 'direito' ? 'd' : E[n].l === 'esquerdo' ? 'e' : '';
    if (/^(Hip bone|Sacrum|Coccyx)$/.test(b)) return 'pelve';
    if (/^(Femur|Patella)$/.test(b)) return 'coxa' + l;
    if (/^(Tibia|Fibula)$/.test(b)) return 'perna' + l;
    if (SEG_RE.pe.test(b)) return (/phalanx/.test(b) ? 'dedos' : 'pe') + l;
    if (b === 'Scapula') return 'esc' + l; if (b === 'Clavicle') return 'cla' + l;
    if (b === 'Humerus') return 'umero' + l;
    if (b === 'Radius') return 'radio' + l; if (b === 'Ulna') return 'ulna' + l;
    if (/phalanx of (second|third|fourth|fifth) finger of hand/.test(b)) return (/^Proximal/.test(b) ? 'fp' : /^Middle/.test(b) ? 'fm' : 'fd') + l;   // dedos: falanges proximais, médias e distais
    if (/phalanx of first finger of hand/.test(b)) return 'po' + l;   // polegar
    if (SEG_RE.braco.test(b)) return 'mao' + l;
    if (/^Vertebra |^Atlas|^Axis/.test(b)) return 'v:' + b;
    if (/rib|sternum|Xiphoid|Hyoid|Thyroid|Cricoid|Arytenoid|Corniculate/.test(b)) return null;   // tronco flexível: segue a coluna pela altura
    return 'cabeca';
  }

  function preparar() {
    if (S.pronto) return;
    const mk = (id, p, seg) => { S.mk[id] = { r: p, seg, p: p.clone() }; };
    S.chao = faixa(W('Calcaneus.r'), 1)[0];
    for (const [l, suf, sg] of LADOS) {
      const lat = -sg, tib = W('Tibia' + suf), fem = W('Femur' + suf), fib = W('Fibula' + suf), esc = W('Scapula' + suf), cla = W('Clavicle' + suf), qd = W('Hip bone' + suf), hum = W('Humerus' + suf);
      const [ty0, ty1] = faixa(tib, 1), [fy0, fy1] = faixa(fem, 1), fb0 = faixa(fib, 1)[0], ey1 = faixa(esc, 1)[1], hy0 = faixa(hum, 1)[0];
      const A = mediaSe(tib, (x, y) => y < ty0 + 0.015); A.y = ty0 + 0.012; S.A[l] = A;
      const K = mediaSe(fem, (x, y) => y < fy0 + 0.03); K.y = fy0 + 0.022; S.K[l] = K;
      const H = cabeca(fem); S.H[l] = H; S.Hh[l] = cabeca(hum);
      const Co = mediaSe(hum, (x, y) => y < hy0 + 0.022); Co.y = hy0 + 0.011; S.Co[l] = Co;
      const rad = W('Radius' + suf), uln = W('Ulna' + suf), [ry0, ry1] = faixa(rad, 1), uy0 = faixa(uln, 1)[0];
      S.Rh[l] = mediaSe(rad, (x, y) => y > ry1 - 0.012); S.Uh[l] = mediaSe(uln, (x, y) => y < uy0 + 0.014);   // cabeça do rádio e cabeça da ulna: eixo da pronação
      const Wr = mediaSe(rad, (x, y) => y < ry0 + 0.016); Wr.x = (Wr.x + S.Uh[l].x) / 2; Wr.y = ry0 - 0.004; S.Wr[l] = Wr;   // centro do punho
      mk('mal_' + l, mediaSe(fib, (x, y) => y < fb0 + 0.015), 'perna' + l); mk('joe_' + l, K.clone(), 'coxa' + l);
      mk('troc_' + l, ponta(fem, 0, lat, 0.006, (x, y) => y > fy1 - 0.12), 'coxa' + l);
      mk('acr_' + l, ponta(esc, 0, lat, 0.008, (x, y) => y > ey1 - 0.04), 'esc' + l);
      S.G[l] = ponta(esc, 0, lat, 0.012, (x, y) => y < ey1 - 0.05); S.Cs[l] = meio(esc);
      S.sc[l] = ponta(cla, 0, -lat, 0.01); S.ac[l] = ponta(cla, 0, lat, 0.01);
      { // rotação para cima no plano da escápula (o plano fica ~35° à frente do plano frontal): o ângulo inferior contorna o tórax em vez de sair dele
        const inf = ponta(esc, 1, -1, 0.006), [, eyT] = faixa(esc, 1), raiz = ponta(esc, 0, -lat, 0.006, (x, y) => y > (inf.y + eyT) / 2);
        const n = raiz.clone().sub(inf).cross(S.ac[l].clone().sub(inf)).normalize(), piv = raiz.clone().lerp(S.ac[l], 0.42);
        const t = inf.clone().sub(piv).applyAxisAngle(n, 0.1).add(piv); if ((t.x - inf.x) * lat < 0) n.negate();
        S.eUR = S.eUR || {}; S.pUR = S.pUR || {}; S.eUR[l] = n; S.pUR[l] = piv; S.raizE = S.raizE || {}; S.raizE[l] = raiz;
        let tx = 0; for (const nn of Object.keys(MESH)) if (/rib/i.test(E[nn].b) && E[nn].c === 'ossos') { const ww = W(nn); for (let i = 0; i < ww.length; i += 3) if (Math.abs(ww[i + 1] - inf.y - 0.04) < 0.05 && ww[i] * lat > 0) tx = Math.max(tx, Math.abs(ww[i])); }
        S.torX = S.torX || {}; S.torX[l] = (tx || 0.14) + 0.018; S.inf = S.inf || {}; S.inf[l] = inf;   // meia-largura do gradil onde o ângulo inferior fica com o braço elevado
      }
      mk('ore_' + l, ponta(W(osso('Temporal bone', suf)), 0, lat, 0.003), 'cabeca');
      mk('asis_' + l, ponta(qd, 2, 1, 0.005, (x, y) => y > H.y + 0.05), 'pelve'); mk('cri_' + l, ponta(qd, 1, 1, 0.006), 'pelve');
      mk('pat_' + l, meio(W('Patella' + suf)), 'coxa' + l);
      mk('tt_' + l, ponta(tib, 2, 1, 0.004, (x, y) => y < ty1 - 0.03 && y > ty1 - 0.075), 'perna' + l);
      mk('cot_' + l, Co.clone(), 'umero' + l); mk('pun_' + l, S.Wr[l].clone(), 'radio' + l); mk('mao_' + l, S.Wr[l].clone().add(new V3(0, -0.09, 0)), 'mao' + l); mk('omb_' + l, S.Hh[l].clone(), 'umero' + l); mk('qua_' + l, H.clone(), 'coxa' + l);
    }
    S.Sm = S.Hh.d.clone().add(S.Hh.e).multiplyScalar(0.5);
    const esp = n => ponta(W(n), 2, -1, 0.004);
    mk('occ', ponta(W(osso('Occipital bone', '')), 2, -1, 0.005), 'cabeca'); mk('c7', esp('Vertebra C7'), 'v:Vertebra C7'); mk('t7', esp('Vertebra T7'), 'v:Vertebra T7');
    mk('l3p', esp('Vertebra L3'), 'v:Vertebra L3'); mk('sac', ponta(W(um('Sacrum')), 2, -1, 0.006), 'pelve');
    const cen = NIV.map(n => { const w = W(n), c = meio(w); c.z = faixa(w, 2)[1] - 0.018; return c; });
    S.piv = cen.map((c, i) => i ? c.clone().add(cen[i - 1]).multiplyScalar(0.5) : c.clone().sub(cen[1].clone().sub(c).multiplyScalar(0.5)));
    S.piv.push(cen[23].clone().add(new V3(0, 0.012, 0)));
    mk('l3', cen[2].clone(), 'v:Vertebra L3');
    const ys = meio(W(um('Sacrum'))).y; S.FY = [Math.min(ys, cen[0].y - 0.04), ...cen.map(c => c.y), cen[23].y + 0.035];
    S.Ct = new V3(0, S.Cs.d.y, cen[13].z + 0.07);   // eixo vertical do tórax, na altura de T4
    const nomes = new Set();
    for (const [n, m] of Object.entries(MESH)) {
      if (m.userData.camada !== 'ossos') continue; const seg = segDe(n);
      if (seg) { m.updateWorldMatrix(true, false); S.rig.push({ m, seg, M0: m.matrixWorld.clone(), Pi: m.parent.matrixWorld.clone().invert() }); nomes.add(seg); }
      else S.campo.push(n);
    }
    S.dedM = {};   // dedos da mão: eixo de flexão de cada fileira de articulações (MCF, IFP e IFD) e o polegar
    for (const [l, suf] of LADOS) {
      const base = re => { const ps = []; for (const r of S.rig) if (re.test(E[r.m.name].b) && r.seg.endsWith(l)) { const w = W(r.m.name), [, y1] = faixa(w, 1); ps.push(mediaSe(w, (x, y) => y > y1 - 0.004)); } return ps; };
      const fila = nome => { const ps = base(new RegExp('^' + nome + ' phalanx of (second|third|fourth|fifth) finger of hand$')); if (ps.length < 2) return null;
        const c = ps.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / ps.length); let a = ps[0], b = ps[0]; for (const p of ps) { if (p.x < a.x) a = p; if (p.x > b.x) b = p; }
        return { P: c, ax: b.clone().sub(a).normalize() }; };
      const mcf = fila('Proximal'), ifp = fila('Middle'), ifd = fila('Distal'); if (!mcf || !ifp || !ifd) continue;
      const [tb] = base(/^Proximal phalanx of first finger of hand$/), tip = (() => { for (const r of S.rig) if (/^Distal phalanx of first finger of hand$/.test(E[r.m.name].b) && r.seg.endsWith(l)) { const w = W(r.m.name), [y0] = faixa(w, 1); return mediaSe(w, (x, y) => y < y0 + 0.004); } return null; })();
      // sinal: a flexão leva a ponta dos dedos para a palma (frente, z+, na posição anatômica)
      const sn = ax => { const t = new V3(0, -0.05, 0).applyAxisAngle(ax, 0.3); return t.z > 0 ? 1 : -1; };
      const D = { mcf: mcf.P, ifp: ifp.P, ifd: ifd.P, ax: mcf.ax, sn: sn(mcf.ax) };
      if (tb && tip) { const dir = tip.clone().sub(tb).normalize(), tax = dir.clone().cross(new V3(0, 0, 1)).normalize(); const t = dir.clone().multiplyScalar(0.04).applyAxisAngle(tax, 0.3); D.pol = tb; D.tax = tax; D.tsn = (t.x - dir.x * 0.04) * (l === 'd' ? 1 : -1) > 0 ? 1 : -1; }
      S.dedM[l] = D;
    }
    for (const [l, suf] of LADOS) {   // articulação metatarsofalângica: base das falanges proximais, no chão
      let z0 = 1e9; for (const r of S.rig) if (r.seg === 'dedos' + l && /Proximal/.test(E[r.m.name].b)) z0 = Math.min(z0, faixa(W(r.m.name), 2)[0]);
      S.MTP[l] = new V3(S.A[l].x, S.chao + 0.012, (z0 < 1e8 ? z0 : S.A[l].z + 0.14) + 0.006);
      S.cal = S.cal || {}; S.dedo = S.dedo || {}; S.cal[l] = ponta(W('Calcaneus' + suf), 1, -1, 0.004);
      let tz = -1e9, tp = S.MTP[l].clone().add(new V3(0, -0.006, 0.05)); for (const r of S.rig) if (r.seg === 'dedos' + l) { const w = W(r.m.name); for (let i = 0; i < w.length; i += 3) if (w[i + 1] < S.chao + 0.03 && w[i + 2] > tz) { tz = w[i + 2]; tp = new V3(w[i], w[i + 1], w[i + 2]); } }
      S.dedo[l] = tp;
    }
    S.SEGN = [...nomes]; const idx = Object.fromEntries(S.SEGN.map((s, i) => [s, i]));
    // articulações com ossos intermediários: [segmento de cima, segmento de baixo, pivô]
    S.pares = []; let h = 0;
    for (const [l] of LADOS) for (const [a, b, P] of [['esc', 'umero', S.Hh], ['cla', 'umero', S.Hh], ['tor', 'umero', S.Hh], ['umero', 'ulna', S.Co], ['umero', 'radio', S.Co], ['ulna', 'radio', S.Rh], ['radio', 'mao', S.Wr], ['ulna', 'mao', S.Wr],
      ['pelve', 'coxa', S.H], ['coxa', 'perna', S.K], ['perna', 'pe', S.A], ['pe', 'dedos', S.MTP],
      ['mao', 'fp', { d: S.dedM.d?.mcf, e: S.dedM.e?.mcf }], ['fp', 'fm', { d: S.dedM.d?.ifp, e: S.dedM.e?.ifp }], ['fm', 'fd', { d: S.dedM.d?.ifd, e: S.dedM.e?.ifd }], ['mao', 'po', { d: S.dedM.d?.pol, e: S.dedM.e?.pol }]]) {
      if (!P[l]) continue;
      const an = a === 'pelve' ? a : a + l; if (!(b + l in idx) || (a !== 'tor' && !(an in idx))) continue;
      const cb = new V3(); let nb = 0; for (const r of S.rig) if (r.seg === b + l) { const w = W(r.m.name); cb.add(meio(w)); nb++; }
      const D = nb ? cb.multiplyScalar(1 / nb).sub(P[l]).normalize() : new V3(0, -1, 0);
      S.pares.push({ a: an, b: b + l, P: P[l], D, h: [h, h + 1, h + 2] }); h += 3;
    }
    // esqueleto de "ossos virtuais" para a GPU: um por segmento rígido, um por nível da coluna (tronco flexível) e os intermediários
    S.bones = [...S.SEGN, ...S.FY.map((_, j) => 'campo' + j), ...Array(h).fill(0)].map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
    S.esq = new THREE.Skeleton(S.bones, S.bones.map(() => new M4()));
    S.grupoPele = new THREE.Group(); scene.add(S.grupoPele);
    const cel = 0.03, px = [], py = [], pz = [], ps = [];
    const semear = (n, s) => { const w = W(n); for (let i = 0; i < w.length; i += 9) { px.push(w[i]); py.push(w[i + 1]); pz.push(w[i + 2]); ps.push(s); } };
    for (const r of S.rig) semear(r.m.name, idx[r.seg] + 1); for (const n of S.campo) semear(n, 0);
    S.grade = { cel, px: Float32Array.from(px), py: Float32Array.from(py), pz: Float32Array.from(pz), ps: Int16Array.from(ps) };
    montarFerr(); S.pronto = true;
    S.k = 0; S.def = {}; calc(); marcos(); S.q0 = { d: anguloQ('d'), e: anguloQ('e') };
  }

  /* --- pesos de pele: em segundo plano, uma vez por visita --- */
  function pele(onProg) {
    if (onProg) S.onProg = onProg;
    if (S.pele) return S.pele;
    preparar();
    const nomes = [...S.campo, ...Object.keys(MESH).filter(n => MESH[n].userData.camada === 'musculos')], campo = new Set(S.campo);
    const dados = () => ({ ...S.grade, yMao: Math.max(S.Wr.d.y, S.Wr.e.y) - 0.035, segs: S.SEGN, pares: S.pares.map(p => ({ a: p.a, b: p.b, h: p.h, P: p.P.toArray(), D: p.D.toArray() })), nseg: S.SEGN.length, FY: S.FY, malhas: nomes.map(n => ({ id: n, w: mundo(MESH[n]), campo: campo.has(n), ix: MESH[n].geometry.index ? Uint32Array.from(MESH[n].geometry.index.array) : null })) });
    S.pele = new Promise(ok => {
      const receber = r => { S.pesos.set(r.id, r); (S.diag = S.diag || {})[r.id] = r.diag; S.prog = r.prog; if (S.onProg) S.onProg(r.prog); };
      const fim = () => { S.peleOk = true; S.onProg = null; ok(); };
      const naPagina = () => { S.pesos.clear(); const it = pesosGen(dados()); const passo = () => { const t0 = performance.now(); let r = it.next(); while (!r.done) { receber(r.value); if (performance.now() - t0 > 14) return setTimeout(passo, 0); r = it.next(); } fim(); }; passo(); };
      let wk = null;
      try { wk = new Worker(URL.createObjectURL(new Blob([`const pesosGen = ${pesosGen.toString()};\nonmessage = e => { for (const r of pesosGen(e.data)) postMessage(r, [r.idx.buffer, r.wt.buffer, ...(r.fib ? [r.fib.op.buffer, r.fib.ip.buffer, r.fib.ib.buffer, r.fib.iw.buffer, r.fib.s.buffer] : [])]); postMessage({ fim: true }); };`], { type: 'text/javascript' }))); } catch (e) { wk = null; }
      if (!wk) return naPagina();
      wk.onmessage = e => { if (e.data.fim) { wk.terminate(); fim(); } else receber(e.data); };
      wk.onerror = () => { wk.terminate(); naPagina(); };
      const d = dados(); wk.postMessage(d, d.malhas.map(m => m.w.buffer));
    });
    return S.pele;
  }
  // Deformador de fibras: cada ponto da faixa de transição fica numa reta entre a origem (que segue os ossos da origem) e a inserção
  // (que segue o osso da inserção). A reta gira e estica com o movimento; o músculo afina quando alonga e engrossa quando encurta.
  const TX = { v: { value: Array.from({ length: 16 }, () => new THREE.Vector3(0, 1, 1)) }, y: { value: new THREE.Vector4(0, 1, 0, 2) }, m: { value: new THREE.Matrix4() }, mi: { value: new THREE.Matrix4() }, ok: false, j: 0 };   // y: altura inicial, 1/passo, ligado, expoente da superelipse
  function torax() {
    if (TX.ok) return; TX.ok = true; const N = 16, pts = []; let y0 = 1e9, y1 = -1e9;
    for (const n in MESH) { const m = MESH[n]; if (m.userData.camada !== 'ossos' || !/\brib\b|sternum/i.test(((E[n] && E[n].b) || '') + ' ' + n)) continue; const w = mundo(m); pts.push(w); for (let i = 1; i < w.length; i += 3) { if (w[i] < y0) y0 = w[i]; if (w[i] > y1) y1 = w[i]; } }
    if (!pts.length) return; const dy = (y1 - y0) / (N - 1), z0 = new Float32Array(N).fill(1e9), z1 = new Float32Array(N).fill(-1e9), xm = new Float32Array(N);
    for (const w of pts) for (let i = 0; i < w.length; i += 3) { const j = Math.round((w[i + 1] - y0) / dy); for (let q = Math.max(0, j - 1); q <= Math.min(N - 1, j + 1); q++) { if (w[i + 2] < z0[q]) z0[q] = w[i + 2]; if (w[i + 2] > z1[q]) z1[q] = w[i + 2]; const ax = Math.abs(w[i]); if (ax > xm[q]) xm[q] = ax; } }
    for (let j = 0; j < N; j++) TX.v.value[j].set((z0[j] + z1[j]) / 2, Math.max(0.03, xm[j]), Math.max(0.03, (z1[j] - z0[j]) / 2));
    // o gradil costal é mais "quadrado" que uma elipse: escolhe o expoente da superelipse que melhor encosta no contorno de fora das costelas
    const env = []; for (let j = 2; j < N - 2; j++) { const e = TX.v.value[j], best = new Float32Array(48), bx = new Float32Array(48), bz = new Float32Array(48);
      for (const w of pts) for (let i = 0; i < w.length; i += 3) { if (Math.abs((w[i + 1] - y0) / dy - j) > 0.5) continue; const ux = Math.abs(w[i]) / e.y, uz = (w[i + 2] - e.x) / e.z, q = Math.hypot(ux, uz), b = Math.min(47, Math.floor((Math.atan2(uz, ux) / Math.PI + 0.5) * 48)); if (q > best[b]) { best[b] = q; bx[b] = ux; bz[b] = Math.abs(uz); } }
      for (let b = 0; b < 48; b++) if (best[b] > 0.8) env.push([bx[b], bz[b]]); }
    let pe = 2, err = 1e9; for (let p = 2; p <= 4.01; p += 0.25) { let e2 = 0; for (const [ux, uz] of env) e2 += ((ux ** p + uz ** p) ** (1 / p) - 1) ** 2; if (e2 < err) { err = e2; pe = p; } }
    TX.y.value.set(y0, 1 / dy, 0, pe); TX.pe = pe; const ym = (y0 + y1) / 2; TX.j = S.FY.reduce((b, y, j) => Math.abs(y - ym) < Math.abs(S.FY[b] - ym) ? j : b, 0);
  }
  function materialFibra(om, lim, torx) {
    const mat = om.clone(); mat.color = om.color; mat.emissive = om.emissive; const uLim = { value: new THREE.Vector4(...lim) }; torax(); mat.userData.fibLim = lim; mat.userData.torx = !!torx;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uFibW = uLim; sh.uniforms.uTx = TX.v; sh.uniforms.uTxY = TX.y; sh.uniforms.uTxM = TX.m; sh.uniforms.uTxMi = TX.mi; sh.uniforms.uTxK = { value: torx ? 1 : 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>
attribute vec3 aOP; attribute vec3 aIP; attribute vec4 aIB; attribute vec4 aIW; attribute float aS; uniform vec4 uFibW; uniform vec3 uTx[16]; uniform vec4 uTxY; uniform float uTxK; uniform mat4 uTxM, uTxMi;
vec3 txE(float y) { float t = clamp((y - uTxY.x) * uTxY.y, 0.0, 14.999); int j = int(floor(t)); return mix(uTx[j], uTx[j + 1], t - float(j)); }
float txQ(vec3 p) { vec3 e = txE(p.y); vec2 d = abs(vec2(p.x / e.y, (p.z - e.x) / e.z)) + 1e-5; return pow(pow(d.x, uTxY.w) + pow(d.y, uTxY.w), 1.0 / uTxY.w); }
vec3 fibRot(vec3 v, vec3 ax, float sn, float cs) { return v * cs + cross(ax, v) * sn + ax * dot(ax, v) * (1.0 - cs); }`)
        .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
  vec3 fibPos = vec3(0.0); bool fib = aS > -5.0;
  if (fib) {
    vec4 o4 = vec4(aOP, 1.0);
    mat4 MoB = boneMatX * skinWeight.x + boneMatY * skinWeight.y + boneMatZ * skinWeight.z + boneMatW * skinWeight.w, MiB = getBoneMatrix(aIB.x) * aIW.x + getBoneMatrix(aIB.y) * aIW.y + getBoneMatrix(aIB.z) * aIW.z + getBoneMatrix(aIB.w) * aIW.w;
    vec3 Op = (MoB * o4).xyz;
    vec3 Ipt = (MiB * vec4(aIP, 1.0)).xyz;
    vec3 c0 = aIP - aOP, c1 = Ipt - Op; float L0 = max(length(c0), 1e-5), L1 = max(length(c1), 1e-5);
    mat3 Ro = mat3(MoB);   // a fibra parte do referencial do osso de origem: se o membro inteiro gira, ela gira junto por inteiro
    vec3 c0r = Ro * c0; vec3 u0 = c0r / max(length(c0r), 1e-5), u1 = c1 / L1, ax = cross(u0, u1); float sn = length(ax), cs = dot(u0, u1);
    ax = sn > 1e-6 ? ax / sn : vec3(1.0, 0.0, 0.0);
    float th = atan(sn, cs) * clamp(aS, 0.0, 1.0); sn = sin(th); cs = cos(th);   // perto da origem quase não gira; perto do tendão gira tudo
    vec3 d = Ro * (position - (aOP + aS * c0));
    fibPos = Op + aS * c1 + fibRot(d, ax, sn, cs) * mix(1.0, clamp(sqrt(L0 / L1), 0.8, 1.35), clamp(aS, 0.0, 1.0));
    objectNormal = fibRot(normalize(Ro * normal), ax, sn, cs);
    // nas pontas, a fibra entrega o controle ao osso: perto do tendão o músculo gira junto com o osso de inserção, perto da origem com o de origem
    float wi = smoothstep(uFibW.z, uFibW.w, aS), wo = 1.0 - smoothstep(uFibW.x, uFibW.y, aS);
    fibPos = mix(fibPos, (MoB * vec4(position, 1.0)).xyz, wo); objectNormal = normalize(mix(objectNormal, mat3(MoB) * normal, wo));
    fibPos = mix(fibPos, (MiB * vec4(position, 1.0)).xyz, wi); objectNormal = normalize(mix(objectNormal, mat3(MiB) * normal, wi));
    // caixa torácica: o músculo esticado contorna as costelas em vez de atravessá-las (medido no referencial do tórax, que pode estar inclinado)
    if (uTxK * uTxY.z > 0.5) {
      vec3 pl = (uTxMi * vec4(fibPos, 1.0)).xyz;
      float tt = (pl.y - uTxY.x) * uTxY.y, some = smoothstep(-1.5, 0.0, tt) * (1.0 - smoothstep(13.5, 15.5, tt)) * (1.0 - wi);
      float q0 = txQ(position), qm = min(q0, 1.04 + 0.3 * clamp(q0 - 1.04, 0.0, 0.25)), q1 = max(txQ(pl), 0.2);
      if (q1 < qm && some > 0.0) { vec3 e = txE(pl.y); float kk = mix(1.0, qm / q1, some); pl.x *= kk; pl.z = e.x + (pl.z - e.x) * kk; fibPos = (uTxM * vec4(pl, 1.0)).xyz; }
    }
  }`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
  if (fib) transformed = fibPos;`);
      fibShader(sh, fibU(om));   // estrias das fibras: calculadas na forma de repouso, então acompanham o músculo deformado
    };
    mat.customProgramCacheKey = () => 'fibra19';
    return mat;
  }
  // cópia do músculo (ou costela) que a GPU deforma; o original fica escondido enquanto o motor está ativo
  function clonar(n) {
    let c = S.clones.get(n); if (c) return c;
    const r = S.pesos.get(n), m = MESH[n]; if (!r || !m) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mundo(m), 3));
    const nm = m.geometry.attributes.normal;
    if (nm) { const N = new THREE.Matrix3().getNormalMatrix(m.matrixWorld), v = new V3(), a = new Float32Array(nm.count * 3); for (let i = 0; i < nm.count; i++) { v.set(nm.getX(i), nm.getY(i), nm.getZ(i)).applyMatrix3(N).normalize(); a[3 * i] = v.x; a[3 * i + 1] = v.y; a[3 * i + 2] = v.z; } g.setAttribute('normal', new THREE.BufferAttribute(a, 3)); }
    if (m.geometry.index) g.setIndex(m.geometry.index); if (!nm) g.computeVertexNormals();
    g.setAttribute('skinIndex', new THREE.BufferAttribute(r.idx, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(r.wt, 4));
    if (m.geometry.attributes.fibS) g.setAttribute('fibS', m.geometry.attributes.fibS);   // coordenadas das fibras (mesma ordem de vértices)
    let mat = m.material;
    if (r.fib) {
      g.setAttribute('aOP', new THREE.BufferAttribute(r.fib.op, 3)); g.setAttribute('aIP', new THREE.BufferAttribute(r.fib.ip, 3));
      g.setAttribute('aIB', new THREE.BufferAttribute(r.fib.ib, 4)); g.setAttribute('aIW', new THREE.BufferAttribute(r.fib.iw, 4)); g.setAttribute('aS', new THREE.BufferAttribute(r.fib.s, 1));
      // músculos que cobrem a cabeça do úmero (deltoide e manguito): quase todo o corpo do músculo acompanha o úmero
      mat = materialFibra(m.material, /spinatus|Teres minor|Subscapularis/i.test(E[n].b || n) ? [0, 0.55, 0.8, 1] : /deltoid/i.test(E[n].b || n) ? [0, 0.15, 0.5, 0.95] : /misto.*>(esc|cla)[de]$/.test(r.diag || '') ? [0, 0.22, 0.86, 1] : [0, 0.22, 0.62, 1], /Latissimus|trapezius|Rhomboid|pectoralis major/i.test(E[n].b || n));   // só os grandes músculos que cobrem o gradil costal contornam as costelas
    }
    c = new THREE.SkinnedMesh(g, mat); c.bind(S.esq, new M4()); c.receiveShadow = true; c.castShadow = !r.fib;   // os músculos deformados pelas fibras ainda não projetam sombra (a sombra não acompanharia a deformação)
    if (r.fib) { const om = m.material; c.onBeforeRender = () => { mat.opacity = om.opacity; mat.transparent = om.transparent; mat.depthWrite = om.depthWrite; mat.emissiveIntensity = om.emissiveIntensity; mat.visible = om.visible; }; } c.frustumCulled = false; c.name = n; c.visible = false; c.userData.camada = m.userData.camada;
    S.grupoPele.add(c); S.clones.set(n, c); return c;
  }

  /* --- cinemática: dos pés (fixos no chão) para cima --- */
  function calc() {
    const d = S.gen ? S.gen(S.k) : S.def, k = S.gen ? 1 : S.k, mv = d.mov || {}, M = {}, Hn = {}, I = new M4(), A = S.ang;
    const g = (grp, key, l) => { const o = d[grp]; if (!o || (o.lado && l && o.lado !== l)) return 0; let v = o[key]; if (v && typeof v === 'object') v = v[l]; return (v || 0) * k; };
    for (const [l, , sg] of LADOS) {
      const Aa = S.A[l], K = S.K[l], H = S.H[l]; let Ms, Mc, Mp;
      if ((mv.perna && (mv.perna.lado || 'd') === l) || mv.L) { Hn[l] = H.clone(); continue; }   // perna livre: calculada depois da pelve   // perna livre: calculada depois da pelve
      if (mv.agach) {   // agachamento: canela avança até o limite do tornozelo, o resto vem da coxa
        const s = Math.min(mv.mob ?? 35, 0.4 * mv.agach), t = mv.agach - s; A.s = s; A.t = t;
        Ms = em(Aa, rX(s)); const K2 = K.clone().applyMatrix4(Ms); Mc = tra(K2).multiply(rX(-t)).multiply(neg(K)); Mp = new M4();
      } else {
        const Ls = K.y - Aa.y, lean = g('perna', 'inclina', l);
        const gS = -Math.asin(sg * g('perna', 'dentro', l) / 100 / Ls) / RAD, tS = lean + Math.asin(-g('perna', 'tras', l) / 100 / Ls) / RAD;
        Ms = em(Aa, rZ(gS).multiply(rX(tS)).multiply(rY(sg * g('perna', 'tibRot', l)))); const K2 = K.clone().applyMatrix4(Ms);
        const v = H.clone().sub(K), rxy = Math.hypot(v.x, v.y), ryz = Math.hypot(v.z, v.y);   // a coxa devolve o quadril para cima do tornozelo
        const gT = (Math.atan2(v.x, v.y) - Math.asin((H.x - K2.x) / rxy)) / RAD, tT = (Math.asin((H.z + (H.y - Aa.y) * Math.sin(lean * RAD) - K2.z) / ryz) - Math.atan2(v.z, v.y)) / RAD;
        Mc = tra(K2, K).multiply(em(K, rX(tT).multiply(rZ(gT)).multiply(rY(sg * g('perna', 'femRot', l)))));
        Mp = em(Aa, rZ(-sg * g('pe', 'ev', l)).multiply(rY(-sg * g('pe', 'abd', l))));
        const comp = g('perna', 'comp', l) / 100;   // perna mais longa: estica o membro a partir do chão
        if (comp) { const Sc = em(new V3(0, S.chao, 0), new M4().makeScale(1, 1 + comp / (H.y - S.chao), 1)); Ms.premultiply(Sc); Mc.premultiply(Sc); Mp.premultiply(Sc); }
      }
      M['perna' + l] = Ms; M['coxa' + l] = Mc; M['pe' + l] = Mp; M['dedos' + l] = Mp.clone(); Hn[l] = H.clone().applyMatrix4(Mc);
    }
    const Hm = S.H.d.clone().add(S.H.e).multiplyScalar(0.5), Hm2 = Hn.d.clone().add(Hn.e).multiplyScalar(0.5);
    const obl = (Math.atan2(Hn.e.y - Hn.d.y, Hn.e.x - Hn.d.x) - Math.atan2(S.H.e.y - S.H.d.y, S.H.e.x - S.H.d.x)) / RAD;
    let u = 0;
    if (mv.agach && !mv.perna) {   // tronco inclina até o centro de massa (corpo) ficar sobre o meio do pé
      const HAT0 = Hm.clone().lerp(S.Sm, 0.626), pes = [], alvo = (S.A.d.z + S.A.e.z) / 2 + 0.045, braco = 0.1 * 0.3 * Math.sin((mv.flex || 0) * RAD);
      for (const [l] of LADOS) pes.push([0.1, S.H[l].clone().lerp(S.K[l], 0.433).applyMatrix4(M['coxa' + l]).z], [0.0465, S.K[l].clone().lerp(S.A[l], 0.433).applyMatrix4(M['perna' + l]).z]);
      const zcm = uu => { const h = HAT0.clone().applyMatrix4(tra(Hm2).multiply(rX(uu)).multiply(neg(Hm))); let s = 0.678 * h.z + braco, m = 0.678; for (const [a, z] of pes) { s += a * z; m += a; } return s / m; };
      let lo = -10, hi = 85; for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; zcm(mid) > alvo ? (hi = mid) : (lo = mid); } u = (lo + hi) / 2;
    }
    A.u = u;
    M.pelve = tra(Hm2, Hm).multiply(em(Hm, rY(g('pelve', 'rot')).multiply(rZ(obl + g('pelve', 'obl'))).multiply(rX(g('pelve', 'ant') + u))));
    if (mv.perna) {   // cadeia aberta: quadril → joelho → tornozelo, com a pelve parada
      const P = mv.perna, l = P.lado || 'd', sg = l === 'd' ? 1 : -1;
      const Mc = M.pelve.clone().multiply(em(S.H[l], rY(sg * (P.qa || 0)).multiply(rZ(-sg * (P.qb || 0))).multiply(rY(sg * (P.qr || 0)))));
      const Ms = Mc.clone().multiply(em(S.K[l], rX(P.joe || 0).multiply(rY(sg * (P.joeRot || 0)))));
      const Mp = Ms.clone().multiply(em(S.A[l], rX(-(P.df || 0)).multiply(rZ(sg * (P.inv || 0))).multiply(rY(sg * (P.add || 0)))));
      M['coxa' + l] = Mc; M['perna' + l] = Ms; M['pe' + l] = Mp; M['dedos' + l] = Mp.clone();
    }
    if (mv.L) for (const [l, , sg] of LADOS) {   // modo livre e marcha: as duas pernas em cadeia aberta, cada articulação com seus três planos
      const P = mv.L[l] || {};
      const Mc = M.pelve.clone().multiply(em(S.H[l], rX(-(P.qF || 0)).multiply(rZ(-sg * (P.qA || 0))).multiply(rY(sg * (P.qR || 0)))));
      const Ms = Mc.clone().multiply(em(S.K[l], rX(P.joe || 0).multiply(rY(sg * (P.joeR || 0)))));
      const Mp = Ms.clone().multiply(em(S.A[l], rX(-(P.df || 0)).multiply(rZ(sg * (P.inv || 0)))));
      M['coxa' + l] = Mc; M['perna' + l] = Ms; M['pe' + l] = Mp; M['dedos' + l] = Mp.clone().multiply(em(S.MTP[l], rX(-(P.mtp || 0))));
      A['L' + l] = P;
    }
    const col = d.col || {}, lv = []; let ant = M.pelve;
    for (let i = 0; i <= 24; i++) {
      let reg = 'cerS'; for (const [r, [a, n]] of Object.entries(REG)) if (i >= a && i < a + n) reg = r;
      const c = col[reg] || [], n = REG[reg][1]; let fr = (c[1] || 0) * k, fl = (c[0] || 0) * k; if (reg === 'lum' && d.compLat) fr -= (obl + g('pelve', 'obl')) * d.compLat;
      if (reg === 'cerS' && mv.agach) fl -= u * 0.45;   // no agachamento o pescoço estende para manter o olhar à frente
      ant = ant.clone().multiply(em(S.piv[i], rY((c[2] || 0) * k / n).multiply(rZ(fr / n)).multiply(rX(fl / n))));
      lv.push(ant); M[i < 24 ? 'v:' + NIV[i] : 'cabeca'] = ant;
    }
    S.FM = [M.pelve, ...lv].map(m => m.elements);
    for (const [l, , sg] of LADOS) {
      const lado = !mv.lado || mv.lado === l, PL = mv.L ? mv.L[l] || {} : null, v = k => PL ? PL[k] || 0 : lado ? mv[k] || 0 : 0;
      // ombro: plano de elevação (0 = frontal/abdução, 90 = sagital/flexão), elevação no plano e rotação axial (medial +)
      let om = lado && mv.omb ? mv.omb : mv.flex && lado ? { a: 90, b: mv.flex } : mv.abd && lado ? { a: 0, b: mv.abd, rl: 1 } : { a: 0, b: 0 }, RelL = null;
      if (PL) {   // modo livre: flexão, abdução e rotação ao mesmo tempo; o ritmo escapuloumeral sai da elevação resultante
        RelL = rX(-(PL.ombF || 0)).multiply(rZ(-sg * (PL.ombA || 0))).multiply(rY(sg * (PL.ombR || 0)));
        const vd = new V3(0, -1, 0).applyMatrix4(RelL), b = Math.acos(Math.max(-1, Math.min(1, -vd.y))) / RAD, a = Math.atan2(Math.abs(vd.z), Math.abs(vd.x) + 1e-6) / RAD;
        om = { a, b: vd.z < 0 && b < 90 ? b * 0.25 : b };
      }
      // ritmo escapuloumeral: até ~30° quase só a glenoumeral; depois a escápula gira para cima 1° a cada 2° do úmero
      const ph0 = Math.max(0, Math.min(150, (om.b || 0) - 30)) * 0.34, phi = ph0 + v('escRot'), rl = om.rl ? Math.max(0, om.b - 70) * 0.55 : 0; A['phi' + l] = phi; A['rl' + l] = rl;
      // junto com a rotação para cima: a clavícula eleva (sobe a escápula) e a escápula contorna o gradil costal (protração), mais na flexão que na abdução
      const plano = Math.sin(Math.max(0, Math.min(90, om.a || 0)) * RAD), elevR = ph0 / 55 * 3.2, protR = ph0 * (0.03 + 0.05 * plano);
      const Me = lv[13].clone().multiply(new M4().makeTranslation(0, (g('esc', 'elev', l) + v('escElev') + elevR) / 100, 0)).multiply(em(S.Ct, rY(sg * (g('esc', 'prot', l) + v('escProt') + protR)))).multiply(em(S.G[l], rY(sg * g('esc', 'wing', l))))
        .multiply(em(S.pUR[l], new M4().makeRotationAxis(S.eUR[l], phi * RAD))).multiply(em(S.ac[l], rX(-phi * 0.2))).multiply(em(S.Cs[l], rZ(sg * g('esc', 'rotInf', l)).multiply(rX(g('esc', 'tilt', l)))));   // rotação para cima em torno da acromioclavicular
      { // o ângulo inferior não pode sair do gradil costal: se passar, a escápula gira em torno do eixo vertical da acromioclavicular (contorna o tórax)
        const ac1 = S.ac[l].clone().applyMatrix4(Me), fora = b => { const p = S.inf[l].clone().applyMatrix4(em(ac1, rY(sg * b)).multiply(Me)); return Math.abs(p.x) - S.torX[l]; };
        if (fora(0) > 0) { let a = 0, bb = 50; if (fora(bb) > 0) bb = -50; for (let it = 0; it < 18; it++) { const m = (a + bb) / 2; if (fora(m) > 0) a = m; else bb = m; } Me.premultiply(em(ac1, rY(sg * bb))); }
      }
      M['esc' + l] = Me;
      const Rel = RelL || rY(sg * (om.a || 0)).multiply(rZ(-sg * (om.b || 0))).multiply(rY(sg * ((om.r || 0) - rl)));
      const Mu = tra(S.Hh[l].clone().applyMatrix4(Me)).multiply(rY(sg * g('braco', 'rot', l))).multiply(Rel).multiply(neg(S.Hh[l]));
      const Mul = Mu.clone().multiply(em(S.Co[l], rX(-v('cot'))));
      const eixoPr = S.Uh[l].clone().sub(S.Rh[l]).normalize();   // pronação: o rádio gira em volta da ulna (da cabeça do rádio à cabeça da ulna)
      const Mr = Mul.clone().multiply(tra(S.Rh[l])).multiply(new M4().makeRotationAxis(eixoPr, -sg * v('pron') * RAD)).multiply(neg(S.Rh[l]));
      M['umero' + l] = Mu; M['ulna' + l] = Mul; M['radio' + l] = Mr; M['mao' + l] = Mr.clone().multiply(em(S.Wr[l], rX(-v('punF')).multiply(rZ(-sg * v('punD')))));
      const Dd = S.dedM[l]; if (Dd) {   // dedos: MCF, IFP e IFD dobram juntas; o polegar fecha por cima
        const pg = Math.max(0, Math.min(1, v('pega'))), Rax = (p, ax, a) => em(p, new M4().makeRotationAxis(ax, a * RAD));
        M['fp' + l] = M['mao' + l].clone().multiply(Rax(Dd.mcf, Dd.ax, Dd.sn * 72 * pg));
        M['fm' + l] = M['fp' + l].clone().multiply(Rax(Dd.ifp, Dd.ax, Dd.sn * 92 * pg));
        M['fd' + l] = M['fm' + l].clone().multiply(Rax(Dd.ifd, Dd.ax, Dd.sn * 48 * pg));
        M['po' + l] = Dd.pol ? M['mao' + l].clone().multiply(Rax(Dd.pol, Dd.tax, Dd.tsn * 55 * pg)) : M['mao' + l].clone();
      }
      const sc = S.sc[l], sc2 = campoPt(sc), ac2 = S.ac[l].clone().applyMatrix4(Me);
      const q = new THREE.Quaternion().setFromUnitVectors(S.ac[l].clone().sub(sc).normalize(), ac2.sub(sc2).normalize());
      M['cla' + l] = tra(sc2).multiply(new M4().makeRotationFromQuaternion(q)).multiply(neg(sc));
    }
    if (mv.L) {   // o pé mais baixo fica no chão (no modo livre o corpo "fica em pé" sobre ele; na marcha, como numa esteira)
      let dy = -1e9; for (const [l] of LADOS) for (const [p, key] of [[S.cal[l], 'pe' + l], [S.MTP[l], 'pe' + l], [S.dedo[l], 'dedos' + l]]) dy = Math.max(dy, p.y - p.clone().applyMatrix4(M[key]).y);
      if (mv.altura != null) dy += mv.altura;
      const dz = mv.fixarPe ? S.A.d.z - S.A.d.clone().applyMatrix4(M.pernad).z : 0;   // simulador: o tornozelo direito não sai do lugar (cadeia fechada)
      const D = new M4().makeTranslation(0, dy, (mv.avanco || 0) + dz); for (const key of Object.keys(M)) M[key].premultiply(D); A.dy = dy;
    }
    if (mv.calc) {   // elevação dos calcanhares: o pé gira sobre a cabeça dos metatarsos e o corpo sobe junto
      const R = l => em(S.MTP[l], rX(mv.calc)), D = tra(S.A.d.clone().applyMatrix4(R('d')), S.A.d);
      for (const key of Object.keys(M)) if (!/^(pe|dedos)/.test(key)) M[key].premultiply(D);
      for (const [l] of LADOS) M['pe' + l] = R(l).multiply(M['pe' + l]);
    }
    S.M = M;
    S.SEGN.forEach((s, i) => S.bones[i].matrixWorld.copy(M[s] || I));
    S.FM.forEach((e, j) => S.bones[S.SEGN.length + j].matrixWorld.fromArray(e));
    if (TX.ok && S.FM[TX.j]) { TX.m.value.fromArray(S.FM[TX.j]); TX.mi.value.copy(TX.m.value).invert(); TX.y.value.z = 1; }
    // intermediários: o segmento de cima girado 1/4, 1/2 e 3/4 do caminho até o de baixo, em torno do pivô da articulação
    const base = S.SEGN.length + S.FM.length, q = new THREE.Quaternion(), qi = new THREE.Quaternion(), pos = new V3(), esc = new V3(), Ma = new M4(), Rl = new M4();
    for (const p of S.pares) {
      Ma.copy(p.a.startsWith('tor') ? M['v:Vertebra T4'] : M[p.a] || I); const Mb = M[p.b] || I;
      Rl.copy(Ma).invert().multiply(Mb); Rl.decompose(pos, q, esc); const P2 = p.P.clone().applyMatrix4(Rl);
      for (let j = 0; j < 3; j++) { const t = (j + 1) / 4; qi.identity().slerp(q, t); S.bones[base + p.h[j]].matrixWorld.copy(Ma).multiply(tra(p.P.clone().lerp(P2, t))).multiply(new M4().makeRotationFromQuaternion(qi)).multiply(neg(p.P)); }
    }
  }
  function campoPt(p) {
    const FY = S.FY, U = FY.length - 1; let j = 0, f = 0; if (p.y >= FY[U]) { j = U - 1; f = 1; } else if (p.y > FY[0]) { while (p.y >= FY[j + 1]) j++; f = (p.y - FY[j]) / (FY[j + 1] - FY[j]); }
    return p.clone().applyMatrix4(new M4().fromArray(S.FM[j])).lerp(p.clone().applyMatrix4(new M4().fromArray(S.FM[j + 1])), f);
  }
  const marcos = () => { for (const o of Object.values(S.mk)) o.p.copy(o.r).applyMatrix4(S.M[o.seg]); };
  function anguloQ(l) {   // no plano frontal: linha EIAS→patela contra patela→tuberosidade da tíbia
    const a = S.mk['asis_' + l].p, p = S.mk['pat_' + l].p, t = S.mk['tt_' + l].p, sg = l === 'd' ? 1 : -1;
    return sg * (Math.atan2(p.x - a.x, a.y - p.y) - Math.atan2(t.x - p.x, p.y - t.y)) / RAD;
  }

  /* --- fios de prumo, marcos e ângulo Q desenhados no modelo --- */
  const LAT = [['ore_d', 'Orelha'], ['acr_d', 'Acrômio'], ['l3', 'Lombar (L3)'], ['troc_d', 'Trocânter maior'], ['joe_d', 'Joelho'], ['mal_d', 'Maléolo lateral']];
  const POSTM = [['occ', 'Occipital'], ['c7', 'C7'], ['t7', 'T7'], ['l3p', 'L3'], ['sac', 'Sacro']];
  const PARES = [['ore', 'Orelhas'], ['acr', 'Acrômios'], ['cri', 'Cristas ilíacas'], ['joe', 'Joelhos'], ['mal', 'Maléolos']];
  const corD = cm => Math.abs(cm) < 1 ? '#3ddc97' : Math.abs(cm) < 3 ? '#ffd43b' : '#ff5d73';
  const F = { g: {}, lat: [], post: [], par: [], q: {} };
  function montarFerr() {
    const raiz = new THREE.Group(); raiz.visible = false; scene.add(raiz); F.raiz = raiz;
    const esf = new THREE.SphereGeometry(1, 14, 10), cil = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0);
    const mat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: o });
    const grupo = k => { const g = new THREE.Group(); raiz.add(g); F.g[k] = g; return g; };
    const bola = (g, c, r) => { const b = new THREE.Mesh(esf, mat(c)); b.scale.setScalar(r); b.renderOrder = 21; g.add(b); return b; };
    const cano = (g, c, r, o = 1) => { const m = new THREE.Mesh(cil, mat(c, o)); m.userData.r = r; m.renderOrder = 20; m.frustumCulled = false; g.add(m); return m; };
    const gl = grupo('lat'), gp = grupo('post'), gq = grupo('q');
    F.fioL = cano(gl, '#f2f5f7', 0.0022, 0.9); F.fioP = cano(gp, '#f2f5f7', 0.0022, 0.9);
    for (const [k, n] of LAT) F.lat.push({ k, n, fant: bola(gl, '#8fa0b3', 0.006), pt: bola(gl, '#3ddc97', 0.011), con: cano(gl, '#3ddc97', 0.0028) });
    for (const [k, n] of POSTM) F.post.push({ k, n, fant: bola(gp, '#8fa0b3', 0.006), pt: bola(gp, '#3ddc97', 0.011), con: cano(gp, '#3ddc97', 0.0028) });
    for (const [k, n] of PARES) F.par.push({ k, n, a: bola(gp, '#3ddc97', 0.009), b: bola(gp, '#3ddc97', 0.009), con: cano(gp, '#3ddc97', 0.0022, 0.9) });
    for (const [l] of LADOS) F.q[l] = { c1: cano(gq, '#ffd43b', 0.003), c2: cano(gq, '#ff8a3d', 0.003), ext: cano(gq, '#ffd43b', 0.0016, 0.45), pts: [bola(gq, '#ffd43b', 0.009), bola(gq, '#ffffff', 0.009), bola(gq, '#ff8a3d', 0.009)] };
  }
  const _y = new V3(0, 1, 0), _d = new V3();
  const liga = (m, a, b) => { _d.subVectors(b, a); const L = _d.length(); m.visible = L > 1e-4; if (!m.visible) return; m.position.copy(a); m.quaternion.setFromUnitVectors(_y, _d.multiplyScalar(1 / L)); m.scale.set(m.userData.r, L, m.userData.r); };
  const pintar = (o, c) => o.material.color.set(c);
  const cm1 = v => f1(Math.abs(v), 1) + ' cm';
  function atualizarFerr() {
    marcos(); const mk = S.mk, L = { lat: [], post: [], par: [], q: {} }, rot = [];
    F.raiz.visible = S.ativo && S.fer.size > 0; for (const k of ['lat', 'post', 'q']) F.g[k].visible = S.fer.has(k);
    if (S.fer.has('lat')) {
      const x = mk.mal_d.r.x - 0.035, z = mk.mal_d.r.z + 0.02, topo = mk.ore_d.r.y + 0.14;
      liga(F.fioL, new V3(x, S.chao, z), new V3(x, topo, z)); rot.push({ p: new V3(x, topo + 0.03, z), t: 'fio de prumo', c: '#f2f5f7' });
      for (const o of F.lat) { const m = mk[o.k], dz = (m.p.z - m.r.z) * 100, c = corD(dz); o.fant.position.copy(m.r); o.pt.position.copy(m.p); pintar(o.pt, c); pintar(o.con, c); liga(o.con, m.r, m.p);
        const t = Math.abs(dz) < 0.3 ? '' : cm1(dz) + (dz > 0 ? ' à frente' : ' atrás'); L.lat.push({ n: o.n, t: t || 'alinhado', c }); rot.push({ p: m.p, t: o.n + (t ? ' · ' + t : ''), c }); }
    }
    if (S.fer.has('post')) {
      const x = (S.A.d.x + S.A.e.x) / 2, z = mk.sac.r.z - 0.05, topo = mk.occ.r.y + 0.2;
      liga(F.fioP, new V3(x, S.chao, z), new V3(x, topo, z));
      for (const o of F.post) { const m = mk[o.k], dx = (m.p.x - m.r.x) * 100, c = corD(dx); o.fant.position.copy(m.r); o.pt.position.copy(m.p); pintar(o.pt, c); pintar(o.con, c); liga(o.con, m.r, m.p);
        const t = Math.abs(dx) < 0.3 ? '' : cm1(dx) + (dx < 0 ? ' à direita' : ' à esquerda'); L.post.push({ n: o.n, t: t || 'na linha', c }); rot.push({ p: m.p, t: o.n + (t ? ' · ' + t : ''), c }); }
      for (const o of F.par) { const a = mk[o.k + '_d'], b = mk[o.k + '_e'], dy = ((a.p.y - a.r.y) - (b.p.y - b.r.y)) * 100, c = corD(dy * 1.5); o.a.position.copy(a.p); o.b.position.copy(b.p); liga(o.con, a.p, b.p); [o.a, o.b, o.con].forEach(x => pintar(x, c));
        const t = Math.abs(dy) < 0.3 ? '' : (dy > 0 ? 'direito ' : 'esquerdo ') + cm1(dy) + ' mais alto'; L.par.push({ n: o.n, t: t || 'nivelados', c }); if (t) rot.push({ p: dy > 0 ? a.p : b.p, t: o.n + ' · ' + t, c, esq: dy <= 0 }); }
    }
    if (S.fer.has('q')) for (const [l] of LADOS) {
      const o = F.q[l], a = mk['asis_' + l].p, p = mk['pat_' + l].p, t = mk['tt_' + l].p, q = anguloQ(l);
      liga(o.c1, a, p); liga(o.c2, p, t); liga(o.ext, p, p.clone().add(p.clone().sub(a).normalize().multiplyScalar(0.13))); [a, p, t].forEach((v, i) => o.pts[i].position.copy(v));
      L.q[l] = { a: q, n: S.q0 ? S.q0[l] : q }; rot.push({ p, t: 'Q ' + Math.round(q) + '°', c: '#ffd43b' });
    }
    if (S.rotExtra) rot.push(...S.rotExtra(S.ang, S.mk));
    S.leit = L; S.rot = rot;
    const el = $('rot'); el.style.display = rot.length ? '' : 'none';
    if (el.childElementCount !== rot.length || el.dataset.de !== 'pose') { el.innerHTML = rot.map(() => '<span></span>').join(''); el.dataset.de = 'pose'; }
    rot.forEach((r, i) => { const s = el.children[i]; if (s.textContent !== r.t) s.textContent = r.t; s.style.color = r.c; });
  }
  const _r = new V3();
  function rotulos() {
    const el = $('rot'); if (!S.rot || el.dataset.de !== 'pose') return;
    let xa = 1e9, xb = -1e9;   // rótulos "fora": vão para a margem do corpo, ligados à articulação por uma linha fina
    if (S.rot.some(r => r.fora) && S.mk) for (const m of Object.values(S.mk)) { if (!m || !m.p) continue; _r.copy(m.p).project(cam); const x = (_r.x + 1) / 2 * innerWidth; if (x < xa) xa = x; if (x > xb) xb = x; }
    S.rot.forEach((r, i) => {
      const s = el.children[i]; if (!s) return; _r.copy(r.p).project(cam); const x = (_r.x + 1) / 2 * innerWidth;
      let xl = x + (r.esq ? -12 : 12), ln = 0;
      if (r.fora && xa < 1e9) { const alvo = r.esq ? Math.min(xl, xa - 10) : Math.max(xl, xb + 10); ln = Math.abs(alvo - x); xl = alvo; }
      s.style.left = xl + 'px'; s.style.top = ((1 - _r.y) / 2 * innerHeight) + 'px'; s.style.transform = r.esq ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
      s.classList.toggle('ln', ln > 14); s.classList.toggle('lnE', !!r.esq); s.style.setProperty('--ln', ln + 'px');
    });
  }
  function leituraHTML() {
    const L = S.leit; if (!L) return ''; let h = '';
    const linhas = a => a.map(r => `<tr><td>${r.n}</td><td style="color:${r.c}">${r.t}</td></tr>`).join('');
    if (S.fer.has('q') && L.q.d) { const q = L.q.d, e = L.q.e, dif = Math.abs(q.a - e.a) > 0.6;
      h += `<div class="pq"><div><small>Ângulo Q${dif ? ' direito' : ''}</small><b>${f1(q.a, 0)}°</b></div>${dif ? `<div><small>Ângulo Q esquerdo</small><b>${f1(e.a, 0)}°</b></div>` : ''}<div><small>No alinhamento neutro do modelo</small><b>${f1(q.n, 0)}°</b></div></div>
      <p class="pnota">Referência em pé: cerca de 10° a 14° em homens e 15° a 17° em mulheres. ${q.a - q.n > 1.5 ? 'Este desvio <b>aumenta</b> o ângulo Q: a patela é puxada mais para fora.' : q.a - q.n < -1.5 ? 'Este desvio <b>diminui</b> o ângulo Q.' : ''}</p>`; }
    if (S.fer.has('lat')) h += `<table class="ac pleit"><tr><th>Fio de prumo lateral</th><th>Desvio em relação ao alinhamento</th></tr>${linhas(L.lat)}</table>`;
    if (S.fer.has('post')) h += `<table class="ac pleit"><tr><th>Fio de prumo posterior</th><th>Desvio em relação ao alinhamento</th></tr>${linhas(L.post)}${linhas(L.par)}</table>`;
    return h;
  }

  /* --- aplicar a pose --- */
  function aplicar(k, fim = true) {
    S.k = k; calc();
    for (const r of S.rig) { r.m.matrixAutoUpdate = false; r.m.matrix.copy(r.Pi).multiply(S.M[r.seg]).multiply(r.M0); }
    if (fim) for (const n of S.usar) { const c = S.clones.get(n); if (c) c.boundingSphere = null; }   // o toque recalcula a área do músculo na pose nova
    atualizarFerr(); if (S.aoMudar) S.aoMudar(k);
  }
  const todosMusculos = () => Object.keys(MESH).filter(n => MESH[n].userData.camada === 'musculos');
  function usar(musculos, todos) {
    S.todos = !!todos; S.usar = new Set([...S.campo, ...(todos ? todosMusculos() : musculos)]);
    for (const c of S.clones.values()) c.visible = false;
    for (const n of S.usar) clonar(n);
  }
  function iniciar(def, fer, musculos, op = {}) {
    preparar(); if (S.ativo) sair();
    S.def = def || {}; S.gen = op.gen || null; S.rotExtra = op.rot || null; S.fer = new Set(fer || []); S.ativo = true; window.POSE_ON = true;
    S.musculos = musculos; usar(musculos, op.todos);
    aplicar(op.k0 || 0);
  }
  function sinc() {   // depois de aplicarVis: a cópia deformada herda a visibilidade do original, que some
    for (const n of S.usar) { const c = S.clones.get(n), m = MESH[n]; if (!c || !m) continue; c.visible = m.visible; m.visible = false; }
  }
  function sair() {
    if (!S.ativo) return; S.ativo = false; window.POSE_ON = false; S.anim = null; S.loop = null; S.aoMudar = null; S.rotExtra = null; S.gen = null;
    for (const r of S.rig) { r.m.matrixAutoUpdate = true; r.m.updateMatrix(); }
    for (const c of S.clones.values()) c.visible = false;
    S.usar = new Set(); F.raiz.visible = false; const el = $('rot'); if (el.dataset.de === 'pose') { el.style.display = 'none'; el.innerHTML = ''; el.dataset.de = ''; }
  }
  const animar = (ate, vaivem = false, dur) => { S.anim = { de: S.k, ate, t0: performance.now(), dur: dur || 900 + 700 * Math.abs(ate - S.k), vaivem, dv: dur }; };
  function tick() {   // chamado a cada quadro; devolve true enquanto houver animação
    const L = S.loop;
    if (S.ativo && L) { const agora = performance.now(); if (!L.pausa) L.fase = (L.fase + (agora - L.t) / L.dur) % 1; L.t = agora; if (L.pausa) return false; aplicar(L.fase, false); return true; }
    const a = S.anim; if (!S.ativo || !a) return false;
    const t = (performance.now() - a.t0) / a.dur; if (t < 0) return true;
    const u = Math.min(1, t), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    aplicar(a.de + (a.ate - a.de) * e, u >= 1);
    if (u >= 1) S.anim = a.vaivem ? { de: a.ate, ate: a.ate > 0.5 ? 0 : 1, t0: performance.now() + 500, dur: a.dv || 1600, vaivem: true, dv: a.dv } : null;
    return true;
  }
  const alvos = () => S.ativo ? [...S.usar].map(n => S.clones.get(n)).filter(c => c && c.visible) : [];
  return { S, pele, iniciar, sair, sinc, aplicar, animar, tick, rotulos, leituraHTML, atualizarFerr, alvos, setTodos(on) { usar(S.musculos || [], on); aplicar(S.k); },
    get TX() { return TX; }, get ativo() { return S.ativo; }, get pronta() { return !!S.peleOk; }, parar() { S.anim = null; },
    // laço contínuo (marcha): fase de 0 a 1 que avança sozinha; pausa e velocidade sem perder a fase
    laco(dur, fase) { S.anim = null; S.loop = { t: performance.now(), dur, fase: fase ?? (S.loop ? S.loop.fase : 0), pausa: false }; },
    pausarLaco(p) { if (S.loop) { S.loop.pausa = p; S.loop.t = performance.now(); } },
    irFase(f) { if (S.loop) { S.loop.fase = ((f % 1) + 1) % 1; S.loop.t = performance.now(); aplicar(S.loop.fase, true); } },
    // simulador: calcula várias poses só para medir (ossos e marcos), sem mexer no que está na tela; f recebe as matrizes de cada pose
    medir(defs, f) { preparar(); const g = S.gen, out = defs.map(d => { S.gen = () => d; calc(); return f(S.M, S.ang); }); S.gen = g; if (S.ativo) calc(); return out; } };
})();

function limparDesvio() {
  POSE.sair(); PE.mostrar(false); if (typeof TEC !== 'undefined') sairTecidos(); if (typeof SIM !== 'undefined' && SIM.on) { SIM.on = false; SIM.cmp = null; if (SIM.g) SIM.g.visible = false; }
  for (const m of Object.values(MESH)) if (m.userData.cor0) { m.material.color.copy(m.userData.cor0); delete m.userData.cor0; }
  desvioAtivo = null;
}
const nomePt = b => { const n = Object.keys(E).find(k => E[k].b === b && E[k].c === 'musculos'); return n ? E[n].n : b; };
function colorir(grupos, cores, lado) {   // pinta os músculos de cada grupo; devolve os nomes das malhas
  const nomes = new Set();
  for (const [g, lista] of Object.entries(grupos)) {
    const bases = new Set(lista);
    for (const [n, e] of Object.entries(E)) if (e.c === 'musculos' && bases.has(e.b) && MESH[n] && (!lado || e.l === lado)) { nomes.add(n); const m = MESH[n]; if (!m.userData.cor0) m.userData.cor0 = m.material.color.clone(); m.material.color.set(cores[g]); }
  }
  return nomes;
}
// espera os pesos de pele (calculados em segundo plano logo depois que o modelo carrega)
async function peleProntaToast() {
  if (POSE.pronta) return;
  const msg = p => { const el = $('toast'); el.textContent = `Preparando os músculos para se moverem · ${Math.round(p * 100)}%`; el.classList.add('on'); };
  msg(POSE.S.prog || 0); await POSE.pele(msg); $('toast').classList.remove('on');
}
// enquadra a faixa do corpo na área livre da tela (acima do painel no celular, à esquerda dele no computador)
function enquadrarP(quadro, vista, centro) {
  let [y, alt, x0 = 0, z0 = 0, lg = 0] = QUADRO[quadro] || QUADRO.corpo; if (centro) { x0 = centro.x; y = centro.y; z0 = centro.z; }
  const W = innerWidth, H = innerHeight, area = areaLivre();
  const t = Math.tan(cam.fov * Math.PI / 360), aw = (area.x1 - area.x0) / W, ah = (area.y1 - area.y0) / H, larg = lg || Math.max(0.62, alt * 0.48);
  const dist = 1.06 * Math.max(alt / 2 / (t * ah), larg / 2 / (t * cam.aspect * aw)) + 0.15;
  const dir = new THREE.Vector3(...VISTAS[vista] || VISTAS.lat).normalize(), fwd = dir.clone().negate(), dr = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(dr, fwd);
  const wpp = 2 * dist * t / H, dx = (area.x0 + area.x1) / 2 - W / 2, dy = (area.y0 + area.y1) / 2 - H / 2;
  voar(new THREE.Vector3(x0, y, z0).addScaledVector(dr, -dx * wpp).addScaledVector(up, dy * wpp).toArray(), dist, dir, false);
}
function painelP(titulo, sub, html) { $('pT').textContent = titulo; $('pS').innerHTML = sub; $('pB').innerHTML = html; $('painel').classList.add('on'); painelAberto = true; resize(); $('pB').scrollTop = 0; }
const chipsFer = (todos = true) => `<div class="seg" id="pFer">${Object.entries(FER_N).map(([k, n]) => `<button data-f="${k}" class="${POSE.S.fer.has(k) ? 'on' : ''}">${n}</button>`).join('')}${todos ? `<button data-todos="1" class="${POSE.S.todos ? 'on' : ''}">Todos os músculos</button>` : ''}</div><div id="pLeit">${POSE.leituraHTML()}</div>`;
function ligarPainelP() {
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaP') return listaPostura();
    if (b.dataset.d) return mostrarDesvio(b.dataset.d);
    if (b.dataset.t) return mostrarFerramenta(b.dataset.t);
    if (b.dataset.todos) { const on = b.classList.toggle('on'); POSE.setTodos(on); isolado = on ? null : new Set(POSE.S.musculos); aplicarVis(); return; }
    if (b.dataset.f) { const f = POSE.S.fer; f.has(b.dataset.f) ? f.delete(b.dataset.f) : f.add(b.dataset.f); b.classList.toggle('on'); POSE.atualizarFerr(); $('pLeit').innerHTML = POSE.leituraHTML(); return; }
    if (b.dataset.k !== undefined) { $('pCmp').classList.remove('on'); return POSE.animar(+b.dataset.k); }
    if (b.id === 'pCmp') { const on = b.classList.toggle('on'); on ? POSE.animar(POSE.S.k > 0.5 ? 0 : 1, true) : POSE.parar(); }
  };
}
function listaPostura() {
  limparDesvio(); isolado = null; filtroInsercao = null; aplicarVis(); destacar(null);
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.toggle('on', b.dataset.r === 'postura'));
  enquadrarP('corpo', 'frente');
  const grupos = {}; POST.lista.forEach(d => (grupos[d.local] = grupos[d.local] || []).push(d));
  const ordem = Object.keys(grupos).sort((a, b) => LOCAIS.indexOf(a) - LOCAIS.indexOf(b));
  painelP('Postura', '<span class="tag">posturologia</span>do tornozelo à cervical', `
    <p>Escolha um desvio: o <b>corpo assume a postura</b> e você controla o grau. Os músculos aparecem <b style="color:${CORES_P.enc}">encurtados</b>, <b style="color:${CORES_P.alo}">alongados ou fracos</b> e <b style="color:${CORES_P.ten}">tensionados</b>, e o fio de prumo e o ângulo Q medem o desvio ao vivo.</p>
    <h3>Ferramentas de avaliação</h3><div class="lista">${POST.ferramentas.map(f => `<button data-t="${f.id}"><i style="background:#f2f5f7"></i>${esc(f.nome)}</button>`).join('')}</div>
    ${ordem.map(g => `<h3>${esc(g)}</h3><div class="lista">${grupos[g].map(d => `<button data-d="${d.id}"><i style="background:${CORES_P.enc}"></i>${esc(d.nome)}</button>`).join('')}</div>`).join('')}
    <div class="aviso">${esc(POST.nota)}</div>`);
  ligarPainelP();
}
async function mostrarFerramenta(id) {
  const f = POST.ferramentas.find(x => x.id === id); if (!f) return;
  await peleProntaToast(); limparDesvio(); desvioAtivo = id;
  isolado = new Set(); POSE.iniciar({}, f.fer, []); aplicarVis(); destacar(null);
  enquadrarP(id === 'f-q' ? 'pernas' : 'corpo', id === 'f-lat' ? 'lat' : id === 'f-post' ? 'post' : 'ant');
  painelP(f.nome, '<span class="tag">avaliação postural</span>', `<div class="acoes" style="margin:0 0 8px"><button id="bVoltaP">← Postura</button></div>${chipsFer(false)}${f.texto}
    <div class="aviso">O modelo neutro serve de referência: os desvios são medidos em relação a ele. Em uma pessoa real, pequenas diferenças são normais.</div>`);
  ligarPainelP();
}
async function mostrarDesvio(id) {
  const d = POST.lista.find(x => x.id === id); if (!d) return; const P = POSES[id] || {};
  await peleProntaToast(); limparDesvio(); desvioAtivo = id;
  const nomes = colorir({ enc: d.enc, alo: d.alo, ten: d.ten }, CORES_P); isolado = new Set(nomes);
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  POSE.iniciar(P, P.fer || ['lat'], [...nomes]); aplicarVis(); destacar(null); enquadrarP(P.quadro, P.vista);
  const lista = g => d[g].length ? `<div class="pleg"><b style="color:${CORES_P[g]}"><i style="background:${CORES_P[g]}"></i>${ROT_P[g]}</b><span>${d[g].map(b => esc(nomePt(b))).join(' · ')}</span></div>` : '';
  const ul = a => `<ul>${(a || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  painelP(d.nome, `<span class="tag">desvio postural</span>${esc(d.local)}`, `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaP">← Postura</button></div>
    <div class="pctl"><div class="pctl-t"><span>Grau do desvio</span><output id="pK">0%</output></div>
      <input id="pKs" type="range" min="0" max="100" step="1" value="0" aria-label="Grau do desvio">
      <div class="seg"><button data-k="0">Alinhado</button><button data-k="1">Desvio</button><button id="pCmp">▶ Comparar</button></div></div>
    ${chipsFer()}
    <p>${esc(d.desc)}</p>
    <h3>O que o fio de prumo mostra</h3><p>${esc(d.prumo)}</p>
    <h3>Músculos no modelo</h3>${lista('enc')}${lista('alo')}${lista('ten')}
    <h3>Causas e fatores</h3><p>${esc(d.causas)}</p>
    <h3>Como avaliar</h3><p>${esc(d.avaliar)}</p>
    <h3>Cadeia ascendente (de baixo para cima)</h3><p>${esc(d.asc)}</p>
    <h3>Cadeia descendente (de cima para baixo)</h3><p>${esc(d.desc_cadeia)}</p>
    <h3>Lesões e queixas associadas</h3><p>${esc(d.lesoes)}</p>
    <h3>Manejo</h3><p>${esc(d.pratica)}</p>
    <div class="man"><div><b style="color:${CORES_P.enc}">Alongar e mobilizar</b>${ul(d.alongar)}</div><div><b style="color:${CORES_P.alo}">Fortalecer</b>${ul(d.fortalecer)}</div></div>
    <p><b>No treino:</b> ${esc(d.treino)}</p>
    <div class="aviso">${esc(POST.nota)}</div>
    <div class="fontes">Fontes: ${POST.fontes.map(esc).join(' · ')}</div>`);
  ligarPainelP();
  POSE.S.aoMudar = k => { if (!$('pKs')) return; $('pK').textContent = Math.round(k * 100) + '%'; if (document.activeElement !== $('pKs')) $('pKs').value = Math.round(k * 100); $('pLeit').innerHTML = POSE.leituraHTML(); };
  $('pKs').oninput = e => { POSE.parar(); $('pCmp').classList.remove('on'); POSE.aplicar(e.target.value / 100, false); };
  $('pKs').onchange = e => POSE.aplicar(e.target.value / 100, true);
  POSE.animar(1);
}

/* ---------- catálogo: todos os movimentos de cada articulação, com plano e eixo ---------- */
// Amplitudes de referência: Marques (Manual de goniometria) e AAOS; regionais da coluna: Neumann.
const MU = {
  ombFlex: ['Clavicular part of deltoid muscle', 'Clavicular head of pectoralis major muscle', 'Coracobrachialis muscle', 'Long head of biceps brachii'],
  ombExt: ['Latissimus dorsi muscle', 'Teres major muscle', 'Scapular spinal part of deltoid muscle', 'Long head of triceps brachii', 'Sternocostal head of pectoralis major muscle'],
  ombAbd: ['Acromial part of deltoid muscle', 'Supraspinatus muscle'],
  ombAdu: ['Sternocostal head of pectoralis major muscle', 'Latissimus dorsi muscle', 'Teres major muscle', 'Coracobrachialis muscle', 'Long head of triceps brachii'],
  ombRM: ['Subscapularis muscle', 'Sternocostal head of pectoralis major muscle', 'Latissimus dorsi muscle', 'Teres major muscle', 'Clavicular part of deltoid muscle'],
  ombRL: ['Infraspinatus muscle', 'Teres minor muscle', 'Scapular spinal part of deltoid muscle'],
  ombHAd: ['Clavicular head of pectoralis major muscle', 'Sternocostal head of pectoralis major muscle', 'Clavicular part of deltoid muscle', 'Coracobrachialis muscle'],
  ombHAb: ['Scapular spinal part of deltoid muscle', 'Infraspinatus muscle', 'Teres minor muscle'],
  escElev: ['Descending part of trapezius muscle', 'Levator scapulae', 'Rhomboid major muscle', 'Rhomboid minor muscle'],
  escDep: ['Ascending part of trapezius muscle', 'Pectoralis minor muscle', 'Subclavius muscle', 'Latissimus dorsi muscle'],
  escPro: ['Serratus anterior muscle', 'Pectoralis minor muscle'],
  escRet: ['Transverse part of trapezius muscle', 'Rhomboid major muscle', 'Rhomboid minor muscle'],
  escRS: ['Descending part of trapezius muscle', 'Ascending part of trapezius muscle', 'Serratus anterior muscle'],
  escRI: ['Rhomboid major muscle', 'Rhomboid minor muscle', 'Levator scapulae', 'Pectoralis minor muscle'],
  cotF: ['Long head of biceps brachii', 'Short head of biceps brachii', 'Brachialis muscle', 'Brachioradialis muscle', 'Superficial head of pronator teres'],
  cotE: ['Long head of triceps brachii', 'Lateral head of triceps brachii', 'Medial head of triceps brachii', 'Anconeus muscle'],
  pron: ['Superficial head of pronator teres', 'Deep head of pronator teres', 'Pronator quadratus'],
  sup: ['Supinator', 'Long head of biceps brachii', 'Short head of biceps brachii'],
  punF: ['Flexor carpi radialis', 'Humeral head of flexor carpi ulnaris', 'Ulnar head of flexor carpi ulnaris', 'Palmaris longus muscle', 'Humero-ulnar head of flexor digitorum superficialis', 'Radial head of flexor digitorum superficialis', 'Flexor digitorum profundus'],
  punE: ['Extensor carpi radialis longus', 'Extensor carpi radialis brevis', 'Humeral head of extensor carpi ulnaris', 'Ulnar head of extensor carpi ulnaris', 'Extensor digitorum'],
  punR: ['Flexor carpi radialis', 'Extensor carpi radialis longus', 'Extensor carpi radialis brevis', 'Abductor pollicis longus'],
  punU: ['Humeral head of flexor carpi ulnaris', 'Ulnar head of flexor carpi ulnaris', 'Humeral head of extensor carpi ulnaris', 'Ulnar head of extensor carpi ulnaris'],
  quaF: ['Psoas major', 'Iliacus muscle', 'Rectus femoris muscle', 'Sartorius muscle', 'Pectineus muscle'],
  quaE: ['Gluteus maximus muscle', 'Semitendinosus muscle', 'Semimembranosus muscle', 'Long head of biceps femoris', 'Adductor magnus'],
  quaAbd: ['Gluteus medius muscle', 'Gluteus minimus muscle', 'Piriformis muscle', 'Sartorius muscle'],
  quaAdu: ['Adductor longus', 'Adductor brevis', 'Adductor magnus', 'Pectineus muscle', 'Gracilis muscle'],
  quaRM: ['Gluteus minimus muscle', 'Gluteus medius muscle', 'Adductor longus', 'Pectineus muscle'],
  quaRL: ['Piriformis muscle', 'Obturator internus', 'Obturator externus', 'Superior gemellus muscle', 'Inferior gemellus muscle', 'Quadratus femoris muscle', 'Gluteus maximus muscle'],
  quaHAb: ['Gluteus medius muscle', 'Gluteus minimus muscle', 'Piriformis muscle', 'Gluteus maximus muscle'],
  quaHAd: ['Adductor longus', 'Adductor brevis', 'Pectineus muscle', 'Gracilis muscle'],
  joeF: ['Semitendinosus muscle', 'Semimembranosus muscle', 'Long head of biceps femoris', 'Short head of biceps femoris', 'Medial head of gastrocnemius', 'Lateral head of gastrocnemius', 'Popliteus muscle'],
  joeE: ['Rectus femoris muscle', 'Vastus lateralis muscle', 'Vastus medialis muscle', 'Vastus intermedius muscle'],
  joeRM: ['Semitendinosus muscle', 'Semimembranosus muscle', 'Popliteus muscle', 'Gracilis muscle', 'Sartorius muscle'],
  joeRL: ['Long head of biceps femoris', 'Short head of biceps femoris'],
  torDF: ['Tibialis anterior muscle', 'Extensor digitorum longus', 'Extensor hallucis longus', 'Fibularis tertius muscle'],
  torPF: ['Medial head of gastrocnemius', 'Lateral head of gastrocnemius', 'Soleus muscle', 'Tibialis posterior muscle', 'Fibularis longus muscle', 'Flexor hallucis longus', 'Flexor digitorum longus'],
  inv: ['Tibialis posterior muscle', 'Tibialis anterior muscle', 'Flexor digitorum longus', 'Flexor hallucis longus'],
  ev: ['Fibularis longus muscle', 'Fibularis brevis muscle', 'Fibularis tertius muscle'],
  peAdu: ['Tibialis posterior muscle', 'Tibialis anterior muscle'], peAbd: ['Fibularis longus muscle', 'Fibularis brevis muscle', 'Extensor digitorum longus'],
  cerF: ['Sternocleidomastoid muscle', 'Longus colli muscle', 'Longus capitis muscle', 'Scalenus anterior muscle', 'Rectus anterior capitis muscle'],
  cerE: ['Splenius capitis muscle', 'Splenius colli muscle', 'Semispinalis colli muscle', 'Longissimus capitis muscle', 'Descending part of trapezius muscle', 'Rectus posterior major capitis muscle', 'Obliquus superior capitis muscle'],
  cerL: ['Sternocleidomastoid muscle', 'Scalenus anterior muscle', 'Scalenus medius muscle', 'Scalenus posterior muscle', 'Splenius capitis muscle', 'Levator scapulae'],
  cerR: ['Sternocleidomastoid muscle', 'Splenius capitis muscle', 'Splenius colli muscle', 'Obliquus inferior capitis muscle', 'Rectus posterior major capitis muscle'],
  trF: ['Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle'],
  trE: ['Iliocostalis lumborum muscle', 'Iliocostalis thoracis muscle', 'Longissimus thoracis muscle', 'Spinalis thoracis muscle', 'Multifidus lumborum muscle', 'Multifidus thoracis muscle', 'Semispinalis thoracis muscle'],
  trL: ['Quadratus lumborum muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle', 'Iliocostalis lumborum muscle', 'Longissimus thoracis muscle'],
  trR: ['External abdominal oblique muscle', 'Internal abdominal oblique muscle', 'Multifidus lumborum muscle', 'Multifidus thoracis muscle', 'Rotatores', 'Semispinalis thoracis muscle'],
  pelAnt: ['Psoas major', 'Iliacus muscle', 'Rectus femoris muscle', 'Iliocostalis lumborum muscle', 'Longissimus thoracis muscle'],
  pelRet: ['Rectus abdominis muscle', 'External abdominal oblique muscle', 'Gluteus maximus muscle', 'Semitendinosus muscle', 'Long head of biceps femoris'],
};
const PLANOS = { sag: ['sagital', 'látero-lateral (médio-lateral)', '#3fd8cb'], fro: ['frontal', 'anteroposterior', '#ff8a45'], tra: ['transverso', 'longitudinal (vertical)', '#b896ff'] };
// eixo desenhado: 'X' látero-lateral, 'Z' anteroposterior, 'Y' vertical, ou [marco, marco] ao longo do segmento
// cada item: [id, articulação, movimento, plano, max (°), amplitude, gen(a) com a em graus, músculos, descrição, marco do pivô, eixo, enquadramento, vista, lado colorido]
const omb = (o, x = {}) => ({ mov: { lado: 'd', omb: o, ...x } });
const per = (p, x = {}) => ({ mov: { perna: { lado: 'd', ...p }, ...x } });
const pernaErguida = { qa: 90, qb: 25, joe: 55 };
const CAT = [
  ['omb-flex', 'Ombro (glenoumeral)', 'Flexão', 'sag', 180, '0 a 180°', a => omb({ a: 90, b: a }), MU.ombFlex, 'O braço sobe à frente. Até cerca de 30° o movimento é quase só da glenoumeral; depois a escápula gira para cima, cerca de 1° para cada 2° do úmero (ritmo escapuloumeral). Exemplos: elevação frontal, desenvolvimento.', 'omb_d', 'X', 'ombro', 'lat'],
  ['omb-ext', 'Ombro (glenoumeral)', 'Extensão', 'sag', 50, '0 a 45–60°', a => omb({ a: 90, b: -a }), MU.ombExt, 'O braço vai para trás do corpo. A extensão além da posição anatômica é curta, limitada pela cápsula anterior e pelos ligamentos glenoumerais. A partir do braço elevado, a extensão até o lado do corpo é o movimento das puxadas e do pullover.', 'omb_d', 'X', 'ombro', 'lat'],
  ['omb-abd', 'Ombro (glenoumeral)', 'Abdução', 'fro', 180, '0 a 180°', a => omb({ a: 0, b: a, rl: 1 }), MU.ombAbd, 'O braço se afasta da linha média pelo lado. Acima de cerca de 90° o úmero gira para fora (rotação lateral) para o tubérculo maior passar por baixo do acrômio. Exemplo: elevação lateral.', 'omb_d', 'Z', 'ombro', 'ant'],
  ['omb-adu', 'Ombro (glenoumeral)', 'Adução', 'fro', 40, '0 a 30–40° (com leve flexão)', a => omb({ a: 30, b: -a }), MU.ombAdu, 'O braço se aproxima e cruza a linha média. Como o tronco está no caminho, a adução além da posição anatômica só acontece com uma leve flexão. Do braço abduzido de volta ao lado do corpo é a adução das puxadas abertas e do crucifixo inverso na polia baixa.', 'omb_d', 'Z', 'ombro', 'ant'],
  ['omb-rm', 'Ombro (glenoumeral)', 'Rotação medial (interna)', 'tra', 80, '0 a 70–90°', a => omb({ a: 0, b: 0, r: a }, { cot: 90 }), MU.ombRM, 'O úmero gira em torno do próprio eixo e o antebraço (com o cotovelo a 90°) vai em direção ao abdome. Com o braço ao lado do corpo, acontece no plano transverso em torno do eixo longitudinal do úmero.', 'omb_d', ['omb_d', 'cot_d'], 'ombro', 'frente'],
  ['omb-rl', 'Ombro (glenoumeral)', 'Rotação lateral (externa)', 'tra', 85, '0 a 80–90°', a => omb({ a: 0, b: 0, r: -a }, { cot: 90 }), MU.ombRL, 'O úmero gira para fora e o antebraço se afasta do corpo. Infraespinal e redondo menor fazem quase todo o trabalho: são pequenos, por isso a rotação lateral é bem mais fraca que a medial.', 'omb_d', ['omb_d', 'cot_d'], 'ombro', 'frente'],
  ['omb-rm90', 'Ombro (glenoumeral)', 'Rotação medial com o braço abduzido a 90°', 'sag', 70, '0 a 70°', a => omb({ a: 0, b: 90, r: a }, { cot: 90 }), MU.ombRM, 'É a mesma rotação medial, mas com o braço na horizontal: o eixo do úmero agora é látero-lateral, então o movimento acontece no plano sagital. O plano e o eixo dependem da posição do segmento, não do nome do movimento.', 'omb_d', ['omb_d', 'cot_d'], 'ombro', 'lat'],
  ['omb-rl90', 'Ombro (glenoumeral)', 'Rotação lateral com o braço abduzido a 90°', 'sag', 90, '0 a 90°', a => omb({ a: 0, b: 90, r: -a }, { cot: 90 }), MU.ombRL, 'Posição de arremesso e do teste de apreensão. Com o braço a 90°, a rotação lateral acontece no plano sagital e tensiona a cápsula anterior: é a posição de maior risco em quem tem instabilidade anterior.', 'omb_d', ['omb_d', 'cot_d'], 'ombro', 'lat'],
  ['omb-had', 'Ombro (glenoumeral)', 'Adução horizontal (flexão horizontal)', 'tra', 130, '0 a 120–130° (a partir de 90° de abdução)', a => omb({ a, b: 90 }), MU.ombHAd, 'Com o braço elevado a 90° pelo lado, ele vem para a frente e cruza o corpo na altura do ombro. O braço está na horizontal e gira em torno de um eixo vertical: plano transverso. Exemplos: crucifixo, voador, supino.', 'omb_d', 'Y', 'ombro', 'alto'],
  ['omb-hab', 'Ombro (glenoumeral)', 'Abdução horizontal (extensão horizontal)', 'tra', 130, '0 a 40–45° atrás do plano frontal (130° a partir do braço à frente)', a => omb({ a: 90 - a, b: 90 }), MU.ombHAb, 'Do braço à frente na horizontal, ele vai para o lado e para trás, sempre na altura do ombro. Plano transverso, eixo vertical. Exemplos: crucifixo inverso, face pull.', 'omb_d', 'Y', 'ombro', 'alto'],
  ['esc-elev', 'Escápula (cintura escapular)', 'Elevação', 'fro', 30, 'cerca de 40–45° na esternoclavicular (8 a 10 cm na escápula)', a => ({ mov: { lado: 'd', escElev: a / 12 } }), MU.escElev, 'A escápula desliza para cima sobre o tórax, levando a clavícula, que gira na esternoclavicular. É o "encolher de ombros". Plano frontal, eixo anteroposterior na esternoclavicular.', 'acr_d', 'Z', 'tronco', 'post'],
  ['esc-dep', 'Escápula (cintura escapular)', 'Depressão', 'fro', 10, 'cerca de 10° na esternoclavicular', a => ({ mov: { lado: 'd', escElev: -a / 9 } }), MU.escDep, 'A escápula desce. Na barra paralela e no início da barra fixa, a depressão é o que "ergue" o corpo sem dobrar os cotovelos.', 'acr_d', 'Z', 'tronco', 'post'],
  ['esc-pro', 'Escápula (cintura escapular)', 'Protração (abdução)', 'tra', 15, 'cerca de 15–20° na esternoclavicular', a => ({ mov: { lado: 'd', escProt: a } }), MU.escPro, 'A escápula desliza para a frente e para fora, contornando o tórax. É o fim do soco e do supino "plus". Plano transverso, eixo vertical na esternoclavicular.', 'acr_d', 'Y', 'tronco', 'alto'],
  ['esc-ret', 'Escápula (cintura escapular)', 'Retração (adução)', 'tra', 15, 'cerca de 15° na esternoclavicular', a => ({ mov: { lado: 'd', escProt: -a } }), MU.escRet, 'A escápula se aproxima da coluna. É o final das remadas.', 'acr_d', 'Y', 'tronco', 'alto'],
  ['esc-rs', 'Escápula (cintura escapular)', 'Rotação para cima (superior)', 'fro', 60, '0 a cerca de 60°', a => ({ mov: { lado: 'd', escRot: a } }), MU.escRS, 'O ângulo inferior vai para fora e a cavidade glenoidal se volta para cima. Acompanha toda elevação do braço acima de cerca de 30°. O eixo fica perto da acromioclavicular, perpendicular ao corpo da escápula.', 'acr_d', 'Z', 'tronco', 'post'],
  ['esc-ri', 'Escápula (cintura escapular)', 'Rotação para baixo (inferior)', 'fro', 15, 'volta à posição de repouso e cerca de 10–15° além', a => ({ mov: { lado: 'd', escRot: -a } }), MU.escRI, 'O ângulo inferior volta em direção à coluna e a glenoide aponta para baixo. É o movimento da escápula na volta das puxadas e da barra fixa.', 'acr_d', 'Z', 'tronco', 'post'],
  ['cot-flex', 'Cotovelo', 'Flexão', 'sag', 145, '0 a 145°', a => ({ mov: { lado: 'd', cot: a } }), MU.cotF, 'O antebraço se aproxima do braço. Articulação em dobradiça (gínglimo): um único grau de liberdade, plano sagital, eixo látero-lateral que passa pelos epicôndilos. Exemplo: rosca.', 'cot_d', 'X', 'braco', 'lat'],
  ['cot-ext', 'Cotovelo', 'Extensão', 'sag', 100, 'até 0° (até 5–10° de hiperextensão é comum)', a => ({ mov: { lado: 'd', cot: 90 - a } }), MU.cotE, 'Do cotovelo flexionado até a extensão completa, quando o olécrano encaixa na fossa do úmero. Exemplos: tríceps na polia, supino, flexão de braço.', 'cot_d', 'X', 'braco', 'lat'],
  ['ru-pron', 'Radioulnares', 'Pronação', 'tra', 85, '0 a 80–90° (a partir da posição neutra)', a => ({ mov: { lado: 'd', pron: 85 + a } }), MU.pron, 'O rádio gira em volta da ulna e a palma se volta para trás (ou para baixo, com o cotovelo flexionado). Na posição anatômica, plano transverso e eixo longitudinal do antebraço, da cabeça do rádio à cabeça da ulna. Começa na posição neutra (polegar para a frente).', 'pun_d', ['cot_d', 'pun_d'], 'antebraco', 'frente'],
  ['ru-sup', 'Radioulnares', 'Supinação', 'tra', 85, '0 a 80–90° (a partir da posição neutra)', a => ({ mov: { lado: 'd', pron: 85 - a } }), MU.sup, 'O rádio volta a ficar paralelo à ulna e a palma se volta para a frente (posição anatômica). Com o cotovelo flexionado, o bíceps é um supinador potente; com o cotovelo estendido, o supinador faz quase tudo.', 'pun_d', ['cot_d', 'pun_d'], 'antebraco', 'frente'],
  ['pun-flex', 'Punho', 'Flexão', 'sag', 80, '0 a 80–90°', a => ({ mov: { lado: 'd', punF: a } }), MU.punF, 'A palma se aproxima da face anterior do antebraço. Divide-se entre as articulações radiocárpica e mediocárpica.', 'pun_d', 'X', 'antebraco', 'lat'],
  ['pun-ext', 'Punho', 'Extensão', 'sag', 70, '0 a 70°', a => ({ mov: { lado: 'd', punF: -a } }), MU.punE, 'O dorso da mão se aproxima do antebraço. Uma leve extensão é a posição de maior força de preensão: os extensores trabalham em toda pegada.', 'pun_d', 'X', 'antebraco', 'lat'],
  ['pun-rad', 'Punho', 'Desvio radial (abdução)', 'fro', 20, '0 a 20°', a => ({ mov: { lado: 'd', punD: a } }), MU.punR, 'A mão inclina para o lado do polegar. É curto porque o processo estiloide do rádio bate no escafoide.', 'pun_d', 'Z', 'antebraco', 'ant'],
  ['pun-uln', 'Punho', 'Desvio ulnar (adução)', 'fro', 35, '0 a 30–45°', a => ({ mov: { lado: 'd', punD: -a } }), MU.punU, 'A mão inclina para o lado do dedo mínimo. Tem amplitude maior que o desvio radial. Exemplo: martelar.', 'pun_d', 'Z', 'antebraco', 'ant'],
  ['qua-flex', 'Quadril', 'Flexão (com joelho flexionado)', 'sag', 120, '0 a 120–125°', a => per({ qa: 90, qb: a, joe: a * 0.95 }), MU.quaF, 'A coxa sobe em direção ao tronco. Com o joelho flexionado, os isquiotibiais ficam frouxos e a amplitude é maior. Exemplos: elevação de joelhos, fundo do agachamento.', 'qua_d', 'X', 'corpo', 'lat'],
  ['qua-flexE', 'Quadril', 'Flexão (com joelho estendido)', 'sag', 80, '0 a cerca de 80–90°', a => per({ qa: 90, qb: a }), MU.quaF, 'Com o joelho estendido, os isquiotibiais (que cruzam quadril e joelho) limitam a flexão. É a base do teste de elevação da perna estendida.', 'qua_d', 'X', 'corpo', 'lat'],
  ['qua-ext', 'Quadril', 'Extensão', 'sag', 25, '0 a 10–30°', a => per({ qa: 90, qb: -a }), MU.quaE, 'A coxa vai para trás do corpo. É curta porque o ligamento iliofemoral, o mais forte do corpo, fica tenso. A partir da flexão de volta à posição anatômica, é o movimento do levantamento terra, da elevação pélvica e da subida do agachamento.', 'qua_d', 'X', 'corpo', 'lat'],
  ['qua-abd', 'Quadril', 'Abdução', 'fro', 45, '0 a 45°', a => per({ qa: 0, qb: a }), MU.quaAbd, 'A perna se afasta da linha média pelo lado. O glúteo médio também é o grande estabilizador da pelve no apoio unipodal (caminhada, corrida).', 'qua_d', 'Z', 'corpo', 'ant'],
  ['qua-adu', 'Quadril', 'Adução', 'fro', 20, '0 a 15–30° (cruzando à frente)', a => per({ qa: 25, qb: -a }), MU.quaAdu, 'A perna cruza a linha média, passando à frente da outra. Exemplo: cadeira adutora (na volta da abertura).', 'qua_d', 'Z', 'corpo', 'ant'],
  ['qua-rm', 'Quadril', 'Rotação medial (interna)', 'tra', 40, '0 a 35–45°', a => per({ qa: 90, joe: 90, qr: a }), MU.quaRM, 'O fêmur gira em torno do próprio eixo e a ponta do pé vai para dentro. Com o joelho a 90° (como no modelo), a perna "aponta" o giro: o pé vai para fora quando o quadril gira para dentro.', 'qua_d', ['qua_d', 'joe_d'], 'corpo', 'alto'],
  ['qua-rl', 'Quadril', 'Rotação lateral (externa)', 'tra', 45, '0 a 45°', a => per({ qa: 90, joe: 90, qr: -a }), MU.quaRL, 'O fêmur gira para fora. Os rotadores laterais profundos (piriforme, obturadores, gêmeos e quadrado femoral) ficam logo atrás da articulação e também a estabilizam.', 'qua_d', ['qua_d', 'joe_d'], 'corpo', 'alto'],
  ['qua-hab', 'Quadril', 'Abdução horizontal', 'tra', 45, '0 a 40–45° (a partir de 90° de flexão)', a => per({ qa: 90 - a, qb: 90, joe: 90 }), MU.quaHAb, 'Com o quadril flexionado a 90°, a coxa se abre para o lado na horizontal: plano transverso, eixo vertical. Exemplo: abdução de quadril sentado na cadeira abdutora.', 'qua_d', 'Y', 'corpo', 'alto'],
  ['qua-had', 'Quadril', 'Adução horizontal', 'tra', 30, '0 a 20–30° (a partir de 90° de flexão)', a => per({ qa: 90 + a, qb: 90, joe: 90 }), MU.quaHAd, 'Com o quadril flexionado a 90°, a coxa cruza para dentro na horizontal.', 'qua_d', 'Y', 'corpo', 'alto'],
  ['joe-flex', 'Joelho (tibiofemoral)', 'Flexão', 'sag', 135, '0 a 135–140°', a => per({ joe: a }), MU.joeF, 'A perna se aproxima da coxa. O eixo não é fixo: muda um pouco ao longo do movimento porque os côndilos do fêmur rolam e deslizam sobre a tíbia. Exemplo: mesa flexora.', 'joe_d', 'X', 'pernas', 'lat'],
  ['joe-ext', 'Joelho (tibiofemoral)', 'Extensão', 'sag', 90, 'até 0° (até 5–10° de hiperextensão é comum)', a => per({ qa: 90, qb: 90, joe: 90 - a }), MU.joeE, 'Da flexão até a extensão completa. Nos últimos graus a tíbia gira um pouco para fora e "trava" o joelho (rotação terminal). Exemplo: cadeira extensora (como no modelo, com o quadril flexionado).', 'joe_d', 'X', 'pernas', 'lat'],
  ['joe-rm', 'Joelho (tibiofemoral)', 'Rotação medial (com o joelho a 90°)', 'tra', 20, '0 a 15–20°', a => per({ qa: 90, qb: 90, joe: 90, joeRot: a }), MU.joeRM, 'A tíbia gira para dentro sob o fêmur. Só existe com o joelho flexionado; com ele estendido, os ligamentos travam a rotação.', 'joe_d', ['joe_d', 'mal_d'], 'pernas', 'alto'],
  ['joe-rl', 'Joelho (tibiofemoral)', 'Rotação lateral (com o joelho a 90°)', 'tra', 35, '0 a 30–40°', a => per({ qa: 90, qb: 90, joe: 90, joeRot: -a }), MU.joeRL, 'A tíbia gira para fora. O bíceps femoral é o único rotador lateral do joelho.', 'joe_d', ['joe_d', 'mal_d'], 'pernas', 'alto'],
  ['tor-df', 'Tornozelo (talocrural)', 'Dorsiflexão (flexão dorsal)', 'sag', 20, '0 a 20°', a => per({ ...pernaErguida, df: a }), MU.torDF, 'O dorso do pé se aproxima da canela. Com o pé no chão, é a canela avançando sobre o pé: o que limita a profundidade do agachamento com o tronco vertical.', 'mal_d', 'X', 'pes', 'lat'],
  ['tor-pf', 'Tornozelo (talocrural)', 'Flexão plantar', 'sag', 45, '0 a 45–50°', a => per({ ...pernaErguida, df: -a }), MU.torPF, 'A planta do pé se afasta da canela, "apontando" os dedos. Exemplo: panturrilha em pé e sentado.', 'mal_d', 'X', 'pes', 'lat'],
  ['pe-inv', 'Pé (subtalar)', 'Inversão', 'fro', 35, '0 a 35–40°', a => per({ ...pernaErguida, inv: a }), MU.inv, 'A planta do pé se volta para dentro. O eixo real da subtalar é oblíquo; para estudo, o movimento é descrito no plano frontal, eixo anteroposterior. É o movimento da entorse lateral de tornozelo.', 'mal_d', 'Z', 'pes', 'ant'],
  ['pe-ev', 'Pé (subtalar)', 'Eversão', 'fro', 20, '0 a 15–20°', a => per({ ...pernaErguida, inv: -a }), MU.ev, 'A planta do pé se volta para fora. Os fibulares também protegem o tornozelo da entorse em inversão.', 'mal_d', 'Z', 'pes', 'ant'],
  ['pe-adu', 'Pé (antepé)', 'Adução', 'tra', 20, '0 a 20°', a => per({ ...pernaErguida, add: a }), MU.peAdu, 'A ponta do pé vai para dentro, girando em torno de um eixo vertical. Somada à inversão e à flexão plantar forma a supinação do pé, um movimento triplanar.', 'mal_d', 'Y', 'pes', 'alto'],
  ['pe-abd', 'Pé (antepé)', 'Abdução', 'tra', 10, '0 a 10°', a => per({ ...pernaErguida, add: -a }), MU.peAbd, 'A ponta do pé vai para fora. Somada à eversão e à dorsiflexão forma a pronação do pé.', 'mal_d', 'Y', 'pes', 'alto'],
  ['cer-flex', 'Coluna cervical', 'Flexão', 'sag', 65, '0 a 45–65°', a => ({ col: { cerI: [a * 0.6], cerS: [a * 0.4] } }), MU.cerF, 'O queixo se aproxima do peito. A maior parte acontece entre C4 e C7; a "inclinação do queixo para dentro" (flexão craniocervical) acontece entre o crânio, C1 e C2.', 'c7', 'X', 'cabeca', 'lat'],
  ['cer-ext', 'Coluna cervical', 'Extensão', 'sag', 50, '0 a 50–75°', a => ({ col: { cerI: [-a * 0.55], cerS: [-a * 0.45] } }), MU.cerE, 'A cabeça vai para trás e o olhar para cima.', 'c7', 'X', 'cabeca', 'lat'],
  ['cer-incl', 'Coluna cervical', 'Inclinação lateral (para a direita)', 'fro', 40, '0 a 35–45° para cada lado', a => ({ col: { cerI: [0, a * 0.75], cerS: [0, a * 0.25] } }), MU.cerL, 'A orelha se aproxima do ombro. Na cervical, inclinação e rotação vêm acopladas: ao inclinar para a direita, as vértebras também giram um pouco para a direita.', 'c7', 'Z', 'cabeca', 'ant'],
  ['cer-rot', 'Coluna cervical', 'Rotação (para a direita)', 'tra', 60, '0 a 60–80° para cada lado', a => ({ col: { cerI: [0, 0, -a * 0.45], cerS: [0, 0, -a * 0.55] } }), MU.cerR, 'O rosto gira para o lado. Cerca de metade da rotação acontece entre C1 e C2 (atlantoaxial). O esternocleidomastóideo de um lado gira a cabeça para o lado oposto.', 'c7', 'Y', 'cabeca', 'alto'],
  ['tor-flex', 'Coluna torácica', 'Flexão', 'sag', 35, '0 a 30–40°', a => ({ col: { torI: [a * 0.55], torS: [a * 0.45] } }), MU.trF, 'As costas se arredondam. A caixa torácica deixa a coluna torácica mais rígida que a cervical e a lombar.', 't7', 'X', 'tronco', 'lat'],
  ['tor-ext', 'Coluna torácica', 'Extensão', 'sag', 20, '0 a 20–25°', a => ({ col: { torI: [-a * 0.55], torS: [-a * 0.45] } }), MU.trE, 'O tórax se abre e a curva torácica diminui. Os processos espinhosos, longos e inclinados para baixo, limitam a extensão. É a mobilidade que falta a muita gente nos exercícios acima da cabeça.', 't7', 'X', 'tronco', 'lat'],
  ['tor-incl', 'Coluna torácica', 'Inclinação lateral (para a direita)', 'fro', 25, '0 a 25–30° para cada lado', a => ({ col: { torI: [0, a * 0.55], torS: [0, a * 0.45] } }), MU.trL, 'O tronco inclina para o lado no meio das costas. As costelas limitam o movimento.', 't7', 'Z', 'tronco', 'post'],
  ['tor-rot', 'Coluna torácica', 'Rotação (para a direita)', 'tra', 35, '0 a 30–35° para cada lado', a => ({ col: { torI: [0, 0, -a * 0.55], torS: [0, 0, -a * 0.45] } }), MU.trR, 'A maior parte da rotação do tronco acontece aqui, porque as facetas articulares torácicas estão no plano frontal e deixam as vértebras girarem. O oblíquo externo de um lado trabalha com o oblíquo interno do outro.', 't7', 'Y', 'tronco', 'alto'],
  ['lom-flex', 'Coluna lombar', 'Flexão', 'sag', 45, '0 a 40–50°', a => ({ col: { lum: [a] } }), MU.trF, 'A curva lombar se desfaz e se inverte. Junto com a flexão do quadril forma o ritmo lombopélvico (veja em Exercícios, "Flexão do tronco").', 'l3', 'X', 'corpo', 'lat'],
  ['lom-ext', 'Coluna lombar', 'Extensão', 'sag', 20, '0 a 15–20°', a => ({ col: { lum: [-a] } }), MU.trE, 'A curva lombar aumenta. As facetas articulares se aproximam e limitam o fim do movimento.', 'l3', 'X', 'corpo', 'lat'],
  ['lom-incl', 'Coluna lombar', 'Inclinação lateral (para a direita)', 'fro', 20, '0 a cerca de 20° para cada lado', a => ({ col: { lum: [0, a] } }), MU.trL, 'O tronco inclina para o lado na cintura. O quadrado do lombo do lado oposto controla a inclinação.', 'l3', 'Z', 'corpo', 'post'],
  ['lom-rot', 'Coluna lombar', 'Rotação (para a direita)', 'tra', 8, '0 a 5–10° para cada lado', a => ({ col: { lum: [0, 0, -a] } }), MU.trR, 'Quase não existe: as facetas lombares ficam no plano sagital e bloqueiam a rotação. Por isso a rotação do tronco vem da torácica e do quadril.', 'l3', 'Y', 'corpo', 'alto'],
  ['pel-ant', 'Pelve (lombopélvica)', 'Anteversão (inclinação anterior)', 'sag', 12, 'cerca de 10–15° a partir do neutro', a => ({ pelve: { ant: a }, col: { lum: [-a] } }), MU.pelAnt, 'A pelve gira para a frente sobre a cabeça dos fêmures e a lombar aumenta a curva para o tronco continuar em pé. É ao mesmo tempo flexão do quadril e extensão da lombar.', 'qua_d', 'X', 'corpo', 'lat'],
  ['pel-ret', 'Pelve (lombopélvica)', 'Retroversão (inclinação posterior)', 'sag', 12, 'cerca de 10–15° a partir do neutro', a => ({ pelve: { ant: -a }, col: { lum: [a] } }), MU.pelRet, 'A pelve gira para trás e a lombar se retifica. É extensão do quadril com flexão da lombar. Exemplo: o "encaixe" do quadril no fim da elevação pélvica.', 'qua_d', 'X', 'corpo', 'lat'],
].map(([id, art, nome, plano, max, amp, gen, mus, desc, piv, eixo, quadro, vista]) => ({ id, art, nome, plano, max, amp, gen, mus, desc, piv, eixo, quadro, vista }));
const FONTES_CAT = ['Marques. Manual de goniometria.', 'American Academy of Orthopaedic Surgeons (AAOS). Joint motion: method of measuring and recording.', 'Neumann. Cinesiologia do aparelho musculoesquelético.', 'Kapandji. Anatomia funcional, vols. 1 a 3.', 'Hamill e Knutzen. Bases biomecânicas do movimento humano.'];

/* plano e eixo desenhados no modelo, no pivô da articulação */
const PE = (() => {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const mDisco = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  const disco = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mDisco); disco.renderOrder = 18;
  const mAnel = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false });
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 64), mAnel); anel.renderOrder = 19;
  const mEixo = new THREE.MeshBasicMaterial({ depthTest: false });
  const eixo = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), mEixo); eixo.renderOrder = 20;
  g.add(disco, anel, eixo);
  const zz = new THREE.Vector3(0, 0, 1), yy = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  return {
    mostrar(on) { g.visible = on; },
    atualizar(p, dir, cor, raio) {
      mDisco.color.set(cor); mAnel.color.set(cor); mEixo.color.set(cor);
      d.copy(dir).normalize(); disco.position.copy(p); anel.position.copy(p); disco.quaternion.setFromUnitVectors(zz, d); anel.quaternion.copy(disco.quaternion);
      disco.scale.setScalar(raio); anel.scale.setScalar(raio);
      eixo.position.copy(p); eixo.quaternion.setFromUnitVectors(yy, d); eixo.scale.set(0.0035, raio * 1.5, 0.0035);
    },
  };
})();
const RAIO_PE = { ombro: 0.3, braco: 0.22, antebraco: 0.15, corpo: 0.32, pernas: 0.26, pes: 0.14, cabeca: 0.15, tronco: 0.26 };

/* ---------- corpo inteiro em movimento ---------- */
const CORES_M = { ag: '#f7b84b', sin: '#ff6b8b', est: '#3fd8cb' };
const ROT_M = { ag: 'Agonistas: fazem o movimento', sin: 'Sinergistas: ajudam o agonista', est: 'Estabilizadores: seguram as articulações' };
const PL = { s: ['sagital', 'látero-lateral'], f: ['frontal', 'anteroposterior'], t: ['transverso', 'longitudinal'] };
const ombroAg = { flex: ['Clavicular part of deltoid muscle', 'Clavicular head of pectoralis major muscle', 'Coracobrachialis muscle', 'Long head of biceps brachii'], abd: ['Acromial part of deltoid muscle', 'Supraspinatus muscle'] };
const escap = ['Serratus anterior muscle', 'Descending part of trapezius muscle', 'Ascending part of trapezius muscle'];
const lombo = t => { const th = 110 * t, lf = 45 * (1 - (1 - th / 110) ** 2); return { th, lf, hip: th - lf }; };
const MOVS = [
  { id: 'flexao-ombro', grupo: 'Membro superior', nome: 'Elevação do braço à frente (flexão do ombro)', quadro: 'ombro', vista: 'lat', dur: 2600,
    gen: t => ({ mov: { flex: 180 * t } }),
    tiles: (t, A) => [['Elevação do braço', 180 * t], ['Glenoumeral', 180 * t - A.phid], ['Escápula (rotação para cima)', A.phid]],
    rot: (A, mk) => [{ p: mk.cot_d.p, t: 'ombro ' + Math.round(POSE.S.k * 180) + '°', c: '#f7b84b' }, { p: mk.acr_d.p, t: 'escápula ' + Math.round(A.phid) + '°', c: '#3fd8cb' }],
    fase: sobe => sobe ? 'Subindo: o deltoide (parte clavicular) e o peitoral maior (parte clavicular) trabalham em ação concêntrica, e o serrátil anterior e o trapézio giram a escápula para cima.' : 'Descendo: os mesmos músculos freiam o braço em ação excêntrica. Sem carga, a gravidade faz o movimento e eles só controlam a velocidade.',
    ag: ombroAg.flex, sin: escap, est: ['Supraspinatus muscle', 'Infraspinatus muscle', 'Teres minor muscle', 'Subscapularis muscle'],
    juntas: [['Glenoumeral', 'Flexão', 's', '0 a cerca de 120°'], ['Escapulotorácica', 'Rotação para cima', 'f', '0 a cerca de 60°'], ['Acromioclavicular e esternoclavicular', 'Elevação e rotação da clavícula', 't', 'acompanham a escápula']],
    texto: `<p><b>Ritmo escapuloumeral.</b> O braço só chega a 180° porque duas articulações dividem o trabalho. Nos primeiros 30° quase tudo vem da glenoumeral. Depois, para cada 2° do úmero a escápula gira cerca de 1° para cima (proporção média de 2:1, descrita por Inman em 1944). No fim: cerca de 120° na glenoumeral e 60° na escapulotorácica.</p>
      <p><b>Por que a escápula precisa girar.</b> Ao girar para cima, ela leva a cavidade glenoidal junto: a cabeça do úmero continua centrada, o deltoide mantém um comprimento bom para gerar força e o acrômio sai da frente do tubérculo maior, deixando espaço para os tendões do manguito.</p>
      <p><b>Quem gira a escápula:</b> um binário de forças. O trapézio descendente puxa a clavícula e o acrômio para cima, o ascendente puxa a espinha da escápula para baixo e o serrátil anterior puxa o ângulo inferior para a frente e para fora. Os três juntos fazem a escápula rodar em torno de um eixo perto da articulação acromioclavicular.</p>
      <p><b>Manguito rotador:</b> enquanto o deltoide eleva, o supraespinal, o infraespinal, o redondo menor e o subescapular comprimem a cabeça do úmero contra a glenoide e impedem que ela suba e bata no acrômio.</p>`,
    atencao: ['Se a escápula não gira (serrátil ou trapézio fracos, cifose, peitoral menor encurtado), sobra menos espaço abaixo do acrômio: é a base do arco doloroso entre 60° e 120°.', 'Encolher o ombro logo no início (antes de 60°) costuma indicar trapézio superior dominando o movimento.', 'Arredondar ou arquear a lombar para "ganhar" altura no fim do movimento compensa falta de mobilidade torácica ou de ombro.'],
    fontes: ['Inman, Saunders e Abbott (1944), J Bone Joint Surg: função da articulação do ombro (ritmo escapuloumeral).', 'Neumann. Cinesiologia do aparelho musculoesquelético, cap. 5.', 'Ludewig e Reynolds (2009), J Orthop Sports Phys Ther: cinemática da escápula e disfunção do ombro.'] },
  { id: 'abducao-ombro', grupo: 'Membro superior', nome: 'Abertura lateral do braço (abdução do ombro)', quadro: 'ombro', vista: 'ant', dur: 2600,
    gen: t => ({ mov: { abd: 180 * t } }),
    tiles: (t, A) => [['Abdução', 180 * t], ['Glenoumeral', 180 * t - A.phid], ['Escápula (rotação para cima)', A.phid], ['Rotação lateral do úmero', A.rld]],
    rot: (A, mk) => [{ p: mk.cot_d.p, t: 'abdução ' + Math.round(POSE.S.k * 180) + '°', c: '#f7b84b' }, { p: mk.acr_d.p, t: 'escápula ' + Math.round(A.phid) + '°', c: '#3fd8cb', esq: true }],
    fase: sobe => sobe ? 'Subindo: deltoide (parte acromial) e supraespinal em ação concêntrica; acima de 90° o úmero gira para fora para o tubérculo maior passar por baixo do acrômio.' : 'Descendo: deltoide e supraespinal em ação excêntrica, controlando a volta do braço.',
    ag: ombroAg.abd, sin: escap, est: ['Infraspinatus muscle', 'Teres minor muscle', 'Subscapularis muscle'],
    juntas: [['Glenoumeral', 'Abdução', 'f', '0 a cerca de 120°'], ['Glenoumeral', 'Rotação lateral (acima de 90°)', 't', 'cerca de 30° a 50°'], ['Escapulotorácica', 'Rotação para cima', 'f', '0 a cerca de 60°']],
    texto: `<p><b>Supraespinal e deltoide dividem a tarefa.</b> O supraespinal participa de toda a abdução, não só do começo: ele estabiliza a cabeça do úmero enquanto o deltoide gera a maior parte do torque. Com o braço ao lado do corpo, a linha de tração do deltoide é quase vertical e tende a puxar o úmero para cima; o manguito compensa essa tendência.</p>
      <p><b>Rotação lateral obrigatória.</b> Para abduzir acima de cerca de 90° com o braço em rotação neutra, o tubérculo maior do úmero precisa passar por baixo do acrômio. Por isso o úmero gira para fora durante a subida (no modelo, a palma vira para a frente). Tente elevar o braço com o polegar para baixo e veja como a amplitude fica limitada e desconfortável.</p>
      <p><b>Ritmo escapuloumeral:</b> a mesma proporção média de 2:1 da flexão. No fim, cerca de 120° vêm da glenoumeral e 60° da escápula.</p>`,
    atencao: ['Elevação lateral com rotação medial ("derramando a jarra") aproxima o tubérculo maior do acrômio: prefira o polegar neutro ou para cima.', 'No plano da escápula (cerca de 30° à frente do plano frontal) a cápsula fica mais relaxada e o movimento costuma ser mais confortável.', 'Dor entre 60° e 120° que alivia acima disso é o arco doloroso típico de tendinopatia do manguito ou bursite subacromial.'],
    fontes: ['Neumann. Cinesiologia do aparelho musculoesquelético, cap. 5.', 'Inman, Saunders e Abbott (1944), J Bone Joint Surg.', 'Reinold, Escamilla e Wilk (2009), J Orthop Sports Phys Ther: ativação do manguito rotador e do deltoide em exercícios.'] },
  { id: 'rosca', grupo: 'Membro superior', nome: 'Flexão do cotovelo (rosca)', quadro: 'braco', vista: 'lat', dur: 2000,
    gen: t => ({ mov: { cot: 145 * t } }),
    tiles: t => [['Flexão do cotovelo', 145 * t]],
    rot: (A, mk) => [{ p: mk.cot_d.p, t: 'cotovelo ' + Math.round(POSE.S.k * 145) + '°', c: '#f7b84b' }],
    fase: sobe => sobe ? 'Subindo: bíceps, braquial e braquiorradial em ação concêntrica. Com halter, o torque externo é máximo com o antebraço na horizontal (perto de 90°).' : 'Descendo: os flexores trabalham em ação excêntrica, freando o antebraço.',
    ag: ['Long head of biceps brachii', 'Short head of biceps brachii', 'Brachialis muscle', 'Brachioradialis muscle'], sin: ['Superficial head of pronator teres', 'Deep head of pronator teres'], est: ['Clavicular part of deltoid muscle', 'Descending part of trapezius muscle', 'Transverse part of trapezius muscle', 'Rhomboid major muscle'],
    juntas: [['Umeroulnar e umerorradial', 'Flexão', 's', '0 a cerca de 145°']],
    texto: `<p><b>Três flexores com papéis diferentes.</b> O braquial insere na ulna e flexiona com a mesma eficiência em qualquer posição do antebraço. O bíceps insere no rádio: é também supinador e perde eficiência com o antebraço pronado. O braquiorradial tem o maior braço de momento e trabalha mais com o antebraço em posição neutra (rosca martelo).</p>
      <p><b>Estabilizadores:</b> durante a rosca, o ombro e a escápula precisam ficar parados para o esforço ir para o cotovelo. Se o deltoide anterior entra para "jogar" o braço à frente, parte da carga sai dos flexores do cotovelo.</p>
      <p>Para estudar torque e braço de momento ângulo a ângulo, abra <b>Cotovelo</b> e toque em "Mover o cotovelo".</p>`,
    atencao: ['Balançar o tronco ou levar o cotovelo à frente transfere a carga para a lombar e o ombro.', 'Estender por completo é seguro e útil para a hipertrofia; o cuidado é não deixar o peso "cair" no fim da descida.'],
    fontes: ['Neumann. Cinesiologia do aparelho musculoesquelético, cap. 6.', 'Kapandji. Anatomia funcional, vol. 1.'] },
  { id: 'agachamento', grupo: 'Membro inferior e tronco', nome: 'Agachamento livre (braços à frente)', quadro: 'corpo', vista: 'frente', dur: 2600,
    gen: t => ({ mov: { agach: 120 * t, flex: Math.min(90, 160 * t) } }),
    tiles: (t, A) => [['Joelho · flexão', 120 * t], ['Quadril · flexão', (A.t || 0) + (A.u || 0)], ['Tornozelo · dorsiflexão', A.s || 0], ['Tronco · inclinação', A.u || 0]],
    rot: (A, mk) => [{ p: mk.joe_d.p, t: 'joelho ' + Math.round(POSE.S.k * 120) + '°', c: '#f7b84b' }, { p: mk.qua_d.p, t: 'quadril ' + Math.round((A.t || 0) + (A.u || 0)) + '°', c: '#ff6b8b' }, { p: mk.mal_d.p, t: 'tornozelo ' + Math.round(A.s || 0) + '°', c: '#3fd8cb' }],
    fase: sobe => sobe ? 'Descendo: quadríceps, glúteo máximo e adutor magno trabalham em ação excêntrica, freando a descida. O tronco inclina para o centro de massa continuar sobre o meio do pé.' : 'Subindo: os mesmos extensores trabalham em ação concêntrica. Quadril e joelho estendem juntos, sem o quadril subir antes.',
    ag: ['Rectus femoris muscle', 'Vastus lateralis muscle', 'Vastus medialis muscle', 'Vastus intermedius muscle', 'Gluteus maximus muscle', 'Adductor magnus'], sin: ['Soleus muscle', 'Semitendinosus muscle', 'Semimembranosus muscle', 'Long head of biceps femoris'],
    est: ['Iliocostalis lumborum muscle', 'Longissimus thoracis muscle', 'Multifidus lumborum muscle', 'Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle', 'Transversus abdominis muscle'],
    juntas: [['Joelho', 'Flexão (descida) e extensão (subida)', 's', '0 a cerca de 120°'], ['Quadril', 'Flexão e extensão', 's', '0 a cerca de 100°'], ['Tornozelo', 'Dorsiflexão', 's', 'até cerca de 35°'], ['Coluna lombar', 'Mantida neutra pelos estabilizadores', '—', '—']],
    texto: `<p><b>Cadeia fechada:</b> o pé fica fixo no chão e três articulações se movem juntas. O tornozelo deixa a canela avançar, o joelho e o quadril flexionam, e o tronco inclina o quanto for preciso para o centro de massa ficar sobre o meio do pé. Os braços à frente ajudam: deslocam parte do peso para a frente e deixam o tronco mais vertical.</p>
      <p><b>Quem trabalha.</b> O quadríceps estende o joelho; o glúteo máximo e o adutor magno estendem o quadril. Os isquiotibiais cruzam quadril e joelho e mudam pouco de comprimento: ajudam a estender o quadril e protegem o joelho, mas não são os principais motores. O sóleo controla a canela avançando.</p>
      <p><b>Estabilizadores do tronco:</b> eretores da espinha, multífidos e o abdômen (com o transverso e os oblíquos aumentando a pressão dentro do abdômen) mantêm a coluna estável enquanto o tronco inclina.</p>
      <p>Para ver os momentos em cada articulação e mudar barra, carga e mobilidade, abra <b>Joelho</b> e toque em "Agachamento".</p>`,
    atencao: ['O joelho passar da ponta do pé é normal; impedir isso aumenta muito a exigência no quadril e na lombar.', 'Pouca dorsiflexão faz o tronco inclinar mais. Calço no calcanhar ou sapato de levantamento ajudam.', 'Joelho entrando (valgo) na subida pede mais controle de glúteo médio e máximo.', 'A profundidade ideal é a que a pessoa controla com a lombar estável e sem dor.'],
    fontes: ['Schoenfeld (2010), J Strength Cond Res: cinemática do agachamento e aplicações no treino.', 'Escamilla (2001), Med Sci Sports Exerc: biomecânica do joelho no agachamento.', 'Hartmann, Wirth e Klusemann (2013), Sports Med: profundidade do agachamento.', 'Neumann, caps. 12 e 13.'] },
  { id: 'flexao-tronco', grupo: 'Membro inferior e tronco', nome: 'Flexão do tronco (ritmo lombopélvico)', quadro: 'corpo', vista: 'lat', dur: 2800,
    gen: t => { const { th, lf, hip } = lombo(t); return { pelve: { ant: hip }, col: { lum: [lf], torI: [th * 0.1] }, perna: { inclina: -hip * 0.14 } }; },
    tiles: t => { const { th, lf, hip } = lombo(t); return [['Tronco · flexão total', th], ['Coluna lombar', lf], ['Quadril (pelve)', hip]]; },
    rot: (A, mk) => { const { lf, hip } = lombo(POSE.S.k); return [{ p: mk.l3.p, t: 'lombar ' + Math.round(lf) + '°', c: '#3fd8cb' }, { p: mk.qua_d.p, t: 'quadril ' + Math.round(hip) + '°', c: '#f7b84b' }]; },
    fase: sobe => sobe ? 'Descendo: eretores da espinha, glúteo máximo e isquiotibiais trabalham em ação excêntrica, freando a flexão. A coluna lombar flexiona mais no começo e a pelve gira mais no fim.' : 'Subindo: os extensores do quadril começam a volta girando a pelve; os eretores completam a extensão da coluna.',
    ag: ['Gluteus maximus muscle', 'Semitendinosus muscle', 'Semimembranosus muscle', 'Long head of biceps femoris', 'Adductor magnus'], sin: ['Iliocostalis lumborum muscle', 'Longissimus thoracis muscle', 'Multifidus lumborum muscle', 'Spinalis thoracis muscle'], est: ['Transversus abdominis muscle', 'Internal abdominal oblique muscle', 'Soleus muscle'],
    juntas: [['Coluna lombar', 'Flexão', 's', 'até cerca de 40° a 50°'], ['Quadril (rotação da pelve sobre os fêmures)', 'Flexão', 's', 'até cerca de 70°'], ['Tornozelo', 'Pequena flexão plantar (quadril vai para trás)', 's', 'alguns graus']],
    texto: `<p><b>Ritmo lombopélvico.</b> Inclinar o tronco à frente com os joelhos estendidos é a soma de duas partes: a flexão da coluna lombar e a rotação da pelve sobre os fêmures (flexão do quadril). No começo a lombar contribui mais; no fim, a maior parte vem do quadril. No modelo, cerca de 45° vêm da lombar e 65° do quadril.</p>
      <p><b>Quem controla.</b> A gravidade faz a descida; glúteo máximo, isquiotibiais e eretores da espinha freiam em ação excêntrica. Perto da flexão máxima, os eretores quase param de disparar e os tecidos passivos (ligamentos e fáscia toracolombar) assumem parte da carga: é o fenômeno de flexão-relaxamento.</p>
      <p><b>O quadril vai para trás</b> para o centro de massa continuar sobre os pés.</p>
      <p><b>Isquiotibiais encurtados</b> limitam a rotação da pelve: para chegar ao chão, a lombar precisa flexionar mais. Por isso o ritmo lombopélvico muda de pessoa para pessoa e ajuda a avaliar.</p>`,
    atencao: ['Para levantar cargas (terra, stiff), mantenha a lombar perto do neutro e use mais o quadril: a flexão lombar sob carga alta concentra o esforço nos tecidos passivos.', 'Sem carga, flexionar a coluna é um movimento normal e saudável.', 'Quem sente dor ao levantar costuma usar pouco o quadril; treinar o movimento de "dobradiça" do quadril ajuda.'],
    fontes: ['Neumann, caps. 9 e 12.', 'Esola et al. (1996), Spine: ritmo lombopélvico na flexão do tronco.', 'McGill. Low Back Disorders: evidence-based prevention and rehabilitation.'] },
  { id: 'panturrilha', grupo: 'Membro inferior e tronco', nome: 'Elevação dos calcanhares (flexão plantar)', quadro: 'pernas', vista: 'lat', dur: 1800,
    gen: t => ({ mov: { calc: 32 * t } }),
    tiles: t => [['Tornozelo · flexão plantar', 32 * t], ['Calcanhar sobe', 32 * t]],
    rot: (A, mk) => [{ p: mk.mal_d.p, t: 'tornozelo ' + Math.round(POSE.S.k * 32) + '°', c: '#f7b84b' }],
    fase: sobe => sobe ? 'Subindo: gastrocnêmio e sóleo em ação concêntrica puxam o calcâneo pelo tendão do calcâneo; o pé vira uma alavanca apoiada na cabeça dos metatarsos.' : 'Descendo: os mesmos músculos trabalham em ação excêntrica até o calcanhar voltar ao chão.',
    ag: ['Medial head of gastrocnemius', 'Lateral head of gastrocnemius', 'Soleus muscle'], sin: ['Tibialis posterior muscle', 'Fibularis longus muscle', 'Fibularis brevis muscle', 'Flexor hallucis longus'], est: [],
    juntas: [['Talocrural (tornozelo)', 'Flexão plantar', 's', '0 a cerca de 45° a 50°'], ['Metatarsofalângicas', 'Extensão (dedos ficam no chão)', 's', 'até cerca de 60°']],
    texto: `<p><b>Alavanca de segunda classe.</b> O apoio fica na cabeça dos metatarsos, a resistência (o peso do corpo) passa pela tíbia e a força muscular entra pelo tendão do calcâneo, mais longe do apoio. Por isso uma força relativamente pequena levanta o corpo todo.</p>
      <p><b>Gastrocnêmio x sóleo.</b> O gastrocnêmio cruza o joelho: com o joelho estendido (em pé), ele está alongado e contribui bastante. Com o joelho flexionado (panturrilha sentada), fica frouxo e o sóleo assume a maior parte do trabalho.</p>
      <p><b>Sinergistas:</b> o tibial posterior e os fibulares estabilizam o pé, e o flexor longo do hálux ajuda a empurrar pelo dedão.</p>`,
    atencao: ['Use amplitude completa: descer o calcanhar abaixo do degrau alonga o tríceps sural sob carga, útil para hipertrofia e para a saúde do tendão.', 'O peso deve passar entre o primeiro e o segundo dedo; jogar o peso para o dedinho sobrecarrega a borda lateral do tornozelo.'],
    fontes: ['Neumann, cap. 14.', 'Kapandji. Anatomia funcional, vol. 2.'] },
];
let movAtivo = null;
let abaMov = 'art', filtroPl = '';
function listaMov(aba) {
  if (aba) abaMov = aba;
  limparDesvio(); isolado = null; filtroInsercao = null; aplicarVis(); destacar(null);
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.toggle('on', b.dataset.r === 'movimento'));
  enquadrarP('corpo', 'frente');
  let corpo = '';
  if (abaMov === 'art') {
    const grupos = {}; CAT.filter(m => !filtroPl || m.plano === filtroPl).forEach(m => (grupos[m.art] = grupos[m.art] || []).push(m));
    corpo = `<p>Todos os movimentos de cada articulação. Ao abrir um, o corpo se move e o <b>plano</b> (disco) e o <b>eixo</b> (linha) aparecem desenhados na articulação. O eixo é sempre perpendicular ao plano.</p>
      <div class="seg" id="fPl"><button data-pl="" class="${!filtroPl ? 'on' : ''}">Todos os planos</button>${Object.entries(PLANOS).map(([k, [n]]) => `<button data-pl="${k}" class="${filtroPl === k ? 'on' : ''}"><i class="dotp" style="background:${PLANOS[k][2]}"></i>${n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>
      ${Object.entries(grupos).map(([g, ms]) => `<h3>${esc(g)}</h3><div class="lista">${ms.map(m => `<button data-a="${m.id}"><i style="background:${PLANOS[m.plano][2]}"></i><span class="lnome">${esc(m.nome)}</span><span class="pl ${PLANOS[m.plano][0]}">${PLANOS[m.plano][0]}</span></button>`).join('')}</div>`).join('')}
      <div class="aviso">O plano e o eixo descrevem o movimento a partir da posição em que ele começa. Quando o segmento muda de posição (por exemplo, a rotação do ombro com o braço ao lado do corpo ou abduzido a 90°), o plano muda junto.</div>`;
  } else {
    const grupos = {}; MOVS.forEach(m => (grupos[m.grupo] = grupos[m.grupo] || []).push(m));
    corpo = `<p>Movimentos de exercícios com várias articulações ao mesmo tempo. Os músculos que trabalham aparecem em <b style="color:${CORES_M.ag}">âmbar (agonistas)</b>, <b style="color:${CORES_M.sin}">rosa (sinergistas)</b> e <b style="color:${CORES_M.est}">verde-água (estabilizadores)</b>.</p>
      ${Object.entries(grupos).map(([g, ms]) => `<h3>${esc(g)}</h3><div class="lista">${ms.map(m => `<button data-m="${m.id}"><i style="background:${CORES_M.ag}"></i>${esc(m.nome)}</button>`).join('')}</div>`).join('')}
      <h3>Mais</h3><div class="lista"><button data-aba="livre"><i style="background:${CORES_M.est}"></i><span class="lnome">Movimento livre: todas as articulações ao mesmo tempo</span></button><button data-aba="marcha"><i style="background:${CORES_M.sin}"></i><span class="lnome">Marcha: o ciclo fase a fase</span></button></div>`;
  }
  painelP('Corpo em movimento', '<span class="tag">cinesiologia</span>planos, eixos e músculos', `
    <button class="simcard" data-aba="sim"><b>Simulador de exercícios <span>novo</span></b><small>Torque, braço de momento e esforço de cada músculo em 7 exercícios, com comparação A × B</small></button>
    <div class="abas"><button data-aba="art" class="${abaMov === 'art' ? 'on' : ''}">Articulações (${CAT.length})</button><button data-aba="ex" class="${abaMov === 'ex' ? 'on' : ''}">Exercícios (${MOVS.length})</button><button data-aba="livre">Livre</button><button data-aba="marcha">Marcha</button></div>
    ${corpo}
    <div class="aviso">Modelo de estudo: os ossos seguem ângulos médios da literatura e os músculos se deformam acompanhando os ossos, sem simular contração.</div>`);
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.aba === 'sim') return mostrarSim();
    if (b.dataset.aba === 'livre') return mostrarLivre();
    if (b.dataset.aba === 'marcha') return mostrarMarcha();
    if (b.dataset.aba) return listaMov(b.dataset.aba);
    if (b.dataset.pl !== undefined) { filtroPl = b.dataset.pl; return listaMov(); }
    if (b.dataset.m) return mostrarMov(b.dataset.m);
    if (b.dataset.a) return mostrarArt(b.dataset.a);
  };
}
const EIXOS = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
async function mostrarArt(id) {
  const m = CAT.find(x => x.id === id); if (!m) return;
  await peleProntaToast(); limparDesvio(); movAtivo = m;
  const lado = /^(omb|esc|cot|ru|pun|qua|joe|tor-df|tor-pf|pe-)/.test(m.id) ? 'direito' : null, pl = PLANOS[m.plano];
  colorir({ ag: m.mus }, CORES_M, lado); isolado = null; filtroInsercao = null;
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  const dir = new THREE.Vector3();
  const rot = (A, mk) => {
    const p = mk[m.piv].p; if (Array.isArray(m.eixo)) dir.subVectors(mk[m.eixo[1]].p, mk[m.eixo[0]].p); else dir.copy(EIXOS[m.eixo]);
    PE.atualizar(p, dir, pl[2], RAIO_PE[m.quadro] || 0.25);
    return [{ p, t: `${m.nome.split(' (')[0].toLowerCase()} ${Math.round(POSE.S.k * m.max)}°`, c: pl[2] }];
  };
  POSE.iniciar({}, [], [], { gen: k => m.gen(k * m.max), rot, todos: true }); PE.mostrar(true);
  aplicarVis(); destacar(null);
  const pv = POSE.S.mk[m.piv].p.clone(); if (m.quadro === 'antebraco') pv.y -= 0.06;
  enquadrarP(m.quadro, m.vista, /^(pes|antebraco|braco|cabeca)$/.test(m.quadro) ? pv : null);
  const irmaos = CAT.filter(x => x.art === m.art), i = irmaos.indexOf(m);
  painelP(m.nome, `<span class="tag">${esc(m.art)}</span>`, `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaM">← Articulações</button>${i > 0 ? `<button data-a="${irmaos[i - 1].id}">‹ ${esc(irmaos[i - 1].nome.split(' (')[0])}</button>` : ''}${i < irmaos.length - 1 ? `<button data-a="${irmaos[i + 1].id}">${esc(irmaos[i + 1].nome.split(' (')[0])} ›</button>` : ''}</div>
    <div class="pe-cab" style="--pc:${pl[2]}"><div><small>Plano</small><b>${pl[0]}</b></div><div><small>Eixo</small><b>${pl[1]}</b></div></div>
    <div class="pctl"><div class="pctl-t"><span>Ângulo</span><output id="mK">0°</output></div>
      <input id="mKs" type="range" min="0" max="100" step="1" value="0" aria-label="Ângulo do movimento">
      <div class="seg"><button data-k="0">Início</button><button data-k="1">Fim</button><button id="mPlay" class="on">❚❚ Pausar</button></div></div>
    <div class="kp mt4"><div><small>Amplitude de referência</small><b style="font-size:16px">${esc(m.amp)}</b></div></div>
    <p>${esc(m.desc)}</p>
    <h3>Agonistas</h3><div class="pleg"><b style="color:${CORES_M.ag}"><i style="background:${CORES_M.ag}"></i>Músculos que fazem o movimento</b><span>${m.mus.map(b => esc(nomePt(b))).join(' · ')}</span></div>
    <h3>Como ler o desenho</h3>
    <p>O <b style="color:${pl[2]}">disco</b> é o plano em que o segmento se move; a <b style="color:${pl[2]}">linha</b> que o atravessa é o eixo, em torno do qual o segmento gira. Plano e eixo são sempre perpendiculares: movimentos no plano <span class="pl sagital">sagital</span> giram em torno do eixo látero-lateral, no <span class="pl frontal">frontal</span> em torno do anteroposterior e no <span class="pl transverso">transverso</span> em torno do longitudinal.</p>
    <div class="fontes">Fontes: ${FONTES_CAT.map(esc).join(' · ')} · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  POSE.S.aoMudar = k => {
    if (!$('mKs') || movAtivo !== m) return;
    $('mK').textContent = Math.round(k * m.max) + '°'; if (document.activeElement !== $('mKs')) $('mKs').value = Math.round(k * 100);
  };
  POSE.S.aoMudar(0);
  const dur = 1300 + m.max * 9;
  const play = on => { $('mPlay').classList.toggle('on', on); $('mPlay').textContent = on ? '❚❚ Pausar' : '▶ Reproduzir'; on ? POSE.animar(POSE.S.k > 0.5 ? 0 : 1, true, dur) : POSE.parar(); };
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaM') return listaMov('art');
    if (b.dataset.a) return mostrarArt(b.dataset.a);
    if (b.id === 'mPlay') return play(!b.classList.contains('on'));
    if (b.dataset.k !== undefined) { play(false); POSE.animar(+b.dataset.k); }
  };
  $('mKs').oninput = e => { play(false); POSE.aplicar(e.target.value / 100, false); };
  $('mKs').onchange = e => POSE.aplicar(e.target.value / 100, true);
  POSE.animar(1, true, dur);
}
async function mostrarMov(id) {
  const m = MOVS.find(x => x.id === id); if (!m) return;
  await peleProntaToast(); limparDesvio(); movAtivo = m;
  colorir({ ag: m.ag, sin: m.sin, est: m.est }, CORES_M); isolado = null; filtroInsercao = null;
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  POSE.iniciar({}, [], [], { gen: m.gen, rot: m.rot, todos: true }); aplicarVis(); destacar(null); enquadrarP(m.quadro, m.vista);
  const lista = g => m[g].length ? `<div class="pleg"><b style="color:${CORES_M[g]}"><i style="background:${CORES_M[g]}"></i>${ROT_M[g]}</b><span>${m[g].map(b => esc(nomePt(b))).join(' · ')}</span></div>` : '';
  painelP(m.nome, `<span class="tag">movimento</span>${esc(m.grupo)}`, `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaM">← Movimentos</button></div>
    <div class="pctl"><div class="pctl-t"><span>Amplitude</span><output id="mK">0%</output></div>
      <input id="mKs" type="range" min="0" max="100" step="1" value="0" aria-label="Amplitude do movimento">
      <div class="seg"><button data-k="0">Início</button><button data-k="1">Fim</button><button id="mPlay" class="on">❚❚ Pausar</button></div></div>
    <div class="kp mt4" id="mAng"></div>
    <div class="zona ok" id="mFase"></div>
    <h3>Músculos</h3>${lista('ag')}${lista('sin')}${lista('est')}
    <h3>Articulações, planos e eixos</h3>
    <table class="ac"><tr><th>Articulação</th><th>Movimento</th><th>Plano · eixo</th><th>Amplitude</th></tr>${m.juntas.map(([a, mv, p, amp]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(mv)}</td><td>${PL[p] ? `<span class="pl ${PL[p][0]}">${PL[p][0]}</span><br><small>${PL[p][1]}</small>` : '—'}</td><td>${esc(amp)}</td></tr>`).join('')}</table>
    <h3>Como funciona</h3>${m.texto}
    <h3>Pontos de atenção</h3><ul>${m.atencao.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="fontes">Fontes: ${m.fontes.map(esc).join(' · ')} · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  let ult = 0, sobe = true;
  POSE.S.aoMudar = k => {
    if (!$('mKs') || movAtivo !== m) return;
    if (Math.abs(k - ult) > 1e-4) sobe = k > ult; ult = k;
    $('mK').textContent = Math.round(k * 100) + '%'; if (document.activeElement !== $('mKs')) $('mKs').value = Math.round(k * 100);
    $('mAng').innerHTML = m.tiles(k, POSE.S.ang).map(([n, v]) => `<div><small>${esc(n)}</small><b>${Math.round(v)}°</b></div>`).join('');
    const f = m.fase(sobe); if ($('mFase').textContent !== f) $('mFase').textContent = f;
  };
  POSE.S.aoMudar(0);
  const play = on => { $('mPlay').classList.toggle('on', on); $('mPlay').textContent = on ? '❚❚ Pausar' : '▶ Reproduzir'; on ? POSE.animar(POSE.S.k > 0.5 ? 0 : 1, true, m.dur) : POSE.parar(); };
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaM') return listaMov('ex');
    if (b.id === 'mPlay') return play(!b.classList.contains('on'));
    if (b.dataset.k !== undefined) { play(false); POSE.animar(+b.dataset.k); }
  };
  $('mKs').oninput = e => { play(false); POSE.aplicar(e.target.value / 100, false); };
  $('mKs').onchange = e => POSE.aplicar(e.target.value / 100, true);
  POSE.animar(1, true, m.dur);
}

/* ---------- movimento livre: cada articulação, em cada plano, ao mesmo tempo ---------- */
// item: [chave, nome (positivo / negativo), mín, máx, padrão, plano, pivô, eixo, [grupo + , grupo −], conversão para o motor]
const GRUPOS_L = [
  { g: 'Ombro (glenoumeral)', lado: true, itens: [
    ['ombF', 'Flexão (+) / extensão (−)', -60, 180, 0, 'sag', 'omb', 'X', ['ombFlex', 'ombExt']],
    ['ombA', 'Abdução (+) / adução (−)', -30, 180, 0, 'fro', 'omb', 'Z', ['ombAbd', 'ombAdu']],
    ['ombR', 'Rotação medial (+) / lateral (−)', -90, 90, 0, 'tra', 'omb', ['omb', 'cot'], ['ombRM', 'ombRL']]] },
  { g: 'Escápula', lado: true, itens: [
    ['escElev', 'Elevação (+) / depressão (−)', -10, 30, 0, 'fro', 'acr', 'Z', ['escElev', 'escDep'], v => v / 12],
    ['escProt', 'Protração (+) / retração (−)', -15, 20, 0, 'tra', 'acr', 'Y', ['escPro', 'escRet']],
    ['escRot', 'Rotação para cima (+) / para baixo (−), além do ritmo', -15, 30, 0, 'fro', 'acr', 'Z', ['escRS', 'escRI']]] },
  { g: 'Cotovelo e antebraço', lado: true, itens: [
    ['cot', 'Flexão do cotovelo', 0, 145, 0, 'sag', 'cot', 'X', ['cotF', 'cotE']],
    ['pron', 'Pronação (+) / supinação (−), a partir do neutro', -85, 85, -85, 'tra', 'cot', ['cot', 'pun'], ['pron', 'sup'], v => 85 + v]] },
  { g: 'Punho', lado: true, itens: [
    ['punF', 'Flexão (+) / extensão (−)', -70, 80, 0, 'sag', 'pun', 'X', ['punF', 'punE']],
    ['punD', 'Desvio radial (+) / ulnar (−)', -35, 20, 0, 'fro', 'pun', 'Z', ['punR', 'punU']]] },
  { g: 'Quadril', lado: true, itens: [
    ['qF', 'Flexão (+) / extensão (−)', -25, 125, 0, 'sag', 'qua', 'X', ['quaF', 'quaE']],
    ['qA', 'Abdução (+) / adução (−)', -25, 45, 0, 'fro', 'qua', 'Z', ['quaAbd', 'quaAdu']],
    ['qR', 'Rotação medial (+) / lateral (−)', -45, 40, 0, 'tra', 'qua', ['qua', 'joe'], ['quaRM', 'quaRL']]] },
  { g: 'Joelho', lado: true, itens: [
    ['joe', 'Flexão do joelho', 0, 140, 0, 'sag', 'joe', 'X', ['joeF', 'joeE']],
    ['joeR', 'Rotação medial (+) / lateral (−) da tíbia', -30, 20, 0, 'tra', 'joe', ['joe', 'mal'], ['joeRM', 'joeRL']]] },
  { g: 'Tornozelo e pé', lado: true, itens: [
    ['df', 'Dorsiflexão (+) / flexão plantar (−)', -45, 25, 0, 'sag', 'mal', 'X', ['torDF', 'torPF']],
    ['inv', 'Inversão (+) / eversão (−)', -20, 35, 0, 'fro', 'mal', 'Z', ['inv', 'ev']]] },
  { g: 'Coluna cervical', itens: [
    ['cF', 'Flexão (+) / extensão (−)', -60, 60, 0, 'sag', 'c7', 'X', ['cerF', 'cerE']],
    ['cL', 'Inclinação para a direita (+) / esquerda (−)', -40, 40, 0, 'fro', 'c7', 'Z', ['cerL', 'cerL']],
    ['cR', 'Rotação para a direita (+) / esquerda (−)', -70, 70, 0, 'tra', 'c7', 'Y', ['cerR', 'cerR']]] },
  { g: 'Coluna torácica', itens: [
    ['tF', 'Flexão (+) / extensão (−)', -25, 40, 0, 'sag', 't7', 'X', ['trF', 'trE']],
    ['tL', 'Inclinação para a direita (+) / esquerda (−)', -25, 25, 0, 'fro', 't7', 'Z', ['trL', 'trL']],
    ['tR', 'Rotação para a direita (+) / esquerda (−)', -35, 35, 0, 'tra', 't7', 'Y', ['trR', 'trR']]] },
  { g: 'Coluna lombar', itens: [
    ['lF', 'Flexão (+) / extensão (−)', -20, 50, 0, 'sag', 'l3', 'X', ['trF', 'trE']],
    ['lL', 'Inclinação para a direita (+) / esquerda (−)', -20, 20, 0, 'fro', 'l3', 'Z', ['trL', 'trL']],
    ['lR', 'Rotação para a direita (+) / esquerda (−)', -8, 8, 0, 'tra', 'l3', 'Y', ['trR', 'trR']]] },
  { g: 'Pelve', itens: [
    ['pA', 'Anteversão (+) / retroversão (−)', -20, 60, 0, 'sag', 'sac', 'X', ['pelAnt', 'pelRet']],
    ['pO', 'Obliquidade: lado esquerdo sobe (+) / desce (−)', -12, 12, 0, 'fro', 'sac', 'Z', ['quaAbd', 'trL']],
    ['pR', 'Rotação: lado direito à frente (+) / atrás (−)', -15, 15, 0, 'tra', 'sac', 'Y', ['trR', 'trR']]] },
];
const ITENS_L = {}; GRUPOS_L.forEach(G => G.itens.forEach(it => { ITENS_L[it[0]] = { it, G }; }));
const PAI_L = { omb: 'v:Vertebra T4', acr: 'v:Vertebra T4', cot: 'umero', pun: 'radio', qua: 'pelve', joe: 'coxa', mal: 'perna', c7: 'v:Vertebra T1', t7: 'v:Vertebra L1', l3: 'pelve', sac: null };
const zeroLado = () => Object.fromEntries(GRUPOS_L.filter(G => G.lado).flatMap(G => G.itens.map(it => [it[0], it[4]])));
const zeroCorpo = () => Object.fromEntries(GRUPOS_L.filter(G => !G.lado).flatMap(G => G.itens.map(it => [it[0], it[4]])));
const LV = { d: zeroLado(), e: zeroLado(), c: zeroCorpo(), lado: 'd', ativo: null, aberto: new Set(['Ombro (glenoumeral)', 'Quadril']) };
// posições prontas para explicar exercícios (valores por lado; o corpo é comum)
const PRESETS_L = [
  { n: 'Posição anatômica', d: {}, e: {}, c: {} },
  { n: 'Elevação lateral (topo)', d: { ombA: 90, cot: 12, pron: 0 }, e: { ombA: 90, cot: 12, pron: 0 }, c: {} },
  { n: 'Desenvolvimento (topo)', d: { ombA: 160, ombF: 15, cot: 8, pron: -40 }, e: { ombA: 160, ombF: 15, cot: 8, pron: -40 }, c: {} },
  { n: 'Rosca direta (meio)', d: { cot: 90 }, e: { cot: 90 }, c: {} },
  { n: 'Remada curvada (fim)', d: { ombF: -5, ombA: 18, cot: 95, pron: 0, qF: 50, joe: 22, df: 12 }, e: { ombF: -5, ombA: 18, cot: 95, pron: 0, qF: 50, joe: 22, df: 12 }, c: { pA: 45 } },
  { n: 'Terra romeno / stiff', d: { ombF: 50, pron: 20, qF: 65, joe: 12, df: 6 }, e: { ombF: 50, pron: 20, qF: 65, joe: 12, df: 6 }, c: { pA: 60, cF: -20 } },
  { n: 'Agachamento (fundo)', d: { ombF: 85, cot: 10, pron: 0, qF: 108, qA: 12, qR: -10, joe: 112, df: 30 }, e: { ombF: 85, cot: 10, pron: 0, qF: 108, qA: 12, qR: -10, joe: 112, df: 30 }, c: { pA: 38, cF: -25 } },
  { n: 'Afundo (avanço)', d: { qF: 92, joe: 90, df: 5 }, e: { qF: -12, joe: 88, df: 10 }, c: { cF: -5 } },
  { n: 'Apoio em uma perna', d: {}, e: { qF: 50, joe: 85 }, c: { pO: 2 } },
  { n: 'Arremesso (armando o braço)', d: { ombA: 90, ombR: -85, cot: 90, pron: 0 }, e: { ombA: 60, ombF: 40, cot: 30 }, c: { tR: 25, lR: 5 } },
];
const lerL = (o, k) => (o[k] ?? ITENS_L[k].it[4]);
function defLivre(src = LV) {
  const L = { d: {}, e: {} }, c = src.c;
  for (const l of ['d', 'e']) for (const [k] of Object.entries(zeroLado())) { const it = ITENS_L[k].it, v = lerL(src[l], k); L[l][k] = it[9] ? it[9](v) : v; }
  for (const l of ['d', 'e']) { if (src[l].mtp) L[l].mtp = src[l].mtp; if (src[l].pega) L[l].pega = src[l].pega; }
  const v = k => lerL(c, k);
  return {
    mov: { L },
    col: { cerI: [v('cF') * 0.6, v('cL') * 0.75, -v('cR') * 0.45], cerS: [v('cF') * 0.4, v('cL') * 0.25, -v('cR') * 0.55], torI: [v('tF') * 0.55, v('tL') * 0.55, -v('tR') * 0.55], torS: [v('tF') * 0.45, v('tL') * 0.45, -v('tR') * 0.45], lum: [v('lF'), v('lL'), -v('lR')] },
    pelve: { ant: v('pA'), obl: v('pO'), rot: v('pR') },
  };
}
const fmtL = v => (v > 0 ? '+' : '') + Math.round(v) + '°';
const ladoTxt = { d: 'direito', e: 'esquerdo', ambos: 'os dois lados' };
function eixoL(it, l) {   // ponto e direção do eixo do item ativo, já na pose atual
  const mk = POSE.S.mk, M = POSE.S.M || {}, nome = p => (PAI_L[p] !== undefined && /^(omb|acr|cot|pun|qua|joe|mal)$/.test(p)) ? p + '_' + l : p;
  const piv = mk[nome(it[6])] ? mk[nome(it[6])].p.clone() : new THREE.Vector3(0, 1, 0);
  let dir;
  if (Array.isArray(it[7])) dir = mk[nome(it[7][1])].p.clone().sub(mk[nome(it[7][0])].p);
  else { dir = EIXOS[it[7]].clone(); const pai = PAI_L[it[6]], seg = pai && (/^v:|pelve/.test(pai) ? pai : pai + l); if (seg && M[seg]) dir.transformDirection(M[seg]); }
  return { piv, dir };
}
function corLivre() {   // pinta os músculos do movimento que está sendo mexido
  for (const m of Object.values(MESH)) if (m.userData.cor0) { m.material.color.copy(m.userData.cor0); delete m.userData.cor0; }
  const a = LV.ativo; if (!a) return;
  const { it, G } = ITENS_L[a], l = G.lado ? (LV.lado === 'ambos' ? 'd' : LV.lado) : null, val = G.lado ? lerL(LV[l], a) : lerL(LV.c, a);
  const grupo = MU[it[8][val >= it[4] ? 0 : 1]] || [];
  colorir({ ag: grupo }, CORES_M, G.lado && LV.lado !== 'ambos' ? (l === 'd' ? 'direito' : 'esquerdo') : null);
}
let tweenL = null;
function irPreset(p) {
  const de = JSON.parse(JSON.stringify({ d: LV.d, e: LV.e, c: LV.c }));
  const ate = { d: { ...zeroLado(), ...p.d }, e: { ...zeroLado(), ...p.e }, c: { ...zeroCorpo(), ...p.c } };
  const t0 = performance.now(), dur = 900; cancelAnimationFrame(tweenL);
  const passo = () => {
    const u = Math.min(1, (performance.now() - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    for (const g of ['d', 'e', 'c']) for (const k of Object.keys(ate[g])) LV[g][k] = de[g][k] + (ate[g][k] - de[g][k]) * e;
    POSE.aplicar(1, u >= 1); sujar(2);
    if (u < 1) tweenL = requestAnimationFrame(passo); else { tweenL = null; desenharSliders(); }
  };
  passo();
}
function linhaL(it, G) {
  const l = LV.lado === 'ambos' ? 'd' : LV.lado, v = G.lado ? lerL(LV[l], it[0]) : lerL(LV.c, it[0]), pl = PLANOS[it[5]];
  return `<div class="lv-it${LV.ativo === it[0] ? ' on' : ''}" data-k="${it[0]}" style="--pc:${pl[2]}">
    <div class="lv-t"><span>${esc(it[1])}</span><output>${fmtL(v)}</output></div>
    <input type="range" min="${it[2]}" max="${it[3]}" step="1" value="${Math.round(v)}" data-k="${it[0]}" aria-label="${esc(it[1])}">
    <div class="lv-pl"><span class="pl ${pl[0]}">${pl[0]}</span><small>eixo ${pl[1]}</small><button data-z="${it[0]}" title="Zerar">0</button></div></div>`;
}
function desenharSliders() {
  const el = $('lvG'); if (!el) return;
  el.innerHTML = GRUPOS_L.map(G => `<details ${LV.aberto.has(G.g) ? 'open' : ''} data-g="${esc(G.g)}"><summary>${esc(G.g)}${G.lado ? ` <small>${ladoTxt[LV.lado]}</small>` : ''}</summary>${G.itens.map(it => linhaL(it, G)).join('')}</details>`).join('');
  leituraL();
}
function leituraL() {   // todos os ângulos fora do zero, com plano
  const el = $('lvLeit'); if (!el) return; const linhas = [];
  for (const G of GRUPOS_L) for (const it of G.itens) {
    const vals = G.lado ? [['d', lerL(LV.d, it[0])], ['e', lerL(LV.e, it[0])]] : [['', lerL(LV.c, it[0])]];
    for (const [l, v] of vals) if (Math.abs(v - it[4]) >= 1) linhas.push(`<tr><td>${esc(G.g.split(' (')[0])}${l ? ` <small>${l === 'd' ? 'D' : 'E'}</small>` : ''}</td><td>${esc(it[1].split(' (')[0].replace(/ \/.*$/, ''))}${v < 0 && /\//.test(it[1]) ? ' <small>(' + esc(it[1].split('/')[1].replace(/\(.*?\)/g, '').trim()) + ')</small>' : ''}</td><td><span class="pl ${PLANOS[it[5]][0]}">${PLANOS[it[5]][0]}</span></td><td>${fmtL(v)}</td></tr>`);
  }
  el.innerHTML = linhas.length ? `<table class="ac pleit"><tr><th>Segmento</th><th>Movimento</th><th>Plano</th><th>Ângulo</th></tr>${linhas.join('')}</table>` : '<p class="pnota">Todas as articulações estão na posição anatômica. Mexa em qualquer controle: os outros ficam onde estão.</p>';
}
async function mostrarLivre() {
  await peleProntaToast(); limparDesvio(); movAtivo = { id: 'livre' }; isolado = null; filtroInsercao = null;
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  const rot = () => {
    const a = LV.ativo; if (!a) { PE.mostrar(false); return []; }
    const { it, G } = ITENS_L[a], l = G.lado ? (LV.lado === 'e' ? 'e' : 'd') : 'd', { piv, dir } = eixoL(it, l), pl = PLANOS[it[5]];
    PE.atualizar(piv, dir, pl[2], /^(c7|pun|mal|cot)$/.test(it[6]) ? 0.14 : /^(omb|qua|acr)$/.test(it[6]) ? 0.24 : 0.2); PE.mostrar(true);
    const v = G.lado ? lerL(LV[l], a) : lerL(LV.c, a);
    return [{ p: piv, t: `${it[1].split(' (')[0].replace(/ \/.*$/, '').toLowerCase()} ${fmtL(v)}`, c: pl[2] }];
  };
  POSE.iniciar({}, [], [], { gen: () => defLivre(), rot, todos: true, k0: 1 }); aplicarVis(); destacar(null);
  enquadrarP('corpo', 'frente');
  painelP('Movimento livre', '<span class="tag">cinesiologia</span>todas as articulações ao mesmo tempo', `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaM">← Movimentos</button><button id="lvZero">Zerar tudo</button><button id="lvEsp">Copiar D → E</button></div>
    <p>Combine qualquer ângulo de qualquer articulação, em qualquer plano. O controle que você mexer mostra o <b>plano</b> (disco) e o <b>eixo</b> (linha) na articulação e pinta os músculos que fazem aquele movimento. O pé mais baixo fica sempre apoiado no chão.</p>
    <div class="seg" id="lvLado">${['d', 'e', 'ambos'].map(l => `<button data-l="${l}" class="${LV.lado === l ? 'on' : ''}">${l === 'd' ? 'Lado direito' : l === 'e' ? 'Lado esquerdo' : 'Os dois (espelhado)'}</button>`).join('')}</div>
    <h3>Posições prontas</h3><div class="seg" id="lvPre">${PRESETS_L.map((p, i) => `<button data-p="${i}">${esc(p.n)}</button>`).join('')}</div>
    <h3>Articulações</h3><div id="lvG" class="lv"></div>
    <h3>Leitura da pose</h3><div id="lvLeit"></div>
    <div class="aviso">Os ângulos de cada articulação são medidos a partir da posição anatômica, no segmento de cima (o ombro em relação ao tronco, o joelho em relação à coxa…). No ombro, a escápula gira sozinha conforme a elevação do braço (ritmo escapuloumeral); o controle da escápula soma ou tira desse ritmo.</div>
    <div class="fontes">Amplitudes de referência: Marques (Manual de goniometria), AAOS e Neumann · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  desenharSliders();
  const pB = $('pB');
  pB.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaM') return listaMov('ex');
    if (b.id === 'lvZero') return irPreset(PRESETS_L[0]);
    if (b.id === 'lvEsp') { LV.e = { ...LV.d }; POSE.aplicar(1); desenharSliders(); sujar(2); return; }
    if (b.dataset.l) { LV.lado = b.dataset.l; pB.querySelectorAll('#lvLado button').forEach(x => x.classList.toggle('on', x === b)); desenharSliders(); corLivre(); POSE.aplicar(1); return; }
    if (b.dataset.p !== undefined) { LV.ativo = null; corLivre(); return irPreset(PRESETS_L[+b.dataset.p]); }
    if (b.dataset.z) { mudarL(b.dataset.z, ITENS_L[b.dataset.z].it[4], true); desenharSliders(); }
  };
  pB.addEventListener('toggle', ev => { const d = ev.target; if (d.tagName === 'DETAILS') d.open ? LV.aberto.add(d.dataset.g) : LV.aberto.delete(d.dataset.g); }, true);
  pB.oninput = ev => { const r = ev.target; if (r.type !== 'range' || !r.dataset.k) return; mudarL(r.dataset.k, +r.value, false); const o = r.parentElement.querySelector('output'); if (o) o.textContent = fmtL(+r.value); };
  pB.onchange = ev => { const r = ev.target; if (r.type === 'range' && r.dataset.k) { POSE.aplicar(1, true); leituraL(); } };
}
function mudarL(k, v, fim) {
  if (tweenL) { cancelAnimationFrame(tweenL); tweenL = null; }   // mexer num controle interrompe a transição para uma posição pronta
  const { G } = ITENS_L[k];
  if (G.lado) { if (LV.lado === 'ambos') { LV.d[k] = v; LV.e[k] = v; } else LV[LV.lado][k] = v; } else LV.c[k] = v;
  if (LV.ativo !== k) { LV.ativo = k; corLivre(); document.querySelectorAll('.lv-it').forEach(x => x.classList.toggle('on', x.dataset.k === k)); }
  POSE.aplicar(1, fim); sujar(2); if (fim) leituraL();
}

/* ---------- marcha ---------- */
// curvas médias da marcha em velocidade confortável (Perry e Burnfield; Winter), em % do ciclo da perna direita (0 = contato inicial)
const CURVAS_M = {
  qF: [[0, 30], [10, 27], [20, 18], [30, 8], [40, -2], [50, -10], [55, -8], [60, 0], [65, 10], [75, 24], [85, 31], [92, 31], [100, 30]],
  joe: [[0, 4], [8, 14], [15, 18], [25, 10], [35, 5], [42, 6], [50, 14], [60, 38], [68, 56], [73, 60], [80, 48], [87, 25], [95, 6], [100, 4]],
  df: [[0, 0], [6, -6], [12, -2], [20, 4], [30, 8], [42, 10], [48, 6], [55, -8], [62, -18], [68, -10], [75, -2], [85, 0], [100, 0]],
  mtp: [[0, 8], [8, 0], [35, 0], [45, 12], [52, 30], [60, 45], [65, 20], [72, 5], [100, 8]],
  qA: [[0, -2], [12, -6], [30, -4], [50, 0], [62, 4], [75, 3], [90, 0], [100, -2]],
  qR: [[0, 2], [15, 5], [50, -2], [70, -5], [100, 2]],
  pO: [[0, 0], [15, -5], [35, -2], [50, 0], [65, 5], [85, 2], [100, 0]],
};
const curva = (pts, t) => {   // Catmull-Rom periódica
  const x = ((t % 100) + 100) % 100; let i = 0; while (i < pts.length - 2 && pts[i + 1][0] <= x) i++;
  const p1 = pts[i], p2 = pts[i + 1], p0 = i > 0 ? pts[i - 1] : [pts[pts.length - 2][0] - 100, pts[pts.length - 2][1]], p3 = i + 2 < pts.length ? pts[i + 2] : [pts[1][0] + 100, pts[1][1]];
  const u = (x - p1[0]) / (p2[0] - p1[0] || 1), m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * (p2[0] - p1[0]), m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
};
function poseMarcha(f) {   // f: 0–1 do ciclo da perna direita
  const t = f * 100, perna = tt => ({ qF: curva(CURVAS_M.qF, tt), joe: curva(CURVAS_M.joe, tt), df: curva(CURVAS_M.df, tt), mtp: Math.max(0, curva(CURVAS_M.mtp, tt)), qA: curva(CURVAS_M.qA, tt), qR: curva(CURVAS_M.qR, tt) });
  const d = perna(t), e = perna(t + 50);
  const braco = q => { const ombF = -0.5 * (q - 10); return { ombF, ombA: 7, cot: 18 + 0.7 * (ombF + 10), pron: 0 }; };
  Object.assign(d, braco(e.qF)); Object.assign(e, braco(d.qF));   // o braço balança junto com a perna do outro lado
  const pR = 4 * Math.cos(2 * Math.PI * f), pO = curva(CURVAS_M.pO, t), pA = 1.2 * Math.cos(4 * Math.PI * f);
  return { d, e, c: { pR, pO, pA, lR: 0, tR: 0, cR: 0, lL: 0 }, raw: { pR, pO, pA } };
}
function defMarcha(f) {
  const p = poseMarcha(f), L = { d: {}, e: {} };
  for (const l of ['d', 'e']) { const s = p[l]; L[l] = { qF: s.qF, qA: s.qA, qR: s.qR, joe: s.joe, df: s.df, mtp: s.mtp, ombF: s.ombF, ombA: s.ombA, cot: s.cot, pron: 85 + s.pron }; }
  const { pR, pO, pA } = p.raw;
  // o tórax gira ao contrário da pelve e a cabeça continua olhando à frente; o tronco compensa a queda da pelve
  return { mov: { L }, pelve: { ant: pA, obl: pO, rot: pR }, col: { lum: [-pA, -pO * 0.9, -0.34 * pR], torI: [0, 0, -0.68 * pR], torS: [0, 0, -0.68 * pR], cerI: [0, 0, 0.35 * pR], cerS: [0, 0, 0.35 * pR] } };
}
const TIPO_C = { con: ['#f7b84b', 'concêntrica'], exc: ['#ff6b8b', 'excêntrica'], iso: ['#3fd8cb', 'isométrica'] };
const FASES_M = [
  { id: 'ci', n: 'Contato inicial', a: 0, b: 2, apoio: 'Apoio · duplo apoio', obj: 'Começar o apoio com o calcanhar, já preparando o rolamento do pé.',
    ang: ['Quadril ~30° de flexão', 'Joelho quase estendido (0–5°)', 'Tornozelo neutro (0°)'],
    mus: [['Gluteus maximus muscle', 'iso', 'segura o quadril flexionado contra a carga que chega'], ['Semitendinosus muscle', 'iso', 'isquiotibiais seguram quadril e joelho'], ['Semimembranosus muscle', 'iso', ''], ['Long head of biceps femoris', 'iso', ''], ['Tibialis anterior muscle', 'exc', 'prepara a descida controlada do antepé'], ['Vastus lateralis muscle', 'iso', 'os vastos se preparam para receber o peso'], ['Vastus medialis muscle', 'iso', '']] },
  { id: 'rc', n: 'Resposta à carga', a: 2, b: 12, apoio: 'Apoio · duplo apoio', obj: 'Absorver o impacto, manter a estabilidade e continuar avançando.',
    ang: ['Quadril começa a estender (~30 → 25°)', 'Joelho flexiona até 15–20° (amortece)', 'Tornozelo: ~5–7° de flexão plantar (rolamento do calcanhar)'],
    mus: [['Vastus lateralis muscle', 'exc', 'controlam a flexão do joelho que amortece'], ['Vastus medialis muscle', 'exc', ''], ['Vastus intermedius muscle', 'exc', ''], ['Tibialis anterior muscle', 'exc', 'freia o antepé até ele encostar no chão'], ['Gluteus maximus muscle', 'con', 'estende o quadril e segura o tronco'], ['Adductor magnus', 'con', 'ajuda a estender o quadril'], ['Gluteus medius muscle', 'exc', 'segura a pelve no plano frontal quando o peso passa para esta perna'], ['Gluteus minimus muscle', 'exc', '']] },
  { id: 'am', n: 'Apoio médio', a: 12, b: 31, apoio: 'Apoio · apoio simples', obj: 'Avançar o corpo sobre o pé parado, com o membro estável.',
    ang: ['Quadril chega ao neutro (0°)', 'Joelho estende até ~5°', 'Tornozelo: dorsiflexão até 5–10° (a tíbia avança sobre o pé)'],
    mus: [['Soleus muscle', 'exc', 'controla o avanço da tíbia sobre o pé'], ['Medial head of gastrocnemius', 'exc', ''], ['Lateral head of gastrocnemius', 'exc', ''], ['Gluteus medius muscle', 'iso', 'apoio em uma perna: mantém a pelve quase nivelada'], ['Tibialis posterior muscle', 'exc', 'controla o arco e a pronação do pé'], ['Vastus lateralis muscle', 'con', 'terminam de estender o joelho']] },
  { id: 'at', n: 'Apoio terminal', a: 31, b: 50, apoio: 'Apoio · apoio simples', obj: 'Levar o corpo à frente do pé de apoio; o calcanhar sobe.',
    ang: ['Quadril em extensão de 10–20°', 'Joelho ~5°, começa a flexionar', 'Tornozelo: ~10° de dorsiflexão e o calcanhar sobe (dedos estendem na metatarsofalângica)'],
    mus: [['Soleus muscle', 'con', 'principal fonte de impulso: o calcanhar sobe'], ['Medial head of gastrocnemius', 'con', ''], ['Lateral head of gastrocnemius', 'con', ''], ['Flexor hallucis longus', 'con', 'ajudam a empurrar pelos dedos'], ['Flexor digitorum longus', 'con', ''], ['Fibularis longus muscle', 'con', 'estabilizam o antepé'], ['Psoas major', 'exc', 'freia a extensão do quadril (energia elástica para o balanço)'], ['Iliacus muscle', 'exc', '']] },
  { id: 'pb', n: 'Pré-balanço', a: 50, b: 62, apoio: 'Apoio · duplo apoio', obj: 'Passar o peso para a outra perna e preparar o balanço.',
    ang: ['Quadril volta ao neutro', 'Joelho flexiona até ~40°', 'Tornozelo: 15–20° de flexão plantar (impulsão final)'],
    mus: [['Medial head of gastrocnemius', 'con', 'impulsão final'], ['Soleus muscle', 'con', ''], ['Rectus femoris muscle', 'exc', 'controla a flexão do joelho e inicia a flexão do quadril'], ['Adductor longus', 'con', 'inicia a flexão do quadril'], ['Psoas major', 'con', 'puxa a coxa à frente'], ['Iliacus muscle', 'con', '']] },
  { id: 'bi', n: 'Balanço inicial', a: 62, b: 75, apoio: 'Balanço', obj: 'Tirar o pé do chão e começar a levar a perna à frente.',
    ang: ['Quadril flexiona até 15–20°', 'Joelho chega ao máximo (~60°)', 'Tornozelo: de 20° de flexão plantar até ~5°'],
    mus: [['Psoas major', 'con', 'flexão do quadril'], ['Iliacus muscle', 'con', ''], ['Sartorius muscle', 'con', ''], ['Gracilis muscle', 'con', ''], ['Short head of biceps femoris', 'con', 'flexiona o joelho para o pé passar'], ['Tibialis anterior muscle', 'con', 'levanta o pé para ele não arrastar'], ['Extensor digitorum longus', 'con', ''], ['Extensor hallucis longus', 'con', '']] },
  { id: 'bm', n: 'Balanço médio', a: 75, b: 87, apoio: 'Balanço', obj: 'Levar a coxa à frente com o pé livre do chão.',
    ang: ['Quadril em 25–30° de flexão', 'Joelho estende de ~60° até ~25° (quase como um pêndulo)', 'Tornozelo neutro'],
    mus: [['Tibialis anterior muscle', 'iso', 'mantém o tornozelo neutro'], ['Psoas major', 'con', 'termina de flexionar o quadril'], ['Semitendinosus muscle', 'exc', 'isquiotibiais começam a frear a perna']] },
  { id: 'bt', n: 'Balanço terminal', a: 87, b: 100, apoio: 'Balanço', obj: 'Desacelerar a perna e preparar o próximo contato.',
    ang: ['Quadril mantém ~30°', 'Joelho estende até ~0°', 'Tornozelo neutro'],
    mus: [['Semitendinosus muscle', 'exc', 'desaceleram a perna e o quadril'], ['Semimembranosus muscle', 'exc', ''], ['Long head of biceps femoris', 'exc', ''], ['Vastus lateralis muscle', 'con', 'estendem o joelho para o contato'], ['Vastus medialis muscle', 'con', ''], ['Vastus intermedius muscle', 'con', ''], ['Tibialis anterior muscle', 'iso', 'pé pronto para tocar com o calcanhar'], ['Gluteus maximus muscle', 'iso', 'começa a ativar']] },
];
const faseDe = t => FASES_M.find(f => t >= f.a && t < f.b) || FASES_M[0];
function graficoMarcha() {   // curvas sagitais do quadril, joelho e tornozelo com as fases ao fundo
  const W = 360, H = 170, x = t => 30 + t / 100 * (W - 38), y = v => 12 + (70 - v) / 95 * (H - 30);
  const linha = (pts, cor) => `<path d="${Array.from({ length: 101 }, (_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(curva(pts, i)).toFixed(1)}`).join('')}" fill="none" stroke="${cor}" stroke-width="2"/>`;
  return `<svg id="mGraf" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    ${FASES_M.map((f, i) => `<rect x="${x(f.a)}" y="8" width="${x(f.b) - x(f.a)}" height="${H - 26}" fill="${i % 2 ? '#ffffff07' : '#ffffff0d'}"/>`).join('')}
    <line x1="${x(62)}" x2="${x(62)}" y1="8" y2="${H - 18}" stroke="#939dba" stroke-dasharray="3 3"/>
    ${[60, 30, 0, -20].map(v => `<line x1="30" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#2e3a66"/><text x="4" y="${y(v) + 4}" fill="#939dba" font-size="10">${v}°</text>`).join('')}
    ${linha(CURVAS_M.qF, '#f7b84b')}${linha(CURVAS_M.joe, '#3fd8cb')}${linha(CURVAS_M.df, '#ff6b8b')}
    <text x="${x(28)}" y="${H - 4}" fill="#c0c8dc" font-size="10" text-anchor="middle">apoio (0–62%)</text><text x="${x(81)}" y="${H - 4}" fill="#c0c8dc" font-size="10" text-anchor="middle">balanço (62–100%)</text>
    <line id="mCur" x1="30" x2="30" y1="8" y2="${H - 18}" stroke="#fff" stroke-width="1.5"/></svg>
    <div class="leg"><span><i style="background:#f7b84b"></i>Quadril (flexão +)</span><span><i style="background:#3fd8cb"></i>Joelho (flexão +)</span><span><i style="background:#ff6b8b"></i>Tornozelo (dorsiflexão +)</span></div>`;
}
let marchaVel = 2.4, marchaFase = null;
async function mostrarMarcha() {
  await peleProntaToast(); limparDesvio(); movAtivo = { id: 'marcha' }; isolado = null; filtroInsercao = null; marchaFase = null;
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  const rot = (A, mk) => {
    const L = A.Ld || {}; return [{ p: mk.qua_d.p, t: 'quadril ' + fmtL(L.qF || 0), c: '#f7b84b' }, { p: mk.joe_d.p, t: 'joelho ' + Math.round(L.joe || 0) + '°', c: '#3fd8cb' }, { p: mk.mal_d.p, t: 'tornozelo ' + fmtL(L.df || 0), c: '#ff6b8b' }];
  };
  POSE.iniciar({}, [], [], { gen: defMarcha, rot, todos: true }); aplicarVis(); destacar(null); PE.mostrar(false);
  enquadrarP('corpo', 'lat');
  painelP('Marcha humana', '<span class="tag">cinesiologia</span>ciclo da marcha, fase a fase', `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaM">← Movimentos</button></div>
    <div class="pctl"><div class="pctl-t"><span>Ciclo da perna direita</span><output id="mK">0%</output></div>
      <input id="mKs" type="range" min="0" max="100" step="0.5" value="0" aria-label="Momento do ciclo da marcha">
      <div class="seg"><button id="mPlay" class="on">❚❚ Pausar</button>${[[5, 'Bem devagar'], [2.4, 'Estudo'], [1.1, 'Velocidade real']].map(([v, n]) => `<button data-v="${v}" class="${marchaVel === v ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="seg">${[['lat', 'Lateral'], ['frente', 'Frente'], ['post', 'Costas'], ['alto', 'De cima']].map(([v, n]) => `<button data-vista="${v}">${n}</button>`).join('')}</div></div>
    <div class="mfases">${FASES_M.map(f => `<button data-f="${f.id}" style="flex:${f.b - f.a}" title="${esc(f.n)} (${f.a}–${f.b}%)">${f.id.toUpperCase()}</button>`).join('')}</div>
    <div id="mFaseC"></div>
    <h3>Ângulos ao longo do ciclo (plano sagital)</h3>${graficoMarcha()}
    <div class="kp mt4" id="mAng"></div>
    <h3>Planos e eixos na marcha</h3>
    <table class="ac"><tr><th>Plano · eixo</th><th>O que acontece</th></tr>
      <tr><td><span class="pl sagital">sagital</span><br><small>látero-lateral</small></td><td>Quase todo o movimento: flexão e extensão do quadril (~40° no total), do joelho (0 a 60°) e do tornozelo (de 20° de flexão plantar a 10° de dorsiflexão); balanço dos braços e flexão do cotovelo.</td></tr>
      <tr><td><span class="pl frontal">frontal</span><br><small>anteroposterior</small></td><td>A pelve cai ~5° do lado da perna em balanço (o glúteo médio do lado de apoio segura); o quadril aduz um pouco no apoio; a subtalar everte no apoio inicial e inverte no fim.</td></tr>
      <tr><td><span class="pl transverso">transverso</span><br><small>longitudinal</small></td><td>A pelve gira ~4° para cada lado (o lado da perna que avança vai à frente) e o tórax gira ao contrário, junto com o braço do outro lado: isso equilibra o corpo e economiza energia.</td></tr></table>
    <h3>Como funciona</h3>
    <p><b>Um ciclo</b> vai de um contato do calcanhar até o próximo contato do mesmo pé. Em velocidade confortável, cerca de <b>60%</b> é apoio e <b>40%</b> é balanço. Há dois períodos de <b>duplo apoio</b> (cerca de 10% cada), quando os dois pés estão no chão; na corrida eles somem e aparece uma fase de voo.</p>
    <p><b>Três rolamentos</b> levam o corpo à frente durante o apoio: o do calcanhar (resposta à carga), o do tornozelo (a tíbia avança sobre o pé no apoio médio) e o do antepé (o calcanhar sobe e o corpo rola sobre as cabeças dos metatarsos).</p>
    <p><b>Os músculos trabalham pouco e na hora certa.</b> Boa parte da marcha é passiva (pêndulo e energia elástica); a maioria dos músculos age em ação excêntrica para controlar o movimento, e as grandes ações concêntricas são o impulso do tríceps sural no fim do apoio e a flexão do quadril pelo iliopsoas no início do balanço.</p>
    <p class="pnota">No modelo o corpo fica parado à frente, como numa esteira: a perna de apoio desliza para trás e o pé mais baixo fica sempre no chão. Os músculos coloridos são os da perna direita, na fase atual.</p>
    <h3>Pontos de atenção</h3><ul>
      <li><b>Sinal de Trendelenburg:</b> se a pelve cai muito do lado em balanço, o glúteo médio do lado de apoio está fraco.</li>
      <li><b>Pé caído:</b> fraqueza do tibial anterior faz o pé arrastar no balanço; a pessoa compensa elevando mais o joelho (marcha escarvante).</li>
      <li><b>Pouca extensão do quadril</b> no apoio terminal (iliopsoas encurtado, por exemplo) encurta o passo e aumenta a anteversão da pelve e a lordose.</li>
      <li><b>Joelho que não flexiona no balanço</b> (reto femoral muito ativo) obriga a circundução da perna ou a elevação do quadril.</li></ul>
    <div class="fontes">Fontes: Perry e Burnfield. Gait Analysis: Normal and Pathological Function · Winter. Biomechanics and Motor Control of Human Movement · Neumann, cap. 15 · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  const atual = () => POSE.S.loop ? POSE.S.loop.fase : POSE.S.k;
  POSE.S.aoMudar = f => {
    if (!$('mKs') || movAtivo.id !== 'marcha') return;
    const t = f * 100; $('mK').textContent = Math.round(t) + '%'; if (document.activeElement !== $('mKs')) $('mKs').value = t.toFixed(1);
    const c = $('mCur'); if (c) { const xx = 30 + t / 100 * (360 - 38); c.setAttribute('x1', xx); c.setAttribute('x2', xx); }
    const L = POSE.S.ang.Ld || {}, Le = POSE.S.ang.Le || {};
    $('mAng').innerHTML = [['Quadril D', L.qF], ['Joelho D', L.joe], ['Tornozelo D', L.df], ['Quadril E', Le.qF]].map(([n, v]) => `<div><small>${n}</small><b>${fmtL(v || 0)}</b></div>`).join('');
    const fa = faseDe(t); if (fa !== marchaFase) { marchaFase = fa; mostrarFaseM(fa); }
  };
  POSE.aplicar(0); POSE.laco(marchaVel * 1000, 0);
  const play = on => { $('mPlay').classList.toggle('on', on); $('mPlay').textContent = on ? '❚❚ Pausar' : '▶ Reproduzir'; POSE.pausarLaco(!on); sujar(2); };
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaM') return listaMov('ex');
    if (b.id === 'mPlay') return play(!b.classList.contains('on'));
    if (b.dataset.v) { marchaVel = +b.dataset.v; const f = atual(); POSE.laco(marchaVel * 1000, f); if (!$('mPlay').classList.contains('on')) POSE.pausarLaco(true); $('pB').querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b)); return; }
    if (b.dataset.vista) return enquadrarP('corpo', b.dataset.vista);
    if (b.dataset.f) { const fa = FASES_M.find(x => x.id === b.dataset.f); play(false); POSE.irFase((fa.a + fa.b) / 200); sujar(2); }
  };
  $('mKs').oninput = e => { play(false); POSE.irFase(e.target.value / 100); sujar(2); };
}
function mostrarFaseM(fa) {
  document.querySelectorAll('.mfases button').forEach(b => b.classList.toggle('on', b.dataset.f === fa.id));
  for (const m of Object.values(MESH)) if (m.userData.cor0) { m.material.color.copy(m.userData.cor0); delete m.userData.cor0; }
  const grupos = { con: [], exc: [], iso: [] }; for (const [b, tp] of fa.mus) grupos[tp].push(b);
  colorir(grupos, Object.fromEntries(Object.entries(TIPO_C).map(([k, v]) => [k, v[0]])), 'direito'); sujar(2);
  const el = $('mFaseC'); if (!el) return;
  el.innerHTML = `<div class="mfase"><div class="mfase-t"><b>${esc(fa.n)}</b><span>${fa.a}–${fa.b}% · ${esc(fa.apoio)}</span></div>
    <p>${esc(fa.obj)}</p>
    <ul>${fa.ang.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    <div class="mleg">${Object.entries(TIPO_C).map(([k, [c, n]]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>
    <table class="ac">${fa.mus.map(([b, tp, fn]) => `<tr><td><i class="dotp" style="background:${TIPO_C[tp][0]}"></i><b>${esc(nomePt(b))}</b>${fn ? `<br><small>${esc(fn)}</small>` : ''}</td><td>${TIPO_C[tp][1]}</td></tr>`).join('')}</table></div>`;
}

/* ---------- simulador de exercícios: torque, braço de momento e esforço de cada músculo ---------- */
// Modelo quase estático no plano sagital, medido no próprio corpo 3D. Massas e centros de massa dos segmentos pelas proporções de Winter.
// Momento externo em cada articulação = soma de (peso × distância horizontal até a articulação) de tudo o que fica do lado que se move.
// O esforço de cada músculo divide esse momento entre os músculos que podem vencê-lo (proporcional à área de secção e ao braço de momento).
const RS = Math.PI / 180, sen = x => Math.sin(Math.max(0, x) * RS), lim = (x, a, b) => Math.max(a, Math.min(b, x));
const MW = { pe: 0.0145, perna: 0.0465, coxa: 0.1, pelve: 0.142, tronco: 0.355, cabeca: 0.081, braco: 0.028, antebraco: 0.016, mao: 0.006 };
// torque máximo voluntário de referência de cada grupo (N·m, adulto treinado de 75 kg; escala com a massa^0,67) e o ângulo em que ele é medido
const TMAX = { 'qua.ext': [260, { qua: 60 }], 'qua.flex': [150, { qua: 30 }], 'joe.ext': [260, { joe: 60 }], 'joe.flex': [130, { joe: 45 }], 'tor.pf': [170, { tor: 0 }], 'tor.df': [45, { tor: 0 }],
  'lom.ext': [330, { lom: 0 }], 'lom.flex': [220, { lom: 0 }], 'omb.ext': [90, { omb: 45 }], 'omb.flex': [70, { omb: 45 }], 'cot.flex': [70, { cot: 90 }], 'cot.ext': [50, { cot: 90 }], 'oma.adu': [105, { oma: 45 }], 'oma.abd': [70, { oma: 45 }],
  'ese.dep': [80, {}], 'ese.elev': [90, {}], 'esp.ret': [90, {}], 'esp.pro': [95, {}], 'esr.rb': [75, {}], 'esr.rc': [110, {}] };   // escápula: sem medida direta de referência; valores coerentes com a tensão dos outros grupos
// articulações: quem precisa trabalhar quando a carga passa à frente (pos) ou atrás (neg) da articulação
const JS = {
  tor: { n: 'Tornozelo', cor: '#94d82d', pos: ['pf', 'flexores plantares (sóleo e gastrocnêmio)'], neg: ['df', 'dorsiflexores (tibial anterior)'], lado: 'perna' },
  joe: { n: 'Joelho', cor: '#ff9f43', pos: ['flex', 'flexores do joelho'], neg: ['ext', 'extensores do joelho (quadríceps)'], lado: 'perna' },
  qua: { n: 'Quadril', cor: '#ff5d73', pos: ['ext', 'extensores do quadril (glúteo máximo, adutor magno e isquiotibiais)'], neg: ['flex', 'flexores do quadril'], lado: 'perna' },
  lom: { n: 'Lombar', cor: '#c084fc', pos: ['ext', 'extensores da coluna (eretores e multífidos)'], neg: ['flex', 'músculos do abdômen (flexores do tronco)'] },
  omb: { n: 'Ombro', cor: '#4dabf7', pos: ['flex', 'flexores do ombro (deltoide clavicular)'], neg: ['ext', 'extensores do ombro (latíssimo, redondo maior e deltoide espinal)'], lado: 'braço' },
  oma: { n: 'Ombro (plano frontal)', cor: '#f783ac', pos: ['abd', 'abdutores do ombro (deltoide acromial e supraespinal)'], neg: ['adu', 'adutores do ombro (latíssimo do dorso, redondo maior e peitoral maior esternocostal)'], lado: 'braço' },
  ese: { n: 'Escápula · elevação e depressão', cor: '#ffa94d', pos: ['elev', 'elevadores da escápula (trapézio superior e levantador)'], neg: ['dep', 'depressores da escápula (trapézio inferior e peitoral menor)'], lado: 'lado' },
  esp: { n: 'Escápula · protração e retração', cor: '#69db7c', pos: ['ret', 'retratores da escápula (trapézio médio e romboides)'], neg: ['pro', 'protratores da escápula (serrátil anterior e peitoral menor)'], lado: 'lado' },
  esr: { n: 'Escápula · rotação', cor: '#da77f2', pos: ['rb', 'rotadores para baixo (romboides, peitoral menor e levantador)'], neg: ['rc', 'rotadores para cima (serrátil anterior e trapézio)'], lado: 'lado' },
  cot: { n: 'Cotovelo', cor: '#3fd8cb', pos: ['flex', 'flexores do cotovelo (bíceps, braquial e braquiorradial)'], neg: ['ext', 'extensores do cotovelo (tríceps)'], lado: 'braço' },
};
const ANG_POS = { qua: 'flex', joe: 'flex', tor: 'df', lom: 'flex', omb: 'flex', cot: 'flex', oma: 'abd', ese: 'elev', esp: 'ret', esr: 'rb' };   // sentido em que cada ângulo cresce
const rPat = a => 0.047 - 0.012 * lim((a.joe - 45) / 75, 0, 1);   // braço de momento do tendão patelar: maior entre 20° e 60°
// unidades musculares: [articulação, função, braço de momento (m, fixo ou pelo ângulo)]; a = área de secção fisiológica (cm², por lado; na coluna, os dois lados)
const US = {
  glu: { n: 'Glúteo máximo', cor: '#ff5d73', b: ['Gluteus maximus muscle'], a: 34, ac: [['qua', 'ext', a => 0.075 - 0.025 * lim(a.qua / 100, 0, 1)]] },
  adm: { n: 'Adutor magno', cor: '#c084fc', b: ['Adductor magnus'], a: 20, ac: [['qua', 'ext', a => 0.02 + 0.04 * lim(a.qua / 90, 0, 1)]] },
  isq: { n: 'Isquiotibiais', cor: '#4dabf7', b: ['Long head of biceps femoris', 'Semitendinosus muscle', 'Semimembranosus muscle'], a: 34, ac: [['qua', 'ext', a => 0.065 - 0.015 * lim(a.qua / 100, 0, 1)], ['joe', 'flex', 0.03]] },
  vas: { n: 'Vastos (quadríceps)', cor: '#ff9f43', b: ['Vastus lateralis muscle', 'Vastus medialis muscle', 'Vastus intermedius muscle'], a: 72, ac: [['joe', 'ext', rPat]] },
  rf: { n: 'Reto femoral', cor: '#ffd43b', b: ['Rectus femoris muscle'], a: 13.5, ac: [['joe', 'ext', rPat], ['qua', 'flex', 0.04]] },
  sol: { n: 'Sóleo', cor: '#94d82d', b: ['Soleus muscle'], a: 52, ac: [['tor', 'pf', 0.05]] },
  gas: { n: 'Gastrocnêmio', cor: '#b2f2bb', b: ['Medial head of gastrocnemius', 'Lateral head of gastrocnemius'], a: 31, ac: [['tor', 'pf', 0.05], ['joe', 'flex', 0.02]] },
  tib: { n: 'Tibial anterior', cor: '#63e6be', b: ['Tibialis anterior muscle'], a: 11, ac: [['tor', 'df', 0.04]] },
  ere: { n: 'Eretores da espinha', cor: '#e599f7', b: ['Iliocostalis lumborum muscle', 'Longissimus thoracis muscle', 'Iliocostalis thoracis muscle', 'Spinalis thoracis muscle'], a: 60, ac: [['lom', 'ext', 0.06]] },
  mul: { n: 'Multífidos', cor: '#b197fc', b: ['Multifidus lumborum muscle', 'Multifidus thoracis muscle'], a: 24, ac: [['lom', 'ext', 0.05]] },
  lat: { n: 'Latíssimo do dorso', cor: '#4dabf7', b: ['Latissimus dorsi muscle'], th: true, a: 13, ac: [['omb', 'ext', a => 0.028 + 0.012 * sen(a.omb)], ['oma', 'adu', a => 0.02 + 0.02 * sen(a.oma)]] },
  trm: { n: 'Redondo maior', cor: '#74c0fc', b: ['Teres major muscle'], a: 9, ac: [['omb', 'ext', 0.028], ['oma', 'adu', 0.035]] },
  pes: { n: 'Peitoral maior (parte esternocostal)', cor: '#f783ac', th: true, b: ['Sternocostal head of pectoralis major muscle', '(Abdominal part of pectoralis major muscle)'], a: 13, ac: [['oma', 'adu', a => 0.018 + 0.02 * sen(a.oma)], ['omb', 'ext', a => 0.03 * lim((a.omb - 50) / 70, 0, 1)]] },
  dep: { n: 'Deltoide (parte espinal)', cor: '#a5d8ff', b: ['Scapular spinal part of deltoid muscle'], a: 9, ac: [['omb', 'ext', a => 0.022 + 0.012 * (1 - lim(a.omb / 90, 0, 1))], ['oma', 'adu', 0.008]] },
  trl: { n: 'Tríceps (cabeça longa)', cor: '#99e9f2', b: ['Long head of triceps brachii'], a: 7, ac: [['omb', 'ext', 0.02], ['cot', 'ext', 0.02], ['oma', 'adu', 0.02]] },
  dea: { n: 'Deltoide (parte clavicular)', cor: '#ffc078', b: ['Clavicular part of deltoid muscle', 'Clavicular head of pectoralis major muscle'], a: 14, ac: [['omb', 'flex', 0.025]] },
  bic: { n: 'Bíceps braquial', cor: '#ff8fa3', b: ['Long head of biceps brachii', 'Short head of biceps brachii'], a: 4.6, ac: [['cot', 'flex', (a, o) => (0.018 + 0.022 * sen(a.cot)) * (o.pegada === 'pronada' ? 0.8 : o.pegada === 'triangulo' ? 0.92 : 1)]] },
  bra: { n: 'Braquial', cor: '#ff9f43', b: ['Brachialis muscle'], a: 7, ac: [['cot', 'flex', a => 0.011 + 0.011 * sen(a.cot)]] },
  dem: { n: 'Deltoide (parte acromial) e supraespinal', cor: '#ffe066', b: ['Acromial part of deltoid muscle', 'Supraspinatus muscle'], a: 18, ac: [['oma', 'abd', 0.025]] },
  rab: { n: 'Reto do abdômen', cor: '#63e6be', b: ['Rectus abdominis muscle'], a: 11, ac: [['lom', 'flex', 0.09]] },
  obl: { n: 'Oblíquos do abdômen', cor: '#96f2d7', b: ['External abdominal oblique muscle', 'Internal abdominal oblique muscle'], a: 50, ac: [['lom', 'flex', 0.04]] },
  ilp: { n: 'Iliopsoas', cor: '#ffc9c9', b: ['Iliopsoas muscle'], a: 20, ac: [['qua', 'flex', 0.04]] },
  // cintura escapular: braços de momento aproximados em torno da esternoclavicular (elevação, protração) e do eixo de rotação da escápula
  tri: { n: 'Trapézio (parte ascendente)', cor: '#ffa94d', aprox: true, b: ['Ascending part of trapezius muscle'], a: 5, ac: [['ese', 'dep', 0.04], ['esp', 'ret', 0.025], ['esr', 'rc', 0.03]] },
  trt: { n: 'Trapézio (parte transversa)', cor: '#69db7c', aprox: true, b: ['Transverse part of trapezius muscle'], a: 6, ac: [['esp', 'ret', 0.05]] },
  trd: { n: 'Trapézio (parte descendente)', cor: '#ffd8a8', aprox: true, b: ['Descending part of trapezius muscle'], a: 4, ac: [['ese', 'elev', 0.045], ['esr', 'rc', 0.04]] },
  rom: { n: 'Romboides', cor: '#da77f2', aprox: true, b: ['Rhomboid major muscle', 'Rhomboid minor muscle'], a: 6, ac: [['esp', 'ret', 0.04], ['esr', 'rb', 0.04], ['ese', 'elev', 0.02]] },
  pmi: { n: 'Peitoral menor', cor: '#f783ac', aprox: true, b: ['Pectoralis minor muscle'], a: 3.7, ac: [['ese', 'dep', 0.035], ['esr', 'rb', 0.035], ['esp', 'pro', 0.03]] },
  lev: { n: 'Levantador da escápula', cor: '#e599f7', aprox: true, b: ['Levator scapulae'], a: 2.8, ac: [['esr', 'rb', 0.03], ['ese', 'elev', 0.04]] },
  ser: { n: 'Serrátil anterior', cor: '#8ce99a', aprox: true, b: ['Serratus anterior muscle'], a: 13, ac: [['esp', 'pro', 0.05], ['esr', 'rc', 0.05]] },
  brr: { n: 'Braquiorradial', cor: '#ffd43b', b: ['Brachioradialis muscle'], a: 1.5, ac: [['cot', 'flex', (a, o) => (0.03 + 0.03 * sen(a.cot)) * (o.pegada === 'supinada' ? 0.85 : 1)]] },
};
const rU = (r, a, o) => typeof r === 'function' ? r(a, o) : r;
// joelho ou cotovelo estendidos com a carga tendendo a estender mais: quem segura são os ligamentos e o encaixe dos ossos
const simTravado = (j, t, ang) => (j === 'joe' && t > 0 && ang.joe < 8) || (j === 'cot' && t < 0 && ang.cot < 8);
function simSigMax(j, fun, op) {   // tensão máxima do grupo: torque máximo de referência dividido pela soma de (braço de momento × área) dos músculos do grupo (todos, não só os do exercício)
  const [T, ref] = TMAX[j + '.' + fun] || [100, {}], a = { qua: 0, joe: 0, tor: 0, lom: 0, omb: 0, cot: 0, oma: 0, ese: 0, esp: 0, esr: 0, ...ref };
  let s = 0; for (const u of Object.values(US)) for (const [jj, f, r] of u.ac) if (jj === j && f === fun) s += rU(r, a, op) * u.a;
  return s ? T * Math.pow(op.massa / 75, 0.67) / s : 1;
}
function simEsforco(tau, ang, op, uns) {   // divisão do momento que minimiza a soma das tensões ao quadrado (Crowninshield e Brand)
  const ef = {}; for (const id of uns) ef[id] = { p: 0, F: 0, j: null };
  for (const [j, t] of Object.entries(tau)) {
    const M = Math.abs(t); if (M < 0.05 || simTravado(j, t, ang)) continue;
    const fun = (t >= 0 ? JS[j].pos : JS[j].neg)[0], ag = [], smax = simSigMax(j, fun, op);
    for (const id of uns) for (const [jj, f, r] of US[id].ac) if (jj === j && f === fun) ag.push([id, rU(r, ang, op)]);
    const den = ag.reduce((s, [id, r]) => s + r * r * US[id].a, 0); if (!den) continue;
    for (const [id, r] of ag) { const sig = M * r / den, p = sig / smax * 100; if (p > ef[id].p) ef[id] = { p, F: sig * US[id].a, j }; }
  }
  return ef;
}
function simComp(ang, op, id) {   // variação do comprimento do músculo em relação à posição anatômica (cm): soma de braço de momento × ângulo
  let d = 0;
  for (const [j, f, r] of US[id].ac) {
    const th = ang[j] || 0, n = 10; let s = 0;
    for (let i = 0; i < n; i++) s += rU(r, { ...ang, [j]: th * (i + 0.5) / n }, op) * th / n * RS;
    d += (f === ANG_POS[j] ? -1 : 1) * s;
  }
  return d * 100;
}

// ----- geometria no plano sagital (y para cima, z para a frente), a partir do modelo em pé -----
const rot2 = (p, c, a) => { const dy = p.y - c.y, dz = p.z - c.z, co = Math.cos(a * RS), si = Math.sin(a * RS); return { y: c.y + dy * co - dz * si, z: c.z + dy * si + dz * co }; };
const mv2 = (p, d) => ({ y: p.y + d.y, z: p.z + d.z }), sub2 = (a, b) => ({ y: a.y - b.y, z: a.z - b.z }), lerp2 = (a, b, t) => ({ y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const SIM = { on: false, ex: 'agachamento', op: null, tab: null, k: 0, base: null, g: null, cmp: null, lado: 'A', graf: 'tor', B: {} };
function simBase() {   // pontos do corpo em pé (lado direito), uma vez
  if (SIM.base) return SIM.base;
  const S = POSE.S, p = v => ({ y: v.y, z: v.z }), Hm = S.H.d.clone().add(S.H.e).multiplyScalar(0.5), L5 = S.piv[0];
  const orelha = S.mk.ore_d.r.clone().add(S.mk.ore_e.r).multiplyScalar(0.5);
  const B = { A: p(S.A.d), K: p(S.K.d), H: p(Hm), Sm: p(S.Sm), Sh: p(S.Hh.d), L5: p(L5), meioPe: S.A.d.z + 0.04, chao: S.chao,
    pelve: p(Hm.clone().lerp(L5, 0.5)), tronco: p(L5.clone().lerp(S.Sm, 0.45)), cabeca: p(orelha),
    Lu: S.Hh.d.distanceTo(S.Co.d), Lf: S.Co.d.distanceTo(S.Wr.d) + 0.075, La: S.Co.d.distanceTo(S.Wr.d) };
  return (SIM.base = B);
}
// pernas: canela inclina s, coxa inclina t (joelho = s + t); tronco rígido inclina u em volta do quadril
function cadeia(s, t, u) {
  const B = SIM.base, K = rot2(B.K, B.A, s), H = rot2(mv2(B.H, sub2(K, B.K)), K, -t), T = P => rot2(mv2(P, sub2(H, B.H)), H, u);
  return { K, H, T };
}
function zcm(c, m, extra) {   // centro de massa (z) do corpo e da carga; extra: [[massa, z], ...]
  const B = SIM.base, mb = m.massa;
  let s = 2 * MW.pe * mb * (B.A.z + 0.05) + 2 * MW.perna * mb * lerp2(c.K, B.A, 0.433).z + 2 * MW.coxa * mb * lerp2(c.H, c.K, 0.433).z
    + MW.pelve * mb * c.T(B.pelve).z + MW.tronco * mb * c.T(B.tronco).z + MW.cabeca * mb * c.T(B.cabeca).z, mt = (2 * (MW.pe + MW.perna + MW.coxa) + MW.pelve + MW.tronco + MW.cabeca) * mb;
  for (const [mm, z] of extra) { s += mm * z; mt += mm; }
  return s / mt;
}
const bissec = (f, alvo, lo, hi) => { for (let i = 0; i < 36; i++) { const m = (lo + hi) / 2; f(m) > alvo ? (hi = m) : (lo = m); } return (lo + hi) / 2; };

// ----- exercícios -----
// braços segurando a barra nas costas ou na frente (ângulos com o tronco na vertical; no agachamento, o ombro acompanha a inclinação do tronco)
const BRACOS_S = {
  alta: { ombF: 12, ombA: 24, ombR: -78, cot: 128, pron: -19, punF: 4, pega: 0.9 },
  baixa: { ombF: 17, ombA: 15, ombR: -81, cot: 125, pron: -39, punF: -24, pega: 0.9 },
  frontal: { ombF: 60, ombA: 0, ombR: -18, cot: 158, pron: -85, punF: -87, pega: 0.45 },
};
// quanto da dorsiflexão disponível cada estilo usa: na barra baixa a canela fica mais vertical e o quadril vai mais para trás; na frontal o joelho avança até o limite
const CANELA_S = { alta: 0.85, baixa: 0.65, frontal: 1 };
const EX_S = {
  agachamento: {
    nome: 'Agachamento livre', curto: 'Agachamento', grupo: 'Membros inferiores',
    vars: [['alta', 'Barra alta'], ['baixa', 'Barra baixa'], ['frontal', 'Frontal']], chave: 'v',
    op0: { v: 'alta', carga: 60, massa: 75, mob: 35, prof: 115 },
    ctl: [['carga', 'Carga na barra', 0, 200, 5, 'kg'], ['prof', 'Profundidade (flexão máxima do joelho)', 60, 130, 5, '°'], ['mob', 'Mobilidade do tornozelo (dorsiflexão máxima)', 10, 45, 1, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['qua', 'joe', 'tor', 'lom'], un: ['glu', 'adm', 'isq', 'vas', 'rf', 'sol', 'gas', 'ere', 'mul'],
    est: ['Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle', 'Transversus abdominis muscle', 'Gluteus medius muscle'],
    estT: 'Abdômen, oblíquos e transverso seguram a coluna (pressão dentro do abdômen); o glúteo médio mantém os joelhos alinhados com os pés.',
    x: ['flexão do joelho', a => a.joe], dur: 3000,
    barra0(op) { const B = SIM.base, [, dy, dz] = BARRAS[op.v]; return { y: B.Sm.y + dy, z: B.Sm.z + dz }; },
    pose(k, op) {
      const B = simBase(), kn = op.prof * k, s = Math.min(op.mob * CANELA_S[op.v], BARRAS[op.v][3] * kn), t = kn - s, b0 = this.barra0(op), br = SIM.B[op.v] || { y: B.Sm.y - 0.12, z: B.Sm.z + 0.02 };
      const c = u => cadeia(s, t, u), z = u => { const q = c(u); return zcm(q, op, [[op.carga, q.T(b0).z], [MW.braco * 2 * op.massa + 2 * (MW.antebraco + MW.mao) * op.massa, q.T(br).z]]); };
      const u = bissec(z, B.meioPe, -15, 85), A = BRACOS_S[op.v];
      const L = { qF: t + u, joe: kn, df: s, ...A, ombF: A.ombF - u };   // no motor, os ângulos do ombro são em relação ao chão: o braço acompanha o tronco
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -0.4 * u, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: A.ombF, cot: A.cot }, info: { s, t, u, kn } };
    },
    tiles: (p) => [['Joelho · flexão', p.info.kn], ['Quadril · flexão', p.ang.qua], ['Tornozelo · dorsiflexão', p.info.s], ['Tronco · inclinação', p.info.u]],
  },
  remada: {
    nome: 'Remada curvada com barra', curto: 'Remada curvada', grupo: 'Costas', barMao: true,
    vars: [['pronada', 'Pegada pronada'], ['supinada', 'Pegada supinada']], chave: 'pegada',
    op0: { pegada: 'pronada', carga: 50, massa: 75, tronco: 45 },
    ctl: [['carga', 'Carga na barra', 0, 160, 5, 'kg'], ['tronco', 'Inclinação do tronco (0° = em pé, 90° = paralelo ao chão)', 20, 90, 5, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['omb', 'cot', 'lom', 'qua'], un: ['lat', 'trm', 'dep', 'trl', 'bic', 'bra', 'brr', 'ere', 'mul', 'glu', 'isq', 'adm'],
    est: ['Transverse part of trapezius muscle', 'Rhomboid major muscle', 'Rhomboid minor muscle', 'Ascending part of trapezius muscle', 'Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle'],
    estT: 'Trapézio médio e inferior e romboides puxam a escápula para trás no fim da puxada (retração, no plano transverso: fora da conta de torque). O abdômen segura a coluna.',
    x: ['flexão do cotovelo', a => a.cot], dur: 2400,
    // braço no plano sagital: úmero inclina beta para trás (em relação à vertical) e o antebraço fica quase na vertical (fi = inclinação à frente)
    braco(beta, fi, q) {
      const B = SIM.base, el = { y: q.Sh.y - B.Lu * Math.cos(beta * RS), z: q.Sh.z - B.Lu * Math.sin(beta * RS) }, dir = { y: -Math.cos(fi * RS), z: Math.sin(fi * RS) };
      return { el, g: { y: el.y + B.Lf * dir.y, z: el.z + B.Lf * dir.z }, ca: { y: el.y + 0.43 * B.La * dir.y, z: el.z + 0.43 * B.La * dir.z }, cb: { y: q.Sh.y - 0.436 * B.Lu * Math.cos(beta * RS), z: q.Sh.z - 0.436 * B.Lu * Math.sin(beta * RS) } };
    },
    repouso(op) {   // no modelo em pé, o antebraço já fica um pouco à frente (cotovelo levemente fletido): medido uma vez para cada pegada
      const ch = op.pegada; if (SIM.ant && SIM.ant[ch] != null) return SIM.ant[ch];
      const L = this.bracos(op, 0, 0), p = { L: { d: L, e: { ...L } }, c: {} }, S = POSE.S;
      const [f] = POSE.medir([simDef(p)], M => { const e = S.Co.d.clone().applyMatrix4(M.umerod), g = S.Wr.d.clone().add(_gp).applyMatrix4(M.maod); return Math.atan2(g.z - e.z, e.y - g.y) / RS; });
      return ((SIM.ant = SIM.ant || {})[ch] = f);
    },
    bracos: (op, beta, cot) => { const pr = op.pegada === 'pronada'; return { ombF: -beta, ombA: pr ? 22 : 10, ombR: pr ? 8 : -8, cot, pron: pr ? 80 : -85, punF: 0, pega: 0.9 }; },
    pose(k, op) {
      const B = simBase(), u = op.tronco, mb = op.massa, s = 4, f0 = this.repouso(op), ch = [op.tronco, op.pegada].join('|');
      const q0 = cadeia(s, 0, u), Sh0 = q0.T(B.Sh), n = { y: -Math.sin(u * RS), z: Math.cos(u * RS) };
      if (SIM.rem !== ch) {
        // início: braço pendurado com a barra embaixo do ombro; fim: a barra encosta no abdômen (cerca de 13 cm à frente da linha quadril–ombro) com o antebraço quase vertical
        let lo = 0, hi = 30; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, a = this.braco(m, f0 - m, { Sh: Sh0 }); a.g.z < Sh0.z ? (hi = m) : (lo = m); } const b0 = lo;
        const dist = b => { const a = this.braco(b, 10, { Sh: Sh0 }); return (a.g.y - q0.H.y) * n.y + (a.g.z - q0.H.z) * n.z; };
        lo = b0; hi = 110; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; dist(m) > 0.13 ? (lo = m) : (hi = m); }
        SIM.rem = ch; SIM.remIni = b0; SIM.remFim = lo;
      }
      const e = k, beta = SIM.remIni + (SIM.remFim - SIM.remIni) * e, F0 = f0 - SIM.remIni, fi = F0 + (10 - F0) * e, cot = Math.max(0, fi - f0 + beta);
      // a canela fica quase vertical; o quadril vai para trás o quanto for preciso para o centro de massa (corpo + barra) ficar sobre o meio do pé
      const z = t => { const q = cadeia(s, t, u), a = this.braco(beta, fi, { Sh: q.T(B.Sh) }); return -zcm(q, op, [[op.carga, a.g.z], [2 * MW.braco * mb, a.cb.z], [2 * MW.antebraco * mb, a.ca.z], [2 * MW.mao * mb, a.g.z]]); };
      const t = bissec(z, -B.meioPe, -10, 80), kn = s + t;
      const L = { qF: t + u, joe: kn, df: s, ...this.bracos(op, beta, cot), escProt: 6 - 22 * e };
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -12, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: u - beta, cot }, info: { s, t, u, kn, beta } };
    },
    tiles: (p) => [['Cotovelo · flexão', p.ang.cot], [p.ang.omb >= 0 ? 'Ombro · flexão (em relação ao tronco)' : 'Ombro · extensão (em relação ao tronco)', Math.abs(p.ang.omb)], ['Tronco · inclinação', p.info.u], ['Quadril · flexão', p.ang.qua], ['Joelho · flexão', p.ang.joe]],
  },
  puxada: {
    nome: 'Puxada alta no pulley', curto: 'Puxada', grupo: 'Costas', cabo: true, quadro: 'alto',
    vars: [['pronada', 'Aberta pronada'], ['supinada', 'Supinada'], ['triangulo', 'Triângulo']], chave: 'pegada',
    op0: { pegada: 'pronada', carga: 50, massa: 75, tronco: 15, lat: 0, latModo: 'auto' },
    ctl: [['carga', 'Carga no aparelho', 0, 150, 5, 'kg'], ['tronco', 'Inclinação do tronco para trás', 5, 35, 5, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg'], ['lat', 'Força lateral das mãos na barra (− para dentro, + para fora)', -60, 60, 5, '% da força do cabo']],
    jun: ['oma', 'omb', 'cot', 'lom', 'qua'], junE: ['ese', 'esr', 'esp'], un: ['lat', 'trm', 'pes', 'dep', 'trl', 'dem', 'bic', 'bra', 'brr', 'rab', 'obl', 'ilp', 'rf', 'ere', 'glu', 'tri', 'pmi', 'rom', 'lev', 'trt', 'trd', 'ser'],
    troncoU: op => -op.tronco,
    jn: { omb: 'Ombro (plano sagital)' },
    est: [], estT: '',
    x: ['flexão do cotovelo', a => a.cot], dur: 2600,
    vista: op => PUX_V[op.pegada].vista,
    pose(k, op) {
      const c = puxPrep(op), v = PUX_V[op.pegada], u = -op.tronco, e = lim(k, 0, 1);
      const Sw = puxInterp(c.Stab, e), alvo = c.topo.clone().lerp(c.fundo, e), r = puxBraco(c, Sw, alvo, e);
      const L = { qF: 90 + u, joe: 90, df: 0, ombF: r.F, ombA: r.A, ombR: r.R, cot: r.cot, pron: v.pron(e), punF: v.punF, punD: v.punD || 0, pega: 0.9, escProt: -9 * e, escElev: -6 * e };
      // ângulos do braço em relação ao tronco: elevação total, dividida entre o plano sagital (flexão) e o frontal (abdução)
      const h = r.dh.clone().applyAxisAngle(_ex, -u * RS), b = Math.acos(lim(-h.y, -1, 1)) / RS, hp = Math.hypot(h.x, h.z) || 1;
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -0.35 * u - 8, tF: 0, lF: 0 }, ang: { qua: 90 + u, joe: 90, tor: 0, lom: 0, omb: b * h.z / hp, oma: b * Math.abs(h.x) / hp, cot: r.cot, ese: 0, esp: 0, esr: 0 }, info: { u, b, alvo } };
    },
    polia(op) { return puxPrep(op).polia; },
    ler: `<p>No modelo, a <b style="color:#ffd43b">linha amarela</b> é o cabo: ele puxa a barra para cima, na direção da polia. A <b style="color:#ffd43b">linha tracejada</b> que passa pela mão mostra a força em cada mão: metade da carga do cabo, mais a força lateral que a mão faz na barra (ela inclina a linha).</p>
    <p>Cada articulação tem uma <b>alavanca colorida</b>: a linha que vai da articulação até a linha de força, pelo caminho mais curto. O comprimento dela é o <b>braço de momento</b>, e força × braço de momento é o <b>torque</b> que os músculos precisam vencer.</p>
    <p><b>Dois planos no ombro:</b> o torque do ombro é dividido em <b style="color:#f783ac">plano frontal</b> (a carga tende a abduzir o braço; trabalham os adutores) e <b style="color:#4dabf7">plano sagital</b> (a carga tende a flexionar o braço; trabalham os extensores). Com a pegada aberta, a mão fica longe do ombro para o lado e a adução ganha peso. Com a pegada fechada, a mão fica à frente do ombro e predomina a extensão. No modelo aparece a alavanca do plano que predomina.</p>
    <p><b>Força lateral na barra:</b> o cabo só define a força para cima. Como a barra é rígida, cada mão ainda pode empurrá-la para dentro ou puxá-la para fora, e uma mão anula a outra. Isso muda o torque do ombro e do cotovelo sem mudar a carga. Em <b>Automática</b>, o simulador escolhe a força lateral que deixa menor o esforço somado do ombro e do cotovelo. Em <b>Manual</b>, você escolhe: puxar a barra para fora aumenta o trabalho dos adutores do ombro, por exemplo.</p>
    <p><b>Tronco:</b> a lombar e o quadril recebem o peso do corpo acima deles e a tração dos dois lados do cabo. Com o tronco quase reto, o cabo passa à frente da coluna e o abdômen trabalha para o tronco não estender.</p>
    <p><b>Escápula (estimativa aproximada):</b> a carga do braço tende a elevar a escápula e a girá-la para cima. A conta mede esse efeito em torno da articulação esternoclavicular e do eixo de rotação da escápula, desconta a parte que o latíssimo e o peitoral levam direto do úmero para o tronco e divide o restante entre trapézio, romboides, peitoral menor, levantador e serrátil.</p>`,
    aviso: 'Na puxada, a pessoa fica sentada com o tronco parado no ângulo escolhido e a barra desce em linha reta na direção do cabo. A força externa é a tração do cabo (metade em cada mão), a força lateral das mãos na barra e o peso do próprio corpo. A força lateral automática é uma escolha do modelo (menor esforço do ombro e do cotovelo), limitada a 60% da força do cabo: na prática ela depende de como a pessoa puxa. No quadril, o assento apoia a pelve até o cabo vencer o peso do corpo; depois disso, quem segura é o rolo das coxas. Os números da escápula são os menos seguros do simulador: não existe medida direta de referência para esses músculos, e os braços de momento e a força máxima usados são aproximados. A rotação do ombro fica fora da conta.',
    tiles: (p) => [['Cotovelo · flexão', p.ang.cot], ['Braço · elevação em relação ao tronco', p.info.b], ['Ombro · abdução (plano frontal)', p.ang.oma], ['Ombro · flexão (plano sagital)', p.ang.omb]],
  },
};
// ----- levantamento terra, stiff / terra romeno e elevação pélvica -----
const fi2 = v => Math.atan2(v.z, v.y) / RS;   // ângulo de um vetor no plano sagital, de +y para +z (o mesmo sentido de rot2)
// braço reto pendurado do ombro até a pegada: ângulo do úmero em relação à vertical (para a frente +), como o motor espera
const bracoReto = (Sh, G) => Math.atan2(G.z - Sh.z, Sh.y - G.y) / RS;
function bracoIK(Sh, G) {   // ombro → cotovelo → pegada no plano sagital, com o cotovelo para baixo
  const B = SIM.base, a = B.Lu, b = B.Lf, v = sub2(G, Sh), d = lim(Math.hypot(v.y, v.z), 0.05, (a + b) * 0.995);
  const al = Math.acos(lim((a * a + d * d - b * b) / (2 * a * d), -1, 1)) / RS, be = Math.acos(lim((a * a + b * b - d * d) / (2 * a * b), -1, 1)) / RS;
  const fh = fi2(v) + al;   // úmero (ângulo de +y para +z); o antebraço volta 180° − be
  return { ombF: 180 - fh, cot: 180 - be };
}
// pés do aluno na elevação pélvica: inclinação da canela no topo (+ à frente)
const PES_P = { perto: 15, medio: 0, longe: -20 };
Object.assign(EX_S, {
  terra: {
    nome: 'Levantamento terra convencional', curto: 'Terra', grupo: 'Membros inferiores e costas', barMao: true,
    vars: [['meio', 'Barra sobre o meio do pé'], ['frente', 'Barra 5 cm à frente']], chave: 'barra',
    op0: { barra: 'meio', carga: 80, massa: 75, canela: 12 },
    ctl: [['carga', 'Carga na barra', 0, 260, 5, 'kg'], ['canela', 'Canela inclinada na saída (mais = quadril mais baixo)', 0, 25, 1, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['qua', 'joe', 'tor', 'lom'], un: ['glu', 'adm', 'isq', 'vas', 'rf', 'sol', 'gas', 'ere', 'mul'],
    est: ['Latissimus dorsi muscle', 'Descending part of trapezius muscle', 'Transverse part of trapezius muscle', 'Rhomboid major muscle', 'Rhomboid minor muscle', 'Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle'],
    estT: 'O latíssimo mantém a barra perto das pernas e o trapézio e os romboides seguram as escápulas. Abdômen e oblíquos seguram a coluna. A pegada fica com os flexores dos dedos.',
    x: ['flexão do quadril', a => a.qua], dur: 2800,
    pose(k, op) {
      const B = simBase(), e = lim(k, 0, 1), arm = B.Lu + B.Lf, bz = B.meioPe + (op.barra === 'frente' ? 0.05 : 0);
      // a barra sobe na vertical, do chão (anilha de 45 cm) até a pegada com o corpo em pé; o ombro começa um pouco à frente da barra e termina sobre o corpo em pé
      const y0 = B.chao + 0.225, yT = B.Sh.y - Math.sqrt(Math.max(0.01, arm * arm - (bz - B.Sh.z) ** 2)), yb = y0 + (yT - y0) * e;
      const off = 0.03 * (1 - e) + (B.Sh.z - bz) * e, Sz = bz + off, Sy = yb + Math.sqrt(Math.max(0.01, arm * arm - off * off));
      const s = op.canela * (1 - e), sh = (t, u) => cadeia(s, t, u).T(B.Sh);
      const uDe = t => bissec(u => sh(t, u).z, Sz, -20, 89), t = e > 0.999 ? 0 : bissec(t => -sh(t, uDe(t)).y, -Sy, 0, 130), u = e > 0.999 ? 0 : uDe(t), kn = s + t;   // a altura do ombro é máxima com o corpo reto: a busca começa em t = 0
      const Sh = sh(t, u), ombF = bracoReto(Sh, { y: yb, z: bz });
      const L = { qF: t + u, joe: kn, df: s, ombF, ombA: 8, ombR: 0, cot: 0, pron: 80, punF: 0, pega: 0.9 };
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -0.3 * u, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: ombF + u, cot: 0 }, info: { s, t, u, kn } };
    },
    tiles: (p) => [['Quadril · flexão', p.ang.qua], ['Joelho · flexão', p.info.kn], ['Tornozelo · dorsiflexão', p.info.s], ['Tronco · inclinação', p.info.u]],
    aviso: 'No terra, a barra sobe em linha reta, o braço fica estendido e o ombro começa cerca de 3 cm à frente da barra. A inclinação da canela na saída define a altura do quadril; o tronco e o quadril se ajustam para a pegada alcançar a barra. A barra à frente do meio do pé tira o corpo do equilíbrio: na prática ela tende a voltar para perto das pernas.',
  },
  stiff: {
    nome: 'Stiff e terra romeno', curto: 'Stiff', grupo: 'Membros inferiores', barMao: true,
    vars: [['stiff', 'Stiff (joelhos quase estendidos)'], ['romeno', 'Terra romeno (joelhos semiflexionados)']], chave: 'estilo',
    op0: { estilo: 'stiff', carga: 60, massa: 75, tronco: 75 },
    ctl: [['carga', 'Carga na barra', 0, 200, 5, 'kg'], ['tronco', 'Inclinação máxima do tronco (0° = em pé, 90° = paralelo ao chão)', 30, 95, 5, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['qua', 'joe', 'tor', 'lom'], un: ['glu', 'adm', 'isq', 'vas', 'rf', 'sol', 'gas', 'ere', 'mul'],
    est: ['Latissimus dorsi muscle', 'Descending part of trapezius muscle', 'Transverse part of trapezius muscle', 'Rhomboid major muscle', 'Rhomboid minor muscle', 'Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle'],
    estT: 'O latíssimo mantém a barra perto das pernas, o trapézio e os romboides seguram as escápulas e o abdômen segura a coluna.',
    x: ['flexão do quadril', a => a.qua], dur: 2800,
    pose(k, op) {
      const B = simBase(), e = lim(k, 0, 1), kmax = op.estilo === 'romeno' ? 22 : 6, kn = kmax * (0.3 + 0.7 * e), u = op.tronco * e, mb = op.massa, arm = B.Lu + B.Lf;
      // braço estendido; a barra desliza encostada na frente da coxa e da canela (o latíssimo a puxa para trás). O quadril vai para trás o quanto for preciso para o centro de massa (corpo + barra) ficar sobre o meio do pé
      const barra = q => { const Sh = q.T(B.Sh), fr = y => { const [P0, P1, of] = y >= q.K.y ? [q.K, q.H, 0.11] : [B.A, q.K, 0.08], f = lim((y - P0.y) / (P1.y - P0.y || 1e-6), 0, 1); return P0.z + (P1.z - P0.z) * f + of; };
        const y = bissec(y => -Math.hypot(Sh.y - y, Sh.z - fr(y)), -arm, B.chao + 0.25, Sh.y - 0.2); return { Sh, g: { y, z: fr(y) } }; };
      const z = sv => { const q = cadeia(sv, kn - sv, u), r = barra(q); return zcm(q, op, [[op.carga, r.g.z], [2 * MW.braco * mb, lerp2(r.Sh, r.g, 0.25).z], [2 * (MW.antebraco + MW.mao) * mb, lerp2(r.Sh, r.g, 0.75).z]]); };
      const s = bissec(z, B.meioPe, -25, 40), t = kn - s, r = barra(cadeia(s, t, u)), ombF = bracoReto(r.Sh, r.g);
      const L = { qF: t + u, joe: kn, df: s, ombF, ombA: 8, ombR: 0, cot: 0, pron: 80, punF: 0, pega: 0.9 };
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -0.3 * u, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: ombF + u, cot: 0 }, info: { s, t, u, kn } };
    },
    tiles: (p) => [['Quadril · flexão', p.ang.qua], ['Tronco · inclinação', p.info.u], ['Joelho · flexão', p.info.kn], ['Tornozelo · dorsiflexão', p.info.s]],
    aviso: 'No stiff e no terra romeno, o tronco desce até a inclinação escolhida com a coluna neutra, os braços ficam estendidos e o quadril vai para trás para o centro de massa continuar sobre o meio do pé. No stiff o joelho fica quase estendido (cerca de 6°); no terra romeno ele flexiona até cerca de 22° na descida. A barra desce encostada na frente da coxa e da canela, com o braço estendido.',
  },
  bomdia: {
    nome: 'Good morning (bom-dia) com barra', curto: 'Good morning', grupo: 'Membros inferiores e costas',
    vars: [['reto', 'Joelhos quase estendidos'], ['flex', 'Joelhos semiflexionados']], chave: 'joelho',
    op0: { joelho: 'reto', carga: 40, massa: 75, tronco: 70 },
    ctl: [['carga', 'Carga na barra', 0, 160, 5, 'kg'], ['tronco', 'Inclinação máxima do tronco (0° = em pé, 90° = paralelo ao chão)', 30, 90, 5, '°'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['qua', 'joe', 'tor', 'lom'], un: ['glu', 'adm', 'isq', 'vas', 'rf', 'sol', 'gas', 'ere', 'mul'],
    est: ['Rectus abdominis muscle', 'External abdominal oblique muscle', 'Internal abdominal oblique muscle', 'Transversus abdominis muscle', 'Transverse part of trapezius muscle', 'Rhomboid major muscle'],
    estT: 'Abdômen, oblíquos e transverso seguram a coluna neutra. O trapézio e os romboides mantêm a barra firme sobre as costas.',
    x: ['flexão do quadril', a => a.qua], dur: 2800,
    barra0() { const B = SIM.base, [, dy, dz] = BARRAS.alta; return { y: B.Sm.y + dy, z: B.Sm.z + dz }; },
    pose(k, op) {
      const B = simBase(), e = lim(k, 0, 1), kn = (op.joelho === 'flex' ? 25 : 8) * (0.3 + 0.7 * e), u = op.tronco * e, b0 = this.barra0(op), br = SIM.B.alta || { y: B.Sm.y - 0.12, z: B.Sm.z + 0.02 };
      // a barra fica nas costas: quanto mais o tronco inclina, mais ela vai para a frente, e o quadril recua para o centro de massa continuar sobre o meio do pé
      const z = sv => { const q = cadeia(sv, kn - sv, u); return zcm(q, op, [[op.carga, q.T(b0).z], [MW.braco * 2 * op.massa + 2 * (MW.antebraco + MW.mao) * op.massa, q.T(br).z]]); };
      const s = bissec(z, B.meioPe, -30, 40), t = kn - s, A = BRACOS_S.alta;
      const L = { qF: t + u, joe: kn, df: s, ...A, ombF: A.ombF - u };
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: -0.4 * u, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: A.ombF, cot: A.cot }, info: { s, t, u, kn } };
    },
    tiles: (p) => [['Quadril · flexão', p.ang.qua], ['Tronco · inclinação', p.info.u], ['Joelho · flexão', p.info.kn], ['Tornozelo · dorsiflexão', p.info.s]],
    aviso: 'No good morning, a barra fica apoiada no trapézio (barra alta) e o tronco desce até a inclinação escolhida com a coluna neutra. O quadril vai para trás para o centro de massa continuar sobre o meio do pé. Como a barra está longe do quadril, pouca carga já gera muito torque no quadril e na lombar.',
  },
  pelvica: {
    nome: 'Elevação pélvica com barra (hip thrust)', curto: 'Elevação pélvica', grupo: 'Membros inferiores', barraSeg: 'pelve', semCM: true, quadro: 'deitado',
    vars: [['perto', 'Pés perto do banco'], ['medio', 'Canela vertical no topo'], ['longe', 'Pés longe do banco']], chave: 'pes',
    op0: { pes: 'medio', carga: 80, massa: 75, desc: 25 },
    ctl: [['carga', 'Carga na barra', 0, 250, 5, 'kg'], ['desc', 'Amplitude (quanto o quadril desce)', 10, 35, 1, 'cm'], ['massa', 'Massa corporal', 40, 140, 1, 'kg']],
    jun: ['qua', 'joe', 'lom'], un: ['glu', 'adm', 'isq', 'vas', 'rf', 'ere', 'mul', 'rab', 'obl'],
    est: ['Gluteus medius muscle', 'Gluteus minimus muscle', 'Transversus abdominis muscle'],
    estT: 'Glúteo médio e mínimo mantêm os joelhos alinhados com os pés. Abdômen e transverso seguram a pelve e as costelas para a extensão vir do quadril, não da lombar.',
    x: ['flexão do quadril', a => a.qua], dur: 2400,
    banco: () => ({ y: SIM.base.Sh.y - 0.08, z: SIM.base.Sh.z - 0.1 }),   // ponto das costas que apoia no banco (na altura das escápulas), no corpo em pé
    barra0: () => ({ y: SIM.base.H.y + 0.04, z: SIM.base.H.z + 0.14 }),   // a barra fica sobre a dobra do quadril, com a proteção
    topo(op) {   // no topo: coxa e tronco em linha, na horizontal; a canela inclina conforme a posição dos pés
      const B = simBase(), s = PES_P[op.pes], q = cadeia(s, 90, -90), C = q.T(this.banco());
      return { s, q, C, A: B.A, H: q.H };
    },
    pose(k, op) {
      const B = simBase(), tp = this.topo(op), e = lim(k, 0, 1), C = tp.C, Cs = this.banco();
      // o tronco gira em volta do ponto de apoio no banco e os pés ficam parados: o quadril desce até "desc" cm abaixo do topo
      const rHC = Math.hypot(Cs.y - B.H.y, Cs.z - B.H.z), yH = tp.H.y - op.desc / 100 * (1 - e);
      const H = { y: yH, z: C.z + Math.sqrt(Math.max(0, rHC * rHC - (yH - C.y) ** 2)) };
      const Ls = Math.hypot(B.K.y - B.A.y, B.K.z - B.A.z), Lt = Math.hypot(B.H.y - B.K.y, B.H.z - B.K.z), A = B.A;
      const dAH = Math.hypot(H.y - A.y, H.z - A.z), a = (Ls * Ls - Lt * Lt + dAH * dAH) / (2 * dAH), hh = Math.sqrt(Math.max(0, Ls * Ls - a * a));
      const ux = (H.z - A.z) / dAH, uy = (H.y - A.y) / dAH, K1 = { y: A.y + a * uy + hh * ux, z: A.z + a * ux - hh * uy }, K2 = { y: A.y + a * uy - hh * ux, z: A.z + a * ux + hh * uy }, K = K1.y > K2.y ? K1 : K2;
      const s = fi2(sub2(K, A)) - fi2(sub2(B.K, B.A)), t = -(fi2(sub2(H, K)) - fi2(sub2(B.H, B.K))), u = fi2(sub2(C, H)) - fi2(sub2(Cs, B.H)), kn = s + t;
      const q = cadeia(s, t, u), Sh = q.T(B.Sh), bar = q.T(this.barra0()), br = bracoIK(Sh, { y: bar.y + 0.01, z: bar.z - 0.01 });
      const L = { qF: t + u, joe: kn, df: s, ombF: br.ombF, ombA: 14, ombR: 0, cot: br.cot, pron: 80, punF: 0, pega: 0.9 };
      return { L: { d: L, e: { ...L } }, c: { pA: u, cF: 14, tF: 0, lF: 0 }, ang: { qua: t + u, joe: kn, tor: s, lom: 0, omb: br.ombF + u, cot: br.cot }, info: { s, t, u, kn, C } };
    },
    tiles: (p) => [['Quadril · flexão', p.ang.qua], ['Joelho · flexão', p.info.kn], ['Tronco · inclinação (para trás)', -p.info.u]],
    ler: `<p>No modelo, a <b style="color:#ffd43b">linha amarela</b> desce da barra até o chão. O <b>banco</b> apoia a parte de cima das costas e o chão apoia os pés: as duas forças, mais o peso do corpo e da barra, ficam em equilíbrio.</p>
    <p>Cada articulação tem uma <b>alavanca colorida</b>: a linha que vai da articulação até a linha vertical da força que age acima dela (peso, barra e o apoio do banco). O comprimento dessa linha é o <b>braço de momento</b>, e força × braço de momento é o <b>torque</b> que os músculos precisam vencer. Quando a seta aponta para cima, quem empurra é o banco.</p>
    <p><b>Posição dos pés:</b> com os pés perto do banco, a força do chão passa mais à frente do joelho e o quadríceps trabalha mais. Com os pés longe, o joelho fica mais estendido e a força passa atrás dele: os isquiotibiais ajudam a estender o quadril e flexionam o joelho.</p>`,
    aviso: 'Na elevação pélvica, a parte de cima das costas fica apoiada na borda do banco (que não se mexe), os pés ficam parados no chão e a barra fica sobre a dobra do quadril. O apoio dos pés foi colocado logo à frente do tornozelo (calcanhar e meio do pé). O tornozelo fica fora da conta.',
  },
});
// ----- puxada: aparelho com cabo. A mão segue a linha do cabo; o braço é resolvido por cinemática inversa (ombro → cotovelo → mão) -----
// mao: meia distância entre as mãos (a partir da meia largura dos ombros); pron: pronação do antebraço ao longo do movimento, ajustada para os dedos ficarem alinhados com a barra; polo: para onde o cotovelo aponta; peito: onde a barra chega (em relação ao ombro, com o tronco na vertical)
const PUX_V = {
  pronada: { mao: sh => 2.1 * sh, pron: () => 48, punF: 0, punD: 8, polo: [1, -1, 0.1], peito: [0.035, 0.13], vista: 'post' },
  supinada: { mao: sh => 0.95 * sh, pron: k => -88 + 33 * k, punF: 0, punD: 20, polo: [0.3, -1, 0.55], peito: [0.035, 0.13], vista: 'pl' },
  triangulo: { mao: () => 0.075, pron: k => 45 * k * k, punF: 0, polo: [0.55, -1, 0.45], peito: [0.005, 0.13], vista: 'pl' },
};
const _ex = new THREE.Vector3(1, 0, 0), PUX_C = new Map();
const puxInterp = (T, e) => { const x = e * (T.length - 1), i = Math.min(T.length - 2, Math.floor(x)); return T[i].clone().lerp(T[i + 1], x - i); };
function puxMao(c, cot, e) {   // posição da pegada em relação ao ombro, no braço em repouso, para uma flexão do cotovelo
  return puxInterp(c.g0, e).sub(c.Co).applyAxisAngle(_ex, -cot * RS).add(c.Co).sub(c.Hh);
}
function puxBraco(c, Sw, alvo, e) {   // ângulos do ombro e do cotovelo que levam a pegada até o alvo
  const T = alvo.clone().sub(Sw), D = T.length();
  let lo = 6, hi = 150; if (puxMao(c, lo, e).length() <= D) hi = lo; else for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; puxMao(c, m, e).length() > D ? (lo = m) : (hi = m); }
  const cot = (lo + hi) / 2, pm = puxMao(c, cot, e);
  const base = (e1, ref) => { const a = e1.clone().normalize(), b = ref.clone().addScaledVector(a, -ref.dot(a)).normalize(), n = new THREE.Vector3().crossVectors(a, b); return new THREE.Matrix4().makeBasis(a, b, n); };
  const R = base(T, c.polo).multiply(base(pm, c.Co.clone().sub(c.Hh)).transpose());   // leva o braço em repouso (já com o cotovelo fletido) até o alvo, com o cotovelo virado para o polo
  const eu = new THREE.Euler().setFromRotationMatrix(R, 'XZY');   // o motor monta o ombro como rX(−flexão) · rZ(−lado·abdução) · rY(lado·rotação)
  return { cot, F: -eu.x / RS, A: -eu.z / RS / c.sg, R: eu.y / RS / c.sg, dh: c.Co.clone().sub(c.Hh).applyMatrix4(R).normalize() };
}
function puxPrep(op) {
  const ch = [op.pegada, op.tronco].join('|'); if (PUX_C.has(ch)) return PUX_C.get(ch);
  const B = simBase(), S = POSE.S, v = PUX_V[op.pegada], u = -op.tronco, sx = Math.sign(S.Hh.d.x) || 1, sh = Math.abs(S.Hh.d.x);
  const c = { sg: 1, Hh: S.Hh.d.clone(), Co: S.Co.d.clone(), polo: new THREE.Vector3(sx * v.polo[0], v.polo[1], v.polo[2]) };
  const ativo = S.ativo; S.ativo = false;   // as medidas abaixo não podem redesenhar a pose atual (ela chamaria esta função de novo)
  try {
  // pegada no braço em repouso (cotovelo estendido), com a pronação desta pegada: medida no modelo
  const n = 9, L0 = i => ({ ombF: 0, ombA: 0, ombR: 0, cot: 0, pron: v.pron(i / (n - 1)), punF: v.punF, punD: v.punD || 0, pega: 0.9 });
  c.g0 = POSE.medir(Array.from({ length: n }, (_, i) => simDef({ L: { d: L0(i), e: L0(i) }, c: {} })), M => S.Wr.d.clone().add(_gp).applyMatrix4(M.maod).applyMatrix4(M.umerod.clone().invert()));
  const q = cadeia(0, 90, u), Sr = q.T(B.Sh), pe = q.T({ y: B.Sh.y + v.peito[0], z: B.Sh.z + v.peito[1] }), hx = sx * v.mao(sh);
  c.q = q; c.fundo = new THREE.Vector3(hx, pe.y, pe.z);
  const S0 = new THREE.Vector3(S.Hh.d.x, Sr.y, Sr.z), alc = puxMao(c, 14, 0).length();
  const topoDe = Sw => new THREE.Vector3(hx, Sw.y + Math.sqrt(Math.max(0.01, alc * alc - (hx - Sw.x) ** 2 - (pe.z - Sw.z) ** 2)), pe.z);
  c.Stab = Array.from({ length: n }, () => S0.clone()); c.topo = topoDe(S0);
  c.polia = new THREE.Vector3(0, c.topo.y + 0.55, pe.z);
  PUX_C.set(ch, c);
  for (let it = 0; it < 3; it++) {   // o ombro sobe e desce com a escápula: mede onde ele fica de verdade e refaz
    const ps = c.Stab.map((_, i) => simDef(EX_S.puxada.pose(i / (n - 1), op)));
    c.Stab = POSE.medir(ps, M => S.Hh.d.clone().applyMatrix4(M.umerod)); c.topo = topoDe(c.Stab[0]);
  }
  } finally { S.ativo = ativo; }
  c.polia.y = c.topo.y + 0.55;
  return c;
}
const PROX_S = ['Remada baixa e cavalinho', 'Leg press', 'Cadeira extensora', 'Afundo', 'Supino'];
function simDef(p) { const d = defLivre({ d: p.L.d, e: p.L.e, c: p.c || {} }); d.mov.fixarPe = true; return d; }

// ----- medida no corpo 3D: centros de massa, momentos e braços de momento -----
const _gp = new THREE.Vector3(0, -0.065, 0.045);   // centro da pegada: dentro do gancho formado pelos dedos fechados
function simPts(M, bar, gd) {   // pontos do lado direito no plano sagital (para o desenho 2D da comparação)
  const S = POSE.S, P = (v, sg) => { const w = v.clone().applyMatrix4(M[sg] || M.pelve); return { y: w.y, z: w.z }; };
  const or = S.mk.ore_d.r.clone().add(S.mk.ore_e.r).multiplyScalar(0.5), L5 = S.piv[0];
  return { A: P(S.A.d, 'pernad'), T: P(S.MTP.d, 'ped'), Ca: P(S.A.d.clone().add(new THREE.Vector3(0, -0.045, -0.06)), 'ped'), K: P(S.K.d, 'pernad'), H: P(S.H.d, 'coxad'), L5: P(L5, 'pelve'), C7: P(S.piv[18] || S.Sm, 'v:Vertebra T1'),
    Sh: P(S.Hh.d, 'umerod'), E: P(S.Co.d, 'umerod'), G: { y: gd.y, z: gd.z }, ore: P(or, 'cabeca'), bar: { y: bar.y, z: bar.z }, chao: S.chao };
}
function simMedir(M, ex, op, ang) {
  const S = POSE.S, P = (v, sg) => v.clone().applyMatrix4(M[sg] || M.pelve), mb = op.massa;
  const Hm = S.H.d.clone().add(S.H.e).multiplyScalar(0.5), L5 = S.piv[0], or = S.mk.ore_d.r.clone().add(S.mk.ore_e.r).multiplyScalar(0.5);
  const pega = l => P(S.Wr[l].clone().add(_gp), 'mao' + l);
  const segs = [];   // [chave, massa (kg), ponto]
  for (const l of ['d', 'e']) segs.push(['pe', MW.pe * mb, P(S.A[l].clone().lerp(S.MTP[l], 0.45), 'pe' + l)], ['perna', MW.perna * mb, P(S.K[l].clone().lerp(S.A[l], 0.433), 'perna' + l)], ['coxa', MW.coxa * mb, P(S.H[l].clone().lerp(S.K[l], 0.433), 'coxa' + l)],
    ['braco' + l, MW.braco * mb, P(S.Hh[l].clone().lerp(S.Co[l], 0.436), 'umero' + l)], ['antebraco' + l, MW.antebraco * mb, P(S.Co[l].clone().lerp(S.Wr[l], 0.43), 'ulna' + l)], ['mao' + l, MW.mao * mb, pega(l)]);
  segs.push(['pelve', MW.pelve * mb, P(Hm.clone().lerp(L5, 0.5), 'pelve')], ['tronco', MW.tronco * mb, P(L5.clone().lerp(S.Sm, 0.45), 'v:Vertebra T12')], ['cabeca', MW.cabeca * mb, P(or, 'cabeca')]);
  const gd = pega('d'), ge = pega('e');
  if (ex.cabo) {   // a força externa é a tração do cabo na mão (metade da carga em cada mão, na direção da polia), mais a força lateral que a mão faz na barra e o peso do próprio braço
    const a = ang || ex.pose(POSE.S.k, op).ang, pol = ex.polia(op), bar = gd.clone().add(ge).multiplyScalar(0.5).setX(0), dir = pol.clone().sub(bar).normalize(), T = op.carga * G / 2, sx = Math.sign(S.Hh.d.x) || 1;
    const Sj = P(S.Hh.d, 'umerod'), Ej = P(S.Co.d, 'umerod'), peso = m => new THREE.Vector3(0, -m * mb * G, 0);
    const pesos = [[P(S.Co.d.clone().lerp(S.Wr.d, 0.43), 'ulnad'), peso(MW.antebraco), 1], [gd, peso(MW.mao), 1], [P(S.Hh.d.clone().lerp(S.Co.d, 0.436), 'umerod'), peso(MW.braco), 0]];
    const eixo = Ej.clone().sub(Sj).cross(gd.clone().sub(Ej)); eixo.lengthSq() > 1e-9 ? eixo.normalize() : eixo.set(1, 0, 0);
    // tronco: tudo o que fica acima de L5 (lombar) e acima do quadril, com o peso do corpo e a tração dos dois lados do cabo
    const L5w = P(L5, 'pelve'), Hw = P(S.H.d, 'coxad'), cima = segs.filter(([c]) => /^(tronco|cabeca|braco|antebraco|mao)/.test(c)), pel = segs.filter(([c]) => c === 'pelve');
    const sag = (J, lista, extra = []) => {   // momento no plano sagital e força resultante (y, z) sobre a articulação J
      let t = 0, Ry = 0, Rz = 0; for (const [, mm, pt] of lista) { t += G * mm * (pt.z - J.z); Ry -= G * mm; }
      for (const [pt, F] of extra) { t += (pt.y - J.y) * F.z - (pt.z - J.z) * F.y; Ry += F.y; Rz += F.z; }
      const R2 = Ry * Ry + Rz * Rz; return { t, R: Math.sqrt(R2), Q: R2 > 1600 ? new THREE.Vector3(J.x, J.y + Rz * t / R2, J.z - Ry * t / R2) : null, dir: new THREE.Vector3(0, Ry, Rz).normalize() };
    };
    const cabo2 = [bar, dir.clone().multiplyScalar(2 * T)], lomb = sag(L5w, cima, [cabo2]);
    const pesoCima = G * [...cima, ...pel].reduce((q, x) => q + x[1], 0), N = Math.max(0, pesoCima - 2 * T * dir.y);   // o assento só empurra a pelve para cima enquanto o cabo não levanta a pessoa (depois disso, quem segura é o rolo das coxas)
    const quad = sag(Hw, [...cima, ...pel], [cabo2, [new THREE.Vector3(0, Hw.y - 0.09, Hw.z - 0.04), new THREE.Vector3(0, N, 0)]]);
    // escápula (estimativa aproximada): momento da carga do braço em torno da esternoclavicular e do eixo de rotação da escápula, no referencial do tronco
    const uT = (ex.troncoU ? ex.troncoU(op) : 0) * RS, yT = new THREE.Vector3(0, Math.cos(uT), Math.sin(uT)), zT = new THREE.Vector3(0, -Math.sin(uT), Math.cos(uT));
    const SC = P(S.sc.d, 'v:Vertebra T1'), PR = P(S.pUR.d, 'escd'), aR = S.eUR.d.clone().transformDirection(M.escd);
    const fracao = (j, t) => {   // parte do torque do ombro que o latíssimo e o peitoral levam direto do úmero para o tronco, sem passar pela escápula
      const fun = (t >= 0 ? JS[j].pos : JS[j].neg)[0]; let den = 0, th = 0;
      for (const id of ex.un) for (const [jj, f, r] of US[id].ac) if (jj === j && f === fun) { const w = rU(r, a, op) ** 2 * US[id].a; den += w; if (US[id].th) th += w; }
      return den ? th / den : 0;
    };
    const calc = h => {
      const Fm = dir.clone().multiplyScalar(T); Fm.x -= h * sx;   // h > 0: a mão puxa a barra para fora, e a barra puxa a mão para dentro
      const fs = [[gd, Fm, 1], ...pesos], mom = (J, soAnte) => { const Mv = new THREE.Vector3(); for (const [pt, F, ante] of fs) if (!soAnte || ante) Mv.add(pt.clone().sub(J).cross(F)); return Mv; };
      const Mo = mom(Sj), Mc = mom(Ej, true), mc = Mc.dot(eixo), vel = eixo.clone().multiplyScalar(mc).cross(gd.clone().sub(Ej));   // para onde a carga leva a mão: se afasta do ombro, quem segura são os flexores
      const tau = { omb: Mo.x, oma: -sx * Mo.z, cot: (vel.dot(gd.clone().sub(Sj)) >= 0 ? 1 : -1) * Math.abs(mc), lom: lomb.t, qua: quad.t / 2 };
      const so = Math.abs(tau.omb), sa = Math.abs(tau.oma), direto = (so * fracao('omb', tau.omb) + sa * fracao('oma', tau.oma)) / (so + sa + 1e-9), fe = 1 - direto;
      const Me = mom(SC), Mr = mom(PR);
      tau.ese = -sx * Me.dot(zT) * fe; tau.esp = -sx * Me.dot(yT) * fe; tau.esr = Mr.dot(aR) * fe;
      return { tau, Fm, direto };
    };
    let h = 0;
    if (op.latModo === 'manual') h = (op.lat || 0) / 100 * T;
    else if (op.latModo === 'auto' && T > 0) {   // a força lateral (até 60% da força do cabo) que deixa menor a soma dos esforços do ombro e do cotovelo: cada torque dividido pelo torque máximo do grupo que o vence, ao quadrado
      const esc = Math.pow(op.massa / 75, 0.67), custo = x => { const t = calc(x).tau; let q = 0; for (const j of ['oma', 'omb', 'cot']) { const tm = (TMAX[j + '.' + (t[j] >= 0 ? JS[j].pos : JS[j].neg)[0]] || [100])[0] * esc; q += (t[j] / tm) ** 2; } return q; };
      let lo = -0.6 * T, hi = 0.6 * T; for (let i = 0; i < 40; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; custo(m1) < custo(m2) ? (hi = m2) : (lo = m1); }   // a função é convexa: busca ternária
      h = (lo + hi) / 2;
    }
    const r = calc(h), tau = r.tau, Fn = Math.max(r.Fm.length(), 1e-6), dm = r.Fm.clone().normalize();
    const pts = simPts(M, bar, gd); pts.pol = pol;
    return { J: { omb: Sj, oma: Sj, cot: Ej, lom: L5w, qua: Hw }, tau, d: { omb: tau.omb / Fn, oma: tau.oma / Fn, cot: tau.cot / Fn, lom: lomb.t / Math.max(lomb.R, 40), qua: quad.t / Math.max(quad.R, 40) }, w: { omb: Fn, oma: Fn, cot: Fn }, bar, gd, ge, cmz: 0, pts,
      cabo: { pol, dir, T, h, dm, direto: r.direto, res: { lom: lomb, qua: quad } } };
  }
  const bar = ex.barMao ? gd.clone().add(ge).multiplyScalar(0.5).setX(0) : (() => { const b = ex.barra0(op); return P(new THREE.Vector3(0, b.y, b.z), ex.barraSeg || 'v:Vertebra T1'); })();
  segs.push(['barra', op.carga, bar]);
  const J = { tor: P(S.A.d, 'pernad'), joe: P(S.K.d, 'pernad'), qua: P(S.H.d, 'coxad'), lom: P(L5, 'pelve'), omb: P(S.Hh.d, 'umerod'), cot: P(S.Co.d, 'umerod') };
  const fora = { tor: /^pe$/, joe: /^(pe|perna)$/, qua: /^(pe|perna|coxa)$/, lom: /^(pe|perna|coxa|pelve)$/ };
  const tau = {}, d = {}, w = {}, up = {};
  // apoio no banco (elevação pélvica): o banco empurra a parte de cima das costas para cima e o chão empurra os pés. A força no banco sai do equilíbrio de momentos em volta do ponto de apoio dos pés.
  let ban = null;
  if (ex.banco) {
    const F = P(S.A.d, 'pernad').clone(); F.z += 0.035; F.y = S.chao;
    const Cp = ex.banco(op, POSE.S.k), C = P(new THREE.Vector3(0, Cp.y, Cp.z), 'v:Vertebra T1');
    let mz = 0; for (const [, mm, pp] of segs) mz += mm * (pp.z - F.z);
    ban = { F, C, N: Math.max(0, mz / (C.z - F.z)) };   // em kg (multiplica por G para newtons)
  }
  for (const j of ex.jun) {
    let t = 0, m = 0;
    for (const [c, mm, p] of segs) {
      let f = 0;
      if (fora[j]) f = fora[j].test(c) || (j === 'lom' && c === 'barra' && ex.barraSeg === 'pelve') ? 0 : 1;
      else if (j === 'omb') f = /^(bracod|antebracod|maod)$/.test(c) ? 1 : c === 'barra' ? 0.5 : 0;
      else if (j === 'cot') f = /^(antebracod|maod)$/.test(c) ? 1 : c === 'barra' ? 0.5 : 0;
      t += f * mm * (p.z - J[j].z); m += f * mm;
    }
    if (ban && fora[j]) { t -= ban.N * (ban.C.z - J[j].z); m -= ban.N; }   // o banco fica do lado de cima de todas essas articulações
    const div = JS[j].lado === 'perna' ? 2 : 1; tau[j] = G * t / div; w[j] = G * Math.abs(m) / div; up[j] = m < 0; d[j] = Math.abs(m) > 4 ? t / Math.abs(m) : 0;
  }
  let sz = 0, sm = 0; for (const [, mm, p] of segs) { sz += mm * p.z; sm += mm; }
  const pts = simPts(M, bar, gd); if (ban) { pts.C = ban.C; pts.F = ban.F; }
  return { J, tau, d, w, up, bar, gd, ge, cmz: sz / sm, ban, pts };
}
function simTabela(ex, op) {   // 41 poses ao longo do movimento: ângulos, momentos, esforço e comprimento dos músculos
  const ks = Array.from({ length: 41 }, (_, i) => i / 40), ps = ks.map(k => ex.pose(k, op));
  let im = 0; const med = POSE.medir(ps.map(simDef), M => simMedir(M, ex, op, ps[im++].ang));
  return ks.map((k, i) => {
    const p = ps[i], m = med[i], ef = simEsforco(m.tau, p.ang, op, ex.un), comp = {}; for (const id of ex.un) comp[id] = simComp(p.ang, op, id);
    return { k, p, tau: m.tau, d: m.d, ef, comp, x: ex.x[1](p.ang), pts: m.pts };
  });
}

// ----- desenho no modelo: barra, linha da gravidade, braço de momento de cada articulação e centro de massa -----
function simPrepararG() {
  if (SIM.g) return SIM.g;
  const g = new THREE.Group(); g.visible = false; scene.add(g); SIM.g = g;
  const ferro = new THREE.MeshStandardMaterial({ color: '#9aa6b5', metalness: 0.6, roughness: 0.3, emissive: '#1b2430' });
  const anilha = new THREE.MeshStandardMaterial({ color: '#3b4a5e', roughness: 0.6, transparent: true, opacity: 0.22, depthWrite: false });   // translúcidas: na vista de lado a anilha fica na frente do corpo
  const barra = new THREE.Group(); barra.add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.0, 16).rotateZ(Math.PI / 2), ferro));
  SIM.anilhas = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.032, 36).rotateZ(Math.PI / 2), anilha); a.position.x = s * (0.6 + i * 0.036); barra.add(a); SIM.anilhas.push([a, i]); }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16).rotateZ(Math.PI / 2), ferro); col.position.x = s * 0.565; barra.add(col);
  }
  g.add(barra); SIM.barra3d = barra;
  const linha = (cor, dash, op = 1) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), dash ? new THREE.LineDashedMaterial({ color: cor, dashSize: 0.012, gapSize: 0.008, depthTest: false, transparent: true, opacity: op }) : new THREE.LineBasicMaterial({ color: cor, depthTest: false, transparent: true, opacity: op })); l.renderOrder = 22; l.frustumCulled = false; g.add(l); return l; };
  const esf = new THREE.SphereGeometry(1, 16, 12), cone = new THREE.ConeGeometry(1, 2.2, 12).rotateX(Math.PI);
  SIM.linhaG = linha('#ffd43b', false, 0.9);
  SIM.alav = {};
  for (const [j, J] of Object.entries(JS)) {
    const mat = new THREE.MeshBasicMaterial({ color: J.cor, depthTest: false });
    const bola = new THREE.Mesh(esf, mat); bola.scale.setScalar(0.011); bola.renderOrder = 23;
    const ponta = new THREE.Mesh(cone, mat); ponta.scale.setScalar(0.009); ponta.renderOrder = 23;
    const lv = linha(J.cor, false), vt = linha(J.cor, true, 0.85); g.add(bola, ponta);
    SIM.alav[j] = { bola, ponta, lv, vt };
  }
  // aparelho da puxada: barra reta ou triângulo, polia, assento e rolo das coxas
  const px = new THREE.Group(); px.visible = false; g.add(px); SIM.px = px;
  const estofo = new THREE.MeshStandardMaterial({ color: '#4a5b80', roughness: 0.85, transparent: true, opacity: 0.6, depthWrite: false });
  const cil = (r, L, mat, eixo) => { const gm = new THREE.CylinderGeometry(r, r, L, 16); eixo === 'x' ? gm.rotateZ(Math.PI / 2) : eixo === 'z' && gm.rotateX(Math.PI / 2); return new THREE.Mesh(gm, mat); };
  SIM.pxReta = cil(0.014, 1.3, ferro, 'x'); SIM.pxTri = new THREE.Group();
  for (const sgn of [-1, 1]) { const h = cil(0.014, 0.13, ferro, 'z'); h.position.x = sgn * 0.075; SIM.pxTri.add(h); const l = cil(0.007, 0.17, ferro, 'y'); l.position.set(sgn * 0.0375, 0.075, 0); l.rotation.z = sgn * 0.46; SIM.pxTri.add(l); }
  SIM.pxPolia = cil(0.055, 0.03, ferro, 'x'); SIM.pxAssento = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), estofo); SIM.pxRolo = cil(0.05, 0.5, estofo, 'x');
  px.add(SIM.pxReta, SIM.pxTri, SIM.pxPolia, SIM.pxAssento, SIM.pxRolo);
  SIM.linhaM = linha('#ffd43b', true, 0.75);
  SIM.banco = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 0.34), estofo); SIM.banco.visible = false; g.add(SIM.banco);   // banco da elevação pélvica (altura ajustada a cada quadro)
  const cmM = new THREE.MeshBasicMaterial({ color: '#3fd8cb', depthTest: false, transparent: true, opacity: 0.9 });
  SIM.cm = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.026, 28).rotateX(-Math.PI / 2), cmM); SIM.cm.renderOrder = 23; g.add(SIM.cm);
  return g;
}
const _sv = new THREE.Vector3(), _sw = new THREE.Vector3();
function simDesenhar(m) {
  const ex = EX_S[SIM.ex], op = SIM.op, g = SIM.g; if (!g) return;
  SIM.px.visible = SIM.linhaM.visible = !!ex.cabo; SIM.cm.visible = !ex.cabo && !ex.semCM; SIM.banco.visible = !!m.ban;
  if (m.ban) { const C = m.ban.C, ch = POSE.S.chao, h = Math.max(0.1, C.y - 0.035 - ch); SIM.banco.scale.set(1, h, 1); SIM.banco.position.set(0, ch + h / 2, C.z - 0.17); }
  if (ex.cabo) {
    const { pol, dir } = m.cabo, c = puxPrep(op), tri = op.pegada === 'triangulo', Bq = SIM.base;
    SIM.barra3d.visible = false; SIM.pxReta.visible = !tri; SIM.pxTri.visible = tri;
    (tri ? SIM.pxTri : SIM.pxReta).position.copy(m.bar); SIM.pxPolia.position.copy(pol).addScaledVector(dir, 0.055);
    SIM.pxAssento.position.set(0, c.q.H.y - 0.115, c.q.H.z + 0.1); const rl = lerp2(c.q.H, c.q.K, 0.72); SIM.pxRolo.position.set(0, rl.y + 0.105, rl.z);
    SIM.linhaG.geometry.setFromPoints([tri ? _sv.copy(m.bar).setY(m.bar.y + 0.15) : m.bar, pol]); SIM.linhaG.visible = true;
    const dm = m.cabo.dm;   // direção da força na mão: a do cabo, mais a força lateral na barra
    SIM.linhaM.geometry.setFromPoints([_sv.copy(m.gd).addScaledVector(dm, -0.3), _sw.copy(m.gd).addScaledVector(dm, 0.45)]); SIM.linhaM.computeLineDistances();
    const maior = Math.abs(m.tau.oma) >= Math.abs(m.tau.omb) ? 'oma' : 'omb';
    for (const [j, o] of Object.entries(SIM.alav)) {
      const res = m.cabo.res[j], on = ex.jun.includes(j) && (res ? !!res.Q && res.Q.distanceTo(m.J[j]) < 0.6 : j === 'cot' || j === maior); o.bola.visible = o.ponta.visible = o.lv.visible = o.vt.visible = on; if (!on) continue;
      // ombro e cotovelo: pé da perpendicular da articulação até a linha de força da mão; lombar e quadril: até a linha da força resultante (peso do corpo + cabo)
      const Pj = m.J[j], dj = res ? res.dir : dm, Q = res ? res.Q : m.gd.clone().addScaledVector(dm, Pj.clone().sub(m.gd).dot(dm)), fim = Q.clone().addScaledVector(dj, 0.07);
      o.bola.position.copy(Pj); o.lv.geometry.setFromPoints([Pj, Q]); o.vt.geometry.setFromPoints([Q, fim]); o.vt.computeLineDistances();
      o.ponta.position.copy(fim); o.ponta.quaternion.setFromUnitVectors(_sv.set(0, -1, 0), dj);
    }
    return;
  }
  for (const o of Object.values(SIM.alav)) o.ponta.quaternion.identity();
  const B = m.bar; SIM.barra3d.position.copy(B); SIM.barra3d.visible = op.carga > 0;
  const nAn = op.carga <= 25 ? 0 : op.carga <= 60 ? 1 : op.carga <= 100 ? 2 : op.carga <= 140 ? 3 : 4; SIM.anilhas.forEach(([a, i]) => a.visible = i < nAn);
  const chao = POSE.S.chao;
  SIM.linhaG.geometry.setFromPoints([B, _sv.set(B.x, chao, B.z)]); SIM.linhaG.visible = op.carga > 0;
  for (const [j, o] of Object.entries(SIM.alav)) {
    const on = ex.jun.includes(j) && !(m.ban && !m.d[j]); o.bola.visible = o.ponta.visible = o.lv.visible = o.vt.visible = on; if (!on) continue;
    const P = m.J[j], dz = m.d[j], fim = _sw.set(P.x, P.y, P.z + dz), sg = m.up && m.up[j] ? 1 : -1;   // seta para cima quando a força que sobra é o apoio do banco
    o.bola.position.copy(P); o.lv.geometry.setFromPoints([P, fim]);
    o.vt.geometry.setFromPoints([fim, _sv.set(P.x, P.y + sg * 0.07, P.z + dz)]); o.vt.computeLineDistances();
    o.ponta.position.set(P.x, P.y + sg * 0.07, P.z + dz); if (sg > 0) o.ponta.quaternion.setFromAxisAngle(_ex, Math.PI);
  }
  SIM.cm.position.set(0, chao + 0.003, m.cmz);
}
function simRotulos(m) {
  const ex = EX_S[SIM.ex], out = [], mx = Math.max(...ex.jun.map(j => Math.abs(m.tau[j])));
  if (ex.cabo) {
    const maior = Math.abs(m.tau.oma) >= Math.abs(m.tau.omb) ? 'oma' : 'omb';
    for (const j of ex.jun) {
      const t = Math.abs(m.tau[j]), res = m.cabo.res[j]; if (t < 0.12 * mx) continue;
      if (res) { out.push(CEL() ? { p: m.J[j].clone(), t: `${f1(t, 0)} N·m`, c: JS[j].cor, esq: true, fora: true } : { p: m.J[j].clone().add(new THREE.Vector3(0, j === 'lom' ? 0.05 : -0.04, 0)), t: `${JS[j].n} ${f1(t, 0)} N·m`, c: JS[j].cor, esq: true }); continue; }
      if (j !== 'cot' && j !== maior) continue;
      const Pj = m.J[j], Q = m.gd.clone().addScaledVector(m.cabo.dm, Pj.clone().sub(m.gd).dot(m.cabo.dm));
      out.push(CEL() ? { p: Pj.clone(), t: `${f1(t, 0)} N·m`, c: JS[j].cor, esq: j === 'cot', fora: true } : { p: j === 'cot' ? Pj.clone().add(new THREE.Vector3(0, -0.06, 0)) : Q.clone().add(new THREE.Vector3(0, 0.06, 0)), t: `${j === 'cot' ? 'Cotovelo' : 'Ombro'} ${f1(t, 0)} N·m · ${f1(Math.abs(m.d[j]) * 100, 0)} cm`, c: JS[j].cor, esq: j === 'cot' });
    }
    return out;
  }
  for (const j of ex.jun) {
    const P = m.J[j], dz = m.d[j], t = Math.abs(m.tau[j]); if (t < 0.12 * mx) continue;   // sem rótulo para torques pequenos (a alavanca continua desenhada)
    // no celular: só o número, ao lado da articulação e do lado oposto da alavanca (a cor identifica a articulação)
    out.push(CEL() ? { p: P.clone().add(new THREE.Vector3(0, j === 'lom' ? 0.045 : j === 'qua' ? -0.02 : 0, 0)), t: `${f1(t, 0)} N·m`, c: JS[j].cor, esq: dz > 0, fora: true } : { p: new THREE.Vector3(P.x, P.y, P.z + dz), t: `${JS[j].n} ${f1(t, 0)} N·m · ${f1(Math.abs(dz) * 100, 0)} cm`, c: JS[j].cor, esq: dz < 0 });
  }
  return out;
}

// ----- cores dos músculos pelo esforço (mapa de calor) -----
const CALOR = [[0, '#33415c'], [0.25, '#ffd43b'], [0.55, '#ff8a3d'], [0.85, '#ff3b5c'], [1, '#ff1744']].map(([t, c]) => [t, new THREE.Color(c)]);
const calor = (p, out = new THREE.Color()) => { const t = lim(p / 100, 0, 1); for (let i = 1; i < CALOR.length; i++) if (t <= CALOR[i][0]) { const [a, ca] = CALOR[i - 1], [b, cb] = CALOR[i]; return out.copy(ca).lerp(cb, (t - a) / (b - a)); } return out.copy(CALOR[CALOR.length - 1][1]); };
const NEUTRO_S = new THREE.Color('#5d5560'), EST_S = new THREE.Color('#3fd8cb');
function simCorPrep(ex) {   // guarda as malhas de cada unidade e apaga os outros músculos
  const porB = {}; for (const [n, e] of Object.entries(E)) if (e.c === 'musculos' && MESH[n]) (porB[e.b] = porB[e.b] || []).push(n);
  for (const [n, m] of Object.entries(MESH)) if (m.userData.camada === 'musculos') { if (!m.userData.cor0) m.userData.cor0 = m.material.color.clone(); m.material.color.copy(NEUTRO_S); }
  SIM.malhas = {}; for (const id of ex.un) SIM.malhas[id] = US[id].b.flatMap(b => porB[b] || []);
  for (const b of ex.est) for (const n of porB[b] || []) MESH[n].material.color.copy(EST_S).multiplyScalar(0.7);
}
const _sc = new THREE.Color();
function simCores(ef) { for (const [id, ns] of Object.entries(SIM.malhas || {})) { calor(ef[id] ? ef[id].p : 0, _sc); for (const n of ns) MESH[n].material.color.copy(_sc); } }

// ----- painel -----
function simInterp(k) {   // valores da tabela no ponto k (0 a 1)
  const T = SIM.tab, x = lim(k, 0, 1) * 40, i = Math.min(39, Math.floor(x)), f = x - i, a = T[i], b = T[i + 1], L = (u, v) => u + (v - u) * f;
  const mix = (A, Bb) => Object.fromEntries(Object.keys(A).map(key => [key, typeof A[key] === 'number' ? L(A[key], Bb[key]) : A[key]]));
  return { tau: mix(a.tau, b.tau), d: mix(a.d, b.d), ef: Object.fromEntries(Object.keys(a.ef).map(id => [id, { p: L(a.ef[id].p, b.ef[id].p), F: L(a.ef[id].F, b.ef[id].F), j: a.ef[id].j || b.ef[id].j }])), comp: mix(a.comp, b.comp), x: L(a.x, b.x) };
}
function simAtualizar() {   // a cada quadro: números do painel, cores e desenho no modelo
  if (!SIM.on || !POSE.S.M) return;
  const ex = EX_S[SIM.ex], op = SIM.op, k = POSE.S.k, p = ex.pose(k, op), m = SIM.ult || simMedir(POSE.S.M, ex, op, p.ang);
  simDesenhar(m);
  const ef = simEsforco(m.tau, p.ang, op, ex.un); simCores(ef);
  if (!$('smK')) return;
  $('smK').textContent = Math.round(k * 100) + '%'; if (document.activeElement !== $('smKs')) $('smKs').value = Math.round(k * 100);
  $('smAng').innerHTML = ex.tiles(p).map(([n, v]) => `<div><small>${esc(n)}</small><b>${Math.round(v)}°</b></div>`).join('');
  const mx = Math.max(20, ...SIM.tab.flatMap(r => ex.jun.map(j => Math.abs(r.tau[j]))));
  $('smT').innerHTML = ex.jun.map(j => {
    const t = m.tau[j], J = JS[j], quem = Math.abs(t) < 0.5 ? 'quase sem torque: a carga passa pela articulação' : simTravado(j, t, p.ang) ? 'articulação travada em extensão: ligamentos e o encaixe dos ossos seguram, quase sem músculo' : 'trabalham os ' + (t >= 0 ? J.pos : J.neg)[1];
    return `<div class="agm"><div class="agm-t"><span><i style="background:${J.cor}"></i>${(ex.jn && ex.jn[j]) || J.n}${J.lado ? ` <small>(por ${J.lado})</small>` : ''}</span><b>${f1(Math.abs(t), 0)} N·m</b></div><div class="agm-b"><i style="width:${Math.abs(t) / mx * 100}%;background:${J.cor}"></i></div><small>${ex.cabo && m.cabo.res[j] ? 'peso do corpo acima da articulação + tração do cabo' : `braço de momento ${f1(Math.abs(m.d[j]) * 100, 1)} cm`} · ${quem}</small></div>`;
  }).join('');
  if ($('smTe') && ex.junE) $('smTe').innerHTML = ex.junE.map(j => {
    const t = m.tau[j], J = JS[j];
    return `<div class="agm"><div class="agm-t"><span><i style="background:${J.cor}"></i>${J.n} <small>(por lado)</small></span><b>≈ ${f1(Math.abs(t), 0)} N·m</b></div><div class="agm-b"><i style="width:${Math.min(100, Math.abs(t) / mx * 100)}%;background:${J.cor}"></i></div><small>${Math.abs(t) < 0.5 ? 'quase sem torque' : 'trabalham os ' + (t >= 0 ? J.pos : J.neg)[1]}</small></div>`;
  }).join('') + `<small style="display:block;margin-top:4px;color:var(--ink3)">O latíssimo e o peitoral levam cerca de ${Math.round(m.cabo.direto * 100)}% do torque do ombro direto para o tronco; o restante passa pela escápula.</small>`;
  if (ex.cabo && $('smo_lat')) { const pc = Math.round(m.cabo.h / Math.max(m.cabo.T, 1e-6) * 100), kgf = Math.abs(m.cabo.h) / G; $('smo_lat').textContent = `${pc > 0 ? '+' : ''}${pc}% · ${f1(kgf, 1)} kgf ${pc > 0 ? 'para fora' : pc < 0 ? 'para dentro' : ''}`; if (op.latModo !== 'manual' && document.activeElement !== $('smLatS')) $('smLatS').value = pc; }
  const ord = ex.un.slice().sort((a, b) => ef[b].p - ef[a].p).filter(id => ef[id].p >= 0.5 || !/^(dem|trd|ser|ere|glu|rf|ilp|rab|obl|lev)$/.test(id) || !ex.cabo);
  $('smE').innerHTML = ord.map(id => {
    const e = ef[id], c = simComp(p.ang, op, id), cor = '#' + calor(e.p, _sc).getHexString();
    return `<div class="agm"><div class="agm-t"><span><i style="background:${cor}"></i>${esc(US[id].n)}${US[id].aprox ? ' <small>(aprox.)</small>' : ''}</span><b>${e.p < 0.5 ? '—' : (US[id].aprox ? '≈ ' : '') + Math.round(Math.min(e.p, 100)) + '%'}${e.p > 100 ? '+' : ''}</b></div><div class="agm-b"><i style="width:${Math.min(100, e.p)}%;background:${cor}"></i></div><small>${e.p < 0.5 ? 'sem exigência nesta posição' : `força ≈ ${f1(e.F, 0)} N (${f1(e.F / G, 0)} kgf)`} ${US[id].aprox ? '' : ` · ${Math.abs(c) < 0.3 ? 'comprimento quase de repouso' : c > 0 ? `alongado ${f1(c, 1)} cm` : `encurtado ${f1(-c, 1)} cm`}`}</small></div>`;
  }).join('');
  simGraf(); if (SIM.cmp) simAB2();
}
function simGraf() {
  const cv = $('smG'); if (!cv || !SIM.tab) return; const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return; if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const ex = EX_S[SIM.ex], T = SIM.tab, modo = SIM.graf, ab = SIM.cmp && SIM.tabA && SIM.tabB;
  let series;
  if (modo === 'tor' && ab) series = [...ex.jun.map(j => [JS[j].cor, SIM.tabA.map(r => Math.abs(r.tau[j])), (ex.jn && ex.jn[j]) || JS[j].n, 'A', j]), ...ex.jun.map(j => [JS[j].cor, SIM.tabB.map(r => Math.abs(r.tau[j])), null, 'B', j])];
  else if (modo === 'tor') series = ex.jun.map(j => [JS[j].cor, T.map(r => Math.abs(r.tau[j])), (ex.jn && ex.jn[j]) || JS[j].n]);
  else if (modo === 'esf') { const top = ex.un.slice().sort((a, b) => Math.max(...T.map(r => r.ef[b].p)) - Math.max(...T.map(r => r.ef[a].p))).slice(0, 5); series = top.map(id => [US[id].cor, T.map(r => Math.min(r.ef[id].p, 120)), US[id].n]); }
  else { const top = ex.un.slice().sort((a, b) => Math.max(...T.map(r => Math.abs(r.comp[b]))) - Math.max(...T.map(r => Math.abs(r.comp[a])))).slice(0, 5); series = top.map(id => [US[id].cor, T.map(r => r.comp[id]), US[id].n]); }
  const vals = series.flatMap(s => s[1]), mx = Math.max(modo === 'comp' ? 1 : 10, ...vals) * 1.08, mn = Math.min(0, ...vals) * 1.08;
  const pl = 34, pr = 8, pt = 10, pb = 22, W = w - pl - pr, H = h - pt - pb, X = i => pl + i / 40 * W, Y = v => pt + H - (v - mn) / (mx - mn) * H;
  x.font = '10px Instrument Sans, sans-serif'; x.fillStyle = '#939dba'; x.strokeStyle = '#243344'; x.lineWidth = 1;
  for (const i of [0, 10, 20, 30, 40]) { x.beginPath(); x.moveTo(X(i), pt); x.lineTo(X(i), pt + H); x.stroke(); x.textAlign = 'center'; x.fillText(Math.round(T[i].x) + '°', X(i), h - 6); }
  x.beginPath(); x.moveTo(pl, Y(0)); x.lineTo(pl + W, Y(0)); x.stroke();
  x.textAlign = 'right'; x.fillText(f1(mx / 1.08, 0), pl - 4, Y(mx / 1.08) + 3); x.fillText('0', pl - 4, Y(0) + 3); if (mn < 0) x.fillText(f1(mn / 1.08, 0), pl - 4, Y(mn / 1.08) + 3);
  for (const [cor, v, , lado] of series) { x.beginPath(); v.forEach((y, i) => i ? x.lineTo(X(i), Y(y)) : x.moveTo(X(i), Y(y))); x.strokeStyle = cor; x.lineWidth = 2; x.setLineDash(lado === 'B' ? [6, 4] : []); x.stroke(); }
  x.setLineDash([]);
  if (modo === 'tor' && ab) {   // o ponto mais difícil de cada versão: o maior torque da articulação mais exigida
    const jm = ex.jun.slice().sort((a, b) => Math.max(...SIM.tabA.map(r => Math.abs(r.tau[b])), ...SIM.tabB.map(r => Math.abs(r.tau[b]))) - Math.max(...SIM.tabA.map(r => Math.abs(r.tau[a])), ...SIM.tabB.map(r => Math.abs(r.tau[a]))))[0];
    [['A', SIM.tabA, COR_A, -1], ['B', SIM.tabB, COR_B, 1]].forEach(([nm, TT, cor]) => { let bi = 0; TT.forEach((r, i) => { if (Math.abs(r.tau[jm]) > Math.abs(TT[bi].tau[jm])) bi = i; });
      const px = X(bi), py = Y(Math.abs(TT[bi].tau[jm])); x.fillStyle = cor; x.beginPath(); x.arc(px, py, 4, 0, 7); x.fill();
      x.font = '700 10px Instrument Sans, sans-serif'; x.textAlign = px > pl + W * 0.7 ? 'right' : 'left'; x.fillText(`${nm}: mais difícil`, px + (px > pl + W * 0.7 ? -6 : 6), nm === 'A' ? py - 5 : py + 12); });
  }
  const kx = X(lim(POSE.S.k, 0, 1) * 40); x.strokeStyle = '#3fd8cb'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(kx, pt); x.lineTo(kx, pt + H); x.stroke(); x.setLineDash([]);
  const leg = $('smGl'); if (leg) { const html = series.filter(sr => sr[2]).map(([c, , n]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('') + (modo === 'tor' && ab ? `<span><b style="color:${COR_A}">A</b> linha contínua · <b style="color:${COR_B}">B</b> tracejada</span>` : SIM.cmp ? `<span>versão <b style="color:${SIM.lado === 'A' ? COR_A : COR_B}">${SIM.lado}</b></span>` : '') + `<span>${modo === 'tor' ? 'N·m' : modo === 'esf' ? '% da força máxima estimada' : 'cm em relação à posição anatômica (+ alongado, − encurtado)'} × ${ex.x[0]}</span>`; if (leg.innerHTML !== html) leg.innerHTML = html; }
}
// comparações prontas: duas versões do mesmo exercício, com os números de cada uma
const COMP_S = [
  { ex: 'agachamento', t: 'Barra alta × barra baixa', a: ['Barra alta', { v: 'alta' }], b: ['Barra baixa', { v: 'baixa' }],
    txt: 'Com a barra mais baixa nas costas, o tronco inclina mais para o centro de massa continuar sobre o meio do pé. O quadril se afasta da linha da barra e o torque migra do joelho para o quadril e a lombar.' },
  { ex: 'agachamento', t: 'Agachamento de costas × frontal', a: ['De costas (barra alta)', { v: 'alta' }], b: ['Frontal', { v: 'frontal' }],
    txt: 'Com a barra na frente, o tronco fica mais vertical e o joelho avança mais. O quadríceps assume mais trabalho e a lombar e o quadril recebem menos torque com a mesma carga.' },
  { ex: 'agachamento', t: 'Tornozelo travado × com boa mobilidade', a: ['Dorsiflexão de 20°', { mob: 20 }], b: ['Dorsiflexão de 40°', { mob: 40 }],
    txt: 'Quando o tornozelo trava, o joelho não avança e o tronco precisa inclinar mais. O esforço sai do quadríceps e vai para o quadril e a lombar.' },
  { ex: 'agachamento', t: 'Até a paralela × profundo', a: ['Até a paralela (95°)', { prof: 95 }], b: ['Profundo (125°)', { prof: 125 }],
    txt: 'Descer mais aumenta a amplitude em que o glúteo máximo e o adutor magno trabalham alongados. No joelho, o torque chega perto do máximo na paralela e muda pouco abaixo dela.' },
  { ex: 'remada', t: 'Tronco a 45° × paralelo ao chão', a: ['Tronco a 45°', { tronco: 45 }], b: ['Tronco a 80° (estilo Pendlay)', { tronco: 80 }],
    txt: 'Quanto mais inclinado o tronco, mais longe a barra fica da lombar e do quadril: o torque nos extensores da coluna sobe muito. O braço puxa mais "para trás" e o latíssimo trabalha mais alongado no início.' },
  { ex: 'remada', t: 'Pegada pronada × supinada', a: ['Pronada', { pegada: 'pronada' }], b: ['Supinada', { pegada: 'supinada' }],
    txt: 'Com a palma para a frente (supinada), o bíceps puxa em posição mais favorável e os cotovelos ficam mais junto ao corpo. Na pronada, os cotovelos abrem mais e o braquial e o braquiorradial dividem mais a flexão do cotovelo.' },
  { ex: 'puxada', t: 'Pegada aberta pronada × supinada fechada', a: ['Aberta pronada', { pegada: 'pronada' }], b: ['Supinada', { pegada: 'supinada' }],
    txt: 'Com a pegada aberta, a mão fica longe do ombro para o lado: a carga tende a abduzir o braço e o torque de adução, no plano frontal, é o maior do ombro. Com a pegada supinada na largura dos ombros, os cotovelos descem pela frente do corpo: predomina a extensão do ombro, no plano sagital. O cotovelo recebe mais torque e o bíceps trabalha mais, em posição mais favorável. A escápula também recebe menos carga.' },
  { ex: 'puxada', t: 'Sem força lateral × puxando a barra para fora', a: ['Sem força lateral', { latModo: 'zero' }], b: ['Puxando para fora (30%)', { latModo: 'manual', lat: 30 }],
    txt: 'A carga no aparelho é a mesma. Ao tentar "abrir" a barra, a barra puxa as mãos para dentro: o torque de adução do ombro sobe e os adutores (latíssimo, redondo maior e peitoral) trabalham mais. No cotovelo acontece o contrário: os flexores deixam de ser exigidos e quem passa a segurar é o tríceps. É o que está por trás da dica de puxar a barra para fora.' },
  { ex: 'puxada', t: 'Supinada × triângulo', a: ['Supinada', { pegada: 'supinada' }], b: ['Triângulo (pegada neutra)', { pegada: 'triangulo' }],
    txt: 'As duas são puxadas no plano sagital, com extensão do ombro. No triângulo as mãos ficam juntas e em posição neutra: o braquiorradial trabalha no seu melhor ângulo e o bíceps perde um pouco de vantagem em relação à supinada.' },
  { ex: 'puxada', t: 'Tronco quase reto × inclinado para trás', a: ['Tronco a 5°', { tronco: 5 }], b: ['Inclinado 30° para trás', { tronco: 30 }],
    txt: 'Com o tronco quase reto, o cabo passa à frente da coluna e tende a estender o tronco: o abdômen trabalha para segurar. Inclinado 30° para trás, o corpo fica embaixo da linha do cabo e esse torque na lombar quase some. No ombro, o torque de extensão diminui um pouco e o braço começa menos elevado em relação ao tronco. A adução, no plano frontal, quase não muda.' },
  { ex: 'terra', t: 'Barra sobre o meio do pé × à frente', a: ['Barra sobre o meio do pé', { barra: 'meio' }], b: ['Barra 5 cm à frente', { barra: 'frente' }],
    txt: 'Com a barra 5 cm à frente, o tronco precisa inclinar mais para o braço alcançá-la: o pico de torque sobe cerca de 10% no quadril e na lombar com a mesma carga. O tornozelo também recebe mais torque, e o joelho, que no começo pede quadríceps, passa a pedir os flexores. É por isso que a barra deve subir encostada nas pernas.' },
  { ex: 'terra', t: 'Quadril alto × baixo na saída', a: ['Quadril alto (canela a 6°)', { canela: 6 }], b: ['Quadril baixo (canela a 20°)', { canela: 20 }],
    txt: 'Começar com o quadril mais baixo e a canela mais inclinada deixa o tronco mais em pé: o torque no quadril e na lombar cai cerca de 17% e o do joelho mais que dobra. O quadríceps assume uma parte bem maior da saída do chão. Com o quadril alto, o terra fica mais parecido com um stiff.' },
  { ex: 'stiff', t: 'Stiff × terra romeno', a: ['Stiff (joelho a 6°)', { estilo: 'stiff' }], b: ['Terra romeno (joelho a 22°)', { estilo: 'romeno' }],
    txt: 'Com a mesma inclinação do tronco, o joelho mais flexionado do terra romeno deixa o quadril ir mais para trás e a flexão do quadril chega mais longe: o pico de torque sobe cerca de 12% no quadril e 20% na lombar. Os isquiotibiais chegam ao mesmo comprimento máximo nos dois: no stiff porque o joelho está estendido, no romeno porque o quadril flexiona mais. No stiff, o joelho quase estendido fica travado e quem segura é a própria articulação; no romeno, o gastrocnêmio ajuda.' },
  { ex: 'stiff', t: 'Descer até 55° × até o tronco paralelo', a: ['Tronco até 55°', { tronco: 55 }], b: ['Tronco até 90°', { tronco: 90 }],
    txt: 'Descer mais aumenta o braço de momento da barra e do tronco: o pico de torque sobe cerca de 28% no quadril e 30% na lombar. Os isquiotibiais e o glúteo máximo trabalham mais alongados no fundo (cerca de 3,5 cm a mais nos isquiotibiais).' },
  { ex: 'bomdia', t: 'Good morning: descer até 50° × até o tronco paralelo', a: ['Tronco até 50°', { tronco: 50 }], b: ['Tronco até 90°', { tronco: 90 }],
    txt: 'A barra nas costas fica longe do quadril, e cada grau a mais de inclinação aumenta bastante a alavanca: o pico de torque sobe cerca de 42% no quadril e 45% na lombar, e os isquiotibiais chegam uns 4 cm mais alongados. Com os mesmos 40 kg e o tronco a 70°, o good morning gera cerca de 45% mais torque no quadril e 65% mais na lombar que o stiff, porque no stiff a barra fica pendurada perto das pernas.' },
  { ex: 'bomdia', t: 'Good morning: joelhos quase estendidos × semiflexionados', a: ['Joelhos quase estendidos (8°)', { joelho: 'reto' }], b: ['Joelhos semiflexionados (25°)', { joelho: 'flex' }],
    txt: 'O torque no quadril e na lombar fica igual: quem manda é a inclinação do tronco. O que muda é o joelho: com ele quase estendido, os isquiotibiais e o gastrocnêmio trabalham mais para segurá-lo (isquiotibiais de cerca de 66% para 77% de esforço). Flexionar um pouco o joelho deixa o quadril recuar com mais conforto, sem aliviar a lombar.' },
  { ex: 'pelvica', t: 'Elevação pélvica: onde colocar os pés', a: ['Pés perto do banco', { pes: 'perto' }], b: ['Pés longe do banco', { pes: 'longe' }],
    txt: 'Com os pés perto, a força do chão passa à frente do joelho e o quadríceps trabalha um pouco. Com os pés longe, o joelho fica mais estendido e a força passa atrás dele: os isquiotibiais passam a flexionar o joelho e a estender o quadril, e o esforço deles sobe de cerca de 43% para 75%. O torque no quadril também aumenta (cerca de 30%). Para focar o glúteo sem tanto isquiotibial, a canela perto da vertical no topo é o meio-termo.' },
  { ex: 'pelvica', t: 'Amplitude curta × completa', a: ['Quadril desce 15 cm', { desc: 15 }], b: ['Quadril desce 32 cm', { desc: 32 }],
    txt: 'Descer mais o quadril aumenta a flexão do quadril no fundo (de cerca de 40° para 86°): o glúteo máximo trabalha bem mais alongado e o pico de torque no quadril sobe cerca de 15%. O adutor magno e os isquiotibiais também ganham mais trabalho no fundo. No topo, as duas versões ficam iguais.' },
];
function simPico(T, j) { let b = T[0]; for (const r of T) if (Math.abs(r.tau[j]) > Math.abs(b.tau[j])) b = r; return b; }
// estilos da comparação A × B: ficam aqui, junto do código, para nunca ficarem fora de sincronia com uma página em cache
{ const st = document.createElement('style'); st.textContent = '.smcmp-h{display:flex;align-items:center;justify-content:space-between;gap:8px}.smx{width:30px;height:30px;border-radius:50%;border:1px solid var(--line);color:var(--ink3);flex:none}.smab{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.smab button{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--line);border-radius:12px;padding:7px 9px;background:var(--bg2);font-size:12.5px;line-height:1.25;color:var(--ink2)}.smab button i{font-style:normal;font-weight:800;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none;color:#0b1020;background:var(--c)}.smab button.on{border-color:var(--c);color:var(--ink);box-shadow:inset 0 0 0 1px var(--c)}.smab-d{display:block;font-size:11.5px;color:var(--ink3);margin:6px 0 2px;line-height:1.4}.smfig{margin-top:6px}.smfig canvas{width:100%;height:240px;display:block;background:#0b1224;border:1px solid var(--line);border-radius:12px}.smfig-m{align-items:center}.smfig-m button{padding:4px 9px;font-size:11.5px}.smfig-m span{font-size:11px;color:var(--ink3);margin-left:auto}html.cel .smfig canvas{height:200px}html.cel .smfig-m button{padding:6px 10px;font-size:12px}.smbar{margin:8px 0}.smbar-t{display:flex;justify-content:space-between;font-size:13px}.smbar-t i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}.smbar-t b{font-size:12px}.smbar-l{display:grid;grid-template-columns:14px 1fr 64px;align-items:center;gap:6px;margin-top:3px}.smbar-l em{font-style:normal;font-weight:800;font-size:11px}.smbar-l>div{height:7px;background:var(--bg2);border-radius:4px;overflow:hidden}.smbar-l>div i{display:block;height:100%;border-radius:4px}.smbar-l small{font-size:11.5px;color:var(--ink2);text-align:right}.smnova{display:block;width:100%;text-align:left;margin-top:10px;border:1px dashed #f7b84b88;border-radius:14px;padding:10px 12px;background:#f7b84b0d}.smnova b{display:block;font-size:14px;color:var(--ac)}.smnova small{font-size:12px;color:var(--ink3)}'; document.head.appendChild(st); }
const COR_A = '#f7b84b', COR_B = '#3fd8cb', ORD_S = ['agachamento', 'terra', 'stiff', 'bomdia', 'pelvica', 'remada', 'puxada'];
const simAbModo = ex => SIM.abModo || (CEL() || ex.semCM ? 'sob' : 'lado');   // no celular e nos exercícios deitados, as duas figuras sobrepostas ficam maiores
function simDescr(ex, op, base) {   // o que muda numa versão em relação à outra (para os nomes da comparação montada pelo aluno)
  const out = [], v = ex.vars.find(x => x[0] === op[ex.chave]);
  if (!base || op[ex.chave] !== base[ex.chave]) out.push(v ? v[1] : op[ex.chave]);
  for (const [k, t, , , , u] of ex.ctl) if (!base || op[k] !== base[k]) { if (base || k === 'carga') out.push(`${t.split(' (')[0]} ${op[k]}${u === '°' ? '°' : ' ' + u}`); }
  if (ex.cabo && (!base || op.latModo !== base.latModo)) out.push({ auto: 'força lateral automática', zero: 'sem força lateral', manual: `força lateral ${op.lat}%` }[op.latModo]);
  return out.join(' · ') || (base ? simDescr(ex, op, null) : '');
}
function simNomes() { const c = SIM.cmp, ex = EX_S[c.ex]; return c.own ? [simDescr(ex, SIM.opA, SIM.opB), simDescr(ex, SIM.opB, SIM.opA)] : [c.a[0], c.b[0]]; }
function simCompHTML() {
  const c = SIM.cmp; if (!c) return '';
  const ex = EX_S[c.ex], ta = SIM.tabA, tb = SIM.tabB, [na, nb] = simNomes();
  const linhas = ex.jun.map(j => { const a = Math.abs(simPico(ta, j).tau[j]), b = Math.abs(simPico(tb, j).tau[j]), dif = a > 1 ? (b - a) / a * 100 : 0;
    return `<tr><td><span class="dot" style="background:${JS[j].cor}"></span>${(ex.jn && ex.jn[j]) || JS[j].n}</td><td>${f1(a, 0)}</td><td>${f1(b, 0)}</td><td style="color:${Math.abs(dif) < 5 ? 'var(--ink3)' : dif > 0 ? '#ff8a3d' : '#3fd8cb'}">${Math.abs(dif) < 5 ? '≈' : (dif > 0 ? '+' : '') + Math.round(dif) + '%'}</td></tr>`; }).join('');
  const pk = (T, id) => Math.max(...T.map(r => Math.min(r.ef[id].p, 100)));
  const mus = ex.un.map(id => [id, pk(ta, id), pk(tb, id)]).filter(([, a, b]) => Math.max(a, b) >= 5).sort((x, y) => Math.abs(y[2] - y[1]) - Math.abs(x[2] - x[1])).slice(0, 4)
    .map(([id, a, b]) => `<tr><td>${esc(US[id].n)}</td><td>${Math.round(a)}%</td><td>${Math.round(b)}%</td><td style="color:${Math.abs(b - a) < 3 ? 'var(--ink3)' : b > a ? '#ff8a3d' : '#3fd8cb'}">${Math.abs(b - a) < 3 ? '≈' : (b > a ? '+' : '') + Math.round(b - a) + ' pts'}</td></tr>`).join('');
  const modo = simAbModo(ex);
  if (c.own && SIM.mudou !== true) return `<div class="smcmp"><div class="smcmp-h"><b>${esc(c.t)}</b><button data-m="sairCmp" class="smx" aria-label="Fechar a comparação">✕</button></div>
    <div class="smab" id="smAB"><button data-ab="A" class="${SIM.lado === 'A' ? 'on' : ''}" style="--c:${COR_A}"><i>A</i><span>${esc(na)}</span></button><button data-ab="B" class="${SIM.lado === 'B' ? 'on' : ''}" style="--c:${COR_B}"><i>B</i><span>${esc(nb)}</span></button></div>
    <small class="smab-d"><b>A</b> guardou a configuração atual. Agora mude a <b style="color:${COR_B}">versão B</b>: troque a variação ou mexa em um controle abaixo (carga, amplitude…). A comparação aparece aqui assim que as duas ficarem diferentes.</small></div>`;
  return `<div class="smcmp"><div class="smcmp-h"><b>${esc(c.t)}</b><button data-m="sairCmp" class="smx" aria-label="Fechar a comparação">✕</button></div>
    <div class="smab" id="smAB"><button data-ab="A" class="${SIM.lado === 'A' ? 'on' : ''}" style="--c:${COR_A}"><i>A</i><span>${esc(na)}</span></button><button data-ab="B" class="${SIM.lado === 'B' ? 'on' : ''}" style="--c:${COR_B}"><i>B</i><span>${esc(nb)}</span></button></div>
    <small class="smab-d">${c.own && SIM.mudou !== true ? 'Toque em <b>B</b>, mude a variação ou os controles abaixo e compare. Os controles mexem na versão marcada; o modelo 3D mostra essa versão.' : 'Os controles abaixo mexem na versão marcada, e o modelo 3D mostra essa versão. As duas figuras andam juntas na mesma fase do movimento.'}</small>
    <div class="smfig"><canvas id="smAB2" aria-label="As duas versões lado a lado, na mesma fase do movimento"></canvas>
      <div class="seg smfig-m"><button data-abm="lado" class="${modo === 'lado' ? 'on' : ''}">Lado a lado</button><button data-abm="sob" class="${modo === 'sob' ? 'on' : ''}">Sobrepostas</button><span>círculos = torque · ${modo === 'sob' ? 'B tracejado' : 'mesma fase'}</span></div></div>
    <div id="smABt"></div>
    <table class="ac mt"><tr><th>Pico de torque (N·m)</th><th style="color:${COR_A}">A</th><th style="color:${COR_B}">B</th><th>B × A</th></tr>${linhas}</table>
    ${mus ? `<table class="ac mt"><tr><th>Pico de esforço</th><th style="color:${COR_A}">A</th><th style="color:${COR_B}">B</th><th>B × A</th></tr>${mus}</table>` : ''}${c.txt ? `<p style="font-size:13px;margin:8px 0 0">${esc(c.txt)}</p>` : ''}</div>`;
}
const _ptI = (T, k) => { const x = lim(k, 0, 1) * 40, i = Math.min(39, Math.floor(x)), f = x - i, a = T[i].pts, b = T[i + 1].pts, o = {};
  for (const key of Object.keys(a)) { const u = a[key], v = b[key]; o[key] = typeof u === 'number' ? u + (v - u) * f : u && v ? { y: u.y + (v.y - u.y) * f, z: u.z + (v.z - u.z) * f } : u; } return o; };
const _tauI = (T, k, j) => { const x = lim(k, 0, 1) * 40, i = Math.min(39, Math.floor(x)), f = x - i; return T[i].tau[j] + (T[i + 1].tau[j] - T[i].tau[j]) * f; };
function simAB2() {   // as duas versões desenhadas de lado, na mesma fase do movimento, com o torque de cada articulação em círculos
  const cv = $('smAB2'), c = SIM.cmp; if (!cv || !c || !SIM.tabA || !SIM.tabB) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const ex = EX_S[c.ex], k = POSE.S.k, modo = simAbModo(ex), lados = [[SIM.tabA, COR_A, 'A', SIM.opA], [SIM.tabB, COR_B, 'B', SIM.opB]];
  // escala fixa: tudo o que as duas figuras ocupam ao longo do movimento
  if (!SIM.abBox || SIM.abBox.ref !== SIM.tabA.length + ':' + SIM.tabA[0].x + ':' + SIM.tabB[0].x + ':' + SIM.tabA[40].x + ':' + SIM.tabB[40].x) {
    let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [T, , , op] of lados) for (const r of T) for (const [key, p] of Object.entries(r.pts)) { if (!p || typeof p !== 'object') continue; const rr = key === 'bar' && !ex.cabo && op.carga > 0 ? 0.225 : key === 'ore' ? 0.1 : 0.02; y0 = Math.min(y0, p.y - rr); y1 = Math.max(y1, p.y + rr); z0 = Math.min(z0, p.z - rr); z1 = Math.max(z1, p.z + rr); }
    y0 = Math.min(y0, SIM.tabA[0].pts.chao); SIM.abBox = { y0, y1, z0, z1, ref: SIM.tabA.length + ':' + SIM.tabA[0].x + ':' + SIM.tabB[0].x + ':' + SIM.tabA[40].x + ':' + SIM.tabB[40].x };
  }
  const bx = SIM.abBox, n = modo === 'lado' ? 2 : 1, pad = 10, cw = (w - pad * (n + 1)) / n, ch = h - 2 * pad - 8;
  const sc = Math.min(cw / (bx.z1 - bx.z0), ch / (bx.y1 - bx.y0));
  const mxT = Math.max(20, ...lados.flatMap(([T]) => T.flatMap(r => ex.jun.map(j => Math.abs(r.tau[j])))));
  lados.forEach(([T, cor, nome, op], i) => {
    const ox = modo === 'lado' ? pad + i * (cw + pad) : pad, P = _ptI(T, k), X = p => ox + (cw - (bx.z1 - bx.z0) * sc) / 2 + (p.z - bx.z0) * sc, Y = p => pad + ch - (p.y - bx.y0) * sc;
    const tr = modo === 'sob' && i === 1;
    if (!tr || modo === 'lado') { x.strokeStyle = '#2a3a5c'; x.lineWidth = 1; x.beginPath(); x.moveTo(ox, Y({ y: P.chao })); x.lineTo(ox + cw, Y({ y: P.chao })); x.stroke(); }
    if (modo === 'lado') { x.fillStyle = cor; x.font = '700 12px Instrument Sans, sans-serif'; x.textAlign = 'left'; x.fillText(nome, ox + 2, pad + 10); }
    // equipamento
    x.setLineDash([]);
    if (P.C) { x.fillStyle = '#4a5b8055'; const zC = X(P.C), yC = Y(P.C); x.fillRect(zC - 0.34 * sc, yC + 2, 0.34 * sc, Y({ y: P.chao }) - yC - 2); }
    if (P.pol) { x.strokeStyle = '#ffd43b99'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(X(P.bar), Y(P.bar)); x.lineTo(X(P.pol), Y(P.pol)); x.stroke(); }
    if (!ex.cabo && op.carga > 0) { x.strokeStyle = cor + '66'; x.fillStyle = cor + '14'; x.lineWidth = 1; x.beginPath(); x.arc(X(P.bar), Y(P.bar), 0.225 * sc, 0, 7); x.fill(); x.stroke(); }
    // corpo
    x.strokeStyle = cor; x.lineCap = 'round'; x.lineJoin = 'round'; if (tr) x.setLineDash([5, 4]);
    const seg = (pts, lw) => { x.lineWidth = lw; x.beginPath(); pts.forEach((p, q) => q ? x.lineTo(X(p), Y(p)) : x.moveTo(X(p), Y(p))); x.stroke(); };
    seg([P.Ca, P.A, P.K, P.H], 3); seg([P.Ca, P.T], 2.2); seg([P.H, P.L5, P.Sh], 4); seg([P.Sh, P.E, P.G], 2.4);
    x.beginPath(); x.arc(X(P.ore), Y(P.ore), 0.095 * sc, 0, 7); x.lineWidth = 2.2; x.stroke(); x.setLineDash([]);
    x.fillStyle = cor; x.beginPath(); x.arc(X(P.bar), Y(P.bar), Math.max(3, 0.02 * sc), 0, 7); x.fill();
    // torque em cada articulação: círculo proporcional
    const Jp = { qua: P.H, joe: P.K, tor: P.A, lom: P.L5, omb: P.Sh, oma: P.Sh, cot: P.E };
    for (const j of ex.jun) { const t = Math.abs(_tauI(T, k, j)), p = Jp[j]; if (!p || t < 0.08 * mxT) continue; const r = 2.5 + 9 * Math.sqrt(t / mxT);
      x.fillStyle = JS[j].cor + (tr ? '30' : '55'); x.strokeStyle = JS[j].cor; x.lineWidth = 1.2; if (tr) x.setLineDash([3, 3]); x.beginPath(); x.arc(X(p) + (modo === 'sob' ? (i ? 4 : -4) : 0), Y(p), r, 0, 7); x.fill(); x.stroke(); x.setLineDash([]); }
  });
  x.fillStyle = '#7b88a6'; x.font = '11px Instrument Sans, sans-serif'; x.textAlign = 'right';
  x.fillText(`${Math.round(k * 100)}% do movimento`, w - 8, 16);
  // barras de A e B na fase atual
  const el = $('smABt'); if (!el) return;
  el.innerHTML = ex.jun.map(j => { const a = Math.abs(_tauI(SIM.tabA, k, j)), b = Math.abs(_tauI(SIM.tabB, k, j)), dif = (b - a) / Math.max(a, 1e-6) * 100, J = JS[j], peq = a < 0.15 * mxT;
    const txt = Math.abs(b - a) < 3 || (!peq && Math.abs(dif) < 5) ? 'B ≈ A' : peq ? `B ${b > a ? '+' : '−'}${f1(Math.abs(b - a), 0)} N·m` : `B ${dif > 0 ? '+' : ''}${Math.round(dif)}%`;
    return `<div class="smbar"><div class="smbar-t"><span><i style="background:${J.cor}"></i>${(ex.jn && ex.jn[j]) || J.n}</span><b style="color:${txt === 'B ≈ A' ? 'var(--ink3)' : b > a ? '#ff8a3d' : '#3fd8cb'}">${txt}</b></div>
      <div class="smbar-l"><em style="color:${COR_A}">A</em><div><i style="width:${a / mxT * 100}%;background:${COR_A}"></i></div><small>${f1(a, 0)} N·m</small></div>
      <div class="smbar-l"><em style="color:${COR_B}">B</em><div><i style="width:${b / mxT * 100}%;background:${COR_B}"></i></div><small>${f1(b, 0)} N·m</small></div></div>`; }).join('');
}
function simRecalc() { SIM.tab = simTabela(EX_S[SIM.ex], SIM.op); if (SIM.cmp) { SIM['tab' + SIM.lado] = SIM.tab; SIM.abBox = null; } }
function simPrepCmp(c, ex) {   // as duas versões da comparação: opções e tabelas
  SIM.cmp = c; SIM.lado = 'A'; SIM.opA = { ...ex.op0, ...(c.opA || {}), ...c.a[1] }; SIM.opB = { ...ex.op0, ...(c.opB || {}), ...c.b[1] }; SIM.abBox = null;
  if (c.ex === 'agachamento') for (const o of [SIM.opA, SIM.opB]) if (!SIM.B[o.v]) simBracosCM();
  SIM.tabB = simTabela(ex, SIM.opB); SIM.op = SIM.opA;
}
async function mostrarSim(id = SIM.ex, cmp = null) {
  if (!EX_S[id]) id = 'agachamento';
  await peleProntaToast(); limparDesvio(); movAtivo = { id: 'sim' }; isolado = null; filtroInsercao = null;
  if (!visCamada.musculos) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on'); }
  const novoEx = SIM.ex !== id || !SIM.op; SIM.ex = id; const ex = EX_S[id]; simBase(); simPrepararG();
  if (cmp) simPrepCmp(cmp, ex);
  else { SIM.cmp = null; if (novoEx) SIM.op = { ...ex.op0 }; }
  if (id === 'agachamento' && !SIM.B[SIM.op.v]) simBracosCM();
  simRecalc();
  simCorPrep(ex); SIM.on = true; SIM.g.visible = true;
  POSE.iniciar({}, [], [], { gen: k => simDef(ex.pose(k, SIM.op)), rot: () => { if (!SIM.on) return []; const e = EX_S[SIM.ex]; SIM.ult = simMedir(POSE.S.M, e, SIM.op, e.cabo ? e.pose(POSE.S.k, SIM.op).ang : null); return simRotulos(SIM.ult); }, todos: true });
  POSE.S.aoMudar = () => simAtualizar();
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.toggle('on', b.dataset.r === 'movimento'));
  aplicarVis(); destacar(null); simPainel(); enquadrarP(ex.quadro || 'corpo', ex.vista ? ex.vista(SIM.op) : 'lat');
  POSE.aplicar(0); POSE.animar(1, true, ex.dur);
}
function simBracosCM() {   // centro de massa dos braços segurando a barra (em relação ao tronco, em pé), medido no modelo
  for (const v of Object.keys(BRACOS_S)) {
    const op = { ...EX_S.agachamento.op0, v }, p = { L: { d: { ...BRACOS_S[v] }, e: { ...BRACOS_S[v] } }, c: {} };
    const [r] = POSE.medir([simDef(p)], M => { const S = POSE.S, P = (vv, sg) => vv.clone().applyMatrix4(M[sg]); let y = 0, z = 0, m = 0;
      for (const l of ['d', 'e']) for (const [mm, pt] of [[MW.braco, P(S.Hh[l].clone().lerp(S.Co[l], 0.436), 'umero' + l)], [MW.antebraco, P(S.Co[l].clone().lerp(S.Wr[l], 0.43), 'ulna' + l)], [MW.mao, P(S.Wr[l].clone().add(_gp), 'mao' + l)]]) { y += mm * pt.y; z += mm * pt.z; m += mm; }
      return { y: y / m, z: z / m }; });
    SIM.B[v] = r;
  }
}
function simPainel() {
  const ex = EX_S[SIM.ex], op = SIM.op;
  painelP('Simulador de exercícios', `<span class="tag">biomecânica</span>${esc(ex.nome)}`, `
    <div class="acoes" style="margin:0 0 8px"><button id="bVoltaM">← Movimentos</button></div>
    <div class="seg" id="smEx">${ORD_S.map(k => [k, EX_S[k]]).map(([k, e]) => `<button data-ex="${k}" class="${k === SIM.ex ? 'on' : ''}">${esc(e.curto)}</button>`).join('')}</div>
    <div id="smCmp">${simCompHTML()}</div>${SIM.cmp ? '' : '<button class="smnova" id="smNova"><b>⇄ Comparar A × B</b><small>Duas versões deste exercício lado a lado, na mesma fase do movimento</small></button>'}
    <div class="seg" id="smV" style="margin-top:8px">${ex.vars.map(([k, t]) => `<button data-v="${k}" class="${op[ex.chave] === k ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
    <div class="pctl" style="margin-top:10px"><div class="pctl-t"><span>Amplitude do movimento</span><output id="smK">0%</output></div>
      <input id="smKs" type="range" min="0" max="100" step="1" value="0" aria-label="Amplitude do movimento">
      <div class="seg"><button data-k="0">Início</button><button data-k="1">Fim</button><button id="smPlay" class="on">❚❚ Pausar</button></div></div>
    <div class="kp mt4" id="smAng"></div>
    ${ex.ctl.map(([k, t, a, b, st, u]) => `<div class="mv-ctl"><span>${esc(t)}</span><output id="smo_${k}">${op[k]}${u === '°' ? '°' : ' ' + u}</output><input type="range" data-c="${k}"${k === 'lat' ? ' id="smLatS"' : ''} min="${a}" max="${b}" step="${st}" value="${op[k]}"></div>`).join('')}
    ${ex.cabo ? `<div class="seg" id="smLat">${[['auto', 'Automática (menor esforço)'], ['zero', 'Sem força lateral'], ['manual', 'Manual']].map(([k, t]) => `<button data-lat="${k}" class="${op.latModo === k ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
    <h3>Torque em cada articulação</h3><div id="smT"></div>
    ${ex.junE ? '<h3>Escápula <small style="font-weight:500;text-transform:none;letter-spacing:0">· estimativa aproximada</small></h3><div id="smTe"></div>' : ''}
    <h3>Esforço dos músculos</h3>
    <div class="leg" style="margin:2px 0 4px"><span><i style="background:linear-gradient(90deg,#33415c,#ffd43b,#ff8a3d,#ff3b5c);width:46px"></i>pouco → muito esforço</span>${ex.est.length ? '<span><i style="background:#3fd8cb"></i>estabilizadores</span>' : ''}</div>
    <div id="smE"></div>
    ${ex.est.length ? `<div class="pleg"><b style="color:#3fd8cb"><i style="background:#3fd8cb"></i>Estabilizadores</b><span>${esc(ex.estT)}</span></div>` : ''}
    <h3>Ao longo do movimento</h3>
    <div class="abas" id="smGa"><button data-g="tor" class="${SIM.graf === 'tor' ? 'on' : ''}">Torque</button><button data-g="esf" class="${SIM.graf === 'esf' ? 'on' : ''}">Esforço</button><button data-g="comp" class="${SIM.graf === 'comp' ? 'on' : ''}">Comprimento</button></div>
    <div class="leg" id="smGl"></div>
    <canvas id="smG" style="width:100%;height:180px;display:block;margin-top:6px"></canvas>
    <h3>Comparações prontas</h3><div class="lista">${COMP_S.map((c, i) => c.ex === SIM.ex ? `<button data-cmp="${i}"><i style="background:#f7b84b"></i><span class="lnome">${esc(c.t)}</span><span class="pl" style="color:#f7b84b">ver no simulador</span></button>` : '').join('')}</div>
    <h3>Como ler</h3>
    ${ex.ler || `    <p>No modelo, a <b style="color:#ffd43b">linha amarela</b> desce da barra até o chão. Cada articulação tem uma <b>alavanca colorida</b>: a linha horizontal vai da articulação até a linha vertical do peso que está acima dela (corpo e barra). O comprimento dessa linha é o <b>braço de momento</b>, e peso × braço de momento é o <b>torque</b> que os músculos precisam vencer.</p>
    <p>O <b style="color:#3fd8cb">anel verde-água</b> no chão marca o centro de massa do corpo com a barra. Para ficar em equilíbrio, ele precisa ficar sobre o meio do pé.</p>`}
    <p><b>Esforço:</b> o torque de cada articulação é dividido entre os músculos que podem vencê-lo, de acordo com o tamanho (área de secção) e o braço de momento de cada um. A porcentagem é a força estimada em relação à força máxima daquele músculo. As cores no modelo seguem a mesma escala.</p>
    <p><b>Comprimento:</b> mostra se o músculo está alongado ou encurtado em relação à posição anatômica. Músculos que cruzam duas articulações (isquiotibiais, reto femoral e gastrocnêmio) podem mudar pouco de comprimento, porque uma articulação alonga e a outra encurta.</p>
    <div class="aviso">Estimativa didática, não é medida de laboratório: modelo quase estático (sem aceleração) no plano sagital, com o corpo dividido em segmentos rígidos, massas e centros de massa pelas proporções de Winter, braços de momento médios da literatura e força máxima de cada músculo ajustada para o torque máximo típico de cada grupo num adulto treinado (corrigido pela massa corporal). Não inclui co-contração, tendões, ligamentos nem a pressão dentro do abdômen. Na remada, o tronco fica parado no ângulo escolhido, o antebraço fica quase na vertical, a canela fica quase vertical e o quadril se ajusta para o centro de massa continuar sobre o meio do pé.${ex.aviso ? ' ' + esc(ex.aviso) : ''}</div>
    <h3>Em breve no simulador</h3><p class="pnota">${PROX_S.map(esc).join(' · ')}</p>
    <div class="fontes">Fontes: Winter. Biomechanics and Motor Control of Human Movement · Neumann. Cinesiologia do aparelho musculoesquelético · Wretenberg, Feng e Arborelius (1996), Med Sci Sports Exerc: agachamento com barra alta e barra baixa · Escamilla (2001), Med Sci Sports Exerc: biomecânica do joelho no agachamento · Fry, Smith e Schilling (2003), J Strength Cond Res · Gullett et al. (2009), J Strength Cond Res: agachamento frontal e de costas · Fenwick, Brown e McGill (2009), J Strength Cond Res: remadas e carga na coluna · Németh e Ohlsén (1985), J Biomech: braços de momento dos extensores do quadril · Ward et al. (2009), Clin Orthop Relat Res: arquitetura dos músculos do membro inferior · Holzbaur et al. (2007), J Biomech: arquitetura dos músculos do membro superior · Ackland et al. (2008), J Anat: braços de momento dos músculos do ombro · Signorile, Zink e Szwed (2002) e Lusk, Hale e Russell (2010), J Strength Cond Res: pegadas na puxada · Crowninshield e Brand (1981), J Biomech: divisão da força entre os músculos · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  const ex2 = ex, pB = $('pB');
  const play = on => { const b = $('smPlay'); if (!b) return; b.classList.toggle('on', on); b.textContent = on ? '❚❚ Pausar' : '▶ Reproduzir'; on ? POSE.animar(POSE.S.k > 0.5 ? 0 : 1, true, ex2.dur) : POSE.parar(); };
  const refazer = (manterK = true) => { const k = POSE.S.k; simRecalc(); POSE.aplicar(manterK ? k : 0, true); if (SIM.cmp) { SIM.mudou = true; $('smCmp').innerHTML = simCompHTML(); simAB2(); } };
  pB.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'bVoltaM') return listaMov('ex');
    if (b.dataset.ex) { if (b.dataset.ex !== SIM.ex) mostrarSim(b.dataset.ex); return; }
    if (b.dataset.cmp) { const c = COMP_S[+b.dataset.cmp]; mostrarSim(c.ex, c); return; }
    if (b.dataset.m === 'sairCmp') { const k = POSE.S.k; SIM.cmp = null; simPainel(); POSE.aplicar(k, true); return; }
    if (b.id === 'smNova') { const k = POSE.S.k; SIM.cmp = { ex: SIM.ex, t: 'Sua comparação', a: ['A', {}], b: ['B', {}], txt: '', own: true }; SIM.opA = { ...SIM.op }; SIM.opB = { ...SIM.op }; SIM.tabA = SIM.tab; SIM.tabB = SIM.tab; SIM.abBox = null; SIM.mudou = false; SIM.lado = 'B'; SIM.op = SIM.opB; simPainel(); POSE.aplicar(k, true); return; }
    if (b.dataset.abm) { SIM.abModo = b.dataset.abm; pB.querySelectorAll('[data-abm]').forEach(x => x.classList.toggle('on', x === b)); simAB2(); return; }
    if (b.dataset.ab) { const k = POSE.S.k; SIM.lado = b.dataset.ab; SIM.op = SIM['op' + SIM.lado]; SIM.tab = SIM['tab' + SIM.lado]; if (SIM.ex === 'agachamento' && !SIM.B[SIM.op.v]) simBracosCM(); simPainel(); POSE.aplicar(k, true); if (ex2.vista) enquadrarP(ex2.quadro || 'corpo', ex2.vista(SIM.op)); return; }
    if (b.dataset.v) { SIM.op[ex2.chave] = b.dataset.v; if (SIM.ex === 'agachamento' && !SIM.B[b.dataset.v]) simBracosCM(); pB.querySelectorAll('#smV button').forEach(x => x.classList.toggle('on', x === b)); refazer(); if (ex2.vista) enquadrarP(ex2.quadro || 'corpo', ex2.vista(SIM.op)); return; }
    if (b.dataset.lat) { SIM.op.latModo = b.dataset.lat; pB.querySelectorAll('#smLat button').forEach(x => x.classList.toggle('on', x === b)); refazer(); return; }
    if (b.dataset.g) { SIM.graf = b.dataset.g; pB.querySelectorAll('#smGa button').forEach(x => x.classList.toggle('on', x === b)); simGraf(); return; }
    if (b.id === 'smPlay') return play(!b.classList.contains('on'));
    if (b.dataset.k !== undefined) { play(false); POSE.animar(+b.dataset.k); }
  };
  pB.oninput = ev => {
    const r = ev.target; if (r.type !== 'range') return;
    if (r.id === 'smKs') { play(false); POSE.aplicar(r.value / 100, false); return; }
    const c = r.dataset.c; if (!c) return; SIM.op[c] = +r.value; const it = ex2.ctl.find(x => x[0] === c); $('smo_' + c).textContent = r.value + (it[5] === '°' ? '°' : ' ' + it[5]);
    if (c === 'lat') { SIM.op.latModo = 'manual'; pB.querySelectorAll('#smLat button').forEach(x => x.classList.toggle('on', x.dataset.lat === 'manual')); }
    clearTimeout(SIM.hRe); SIM.hRe = setTimeout(() => refazer(), 60);
  };
  pB.onchange = ev => { if (ev.target.id === 'smKs') POSE.aplicar(ev.target.value / 100, true); };
  simAtualizar();
}

/* ---------- tecidos: tendões, cartilagens e fáscias ---------- */
// Os textos ficam no cofre privado (tecidos.json). Aqui: o que aparece no 3D e as ilustrações.
const TEC = { pint: [], esc: [], on: false, tema: 'tendoes', item: null, txt: null, g: null, cart: null, env: {}, ghost: [], junta: 'joelho' };
const COR_TEC = { tendoes: '#f2c879', cartilagens: '#8fd3ff', fascias: '#dbe8f7' };
const COR_TIPO = { hialina: '#8fd3ff', elastica: '#ffe066', fibro: '#c9a7ff', nucleo: '#63e6be' };
const COSTAIS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].map(n => `Costal cartilage of ${n} rib`);
const NIVEIS_D = ['C2-C3', 'C3-C4', 'C4-C5', 'C5-C6', 'C6-C7', 'C7-T1', 'T1-T2', 'T2-T3', 'T3-T4', 'T4-T5', 'T5-T6', 'T6-T7', 'T7-T8', 'T8-T9', 'T9-T10', 'T10-T11', 'T11-T12', 'T12-L1', 'L1-L2', 'L2-L3', 'L3-L4', 'L4-L5', 'L5-S1'];
const COXA_M = ['Rectus femoris muscle', 'Vastus lateralis muscle', 'Vastus medialis muscle', 'Sartorius muscle', 'Gracilis muscle', 'Adductor longus', 'Adductor magnus', 'Long head of biceps femoris', 'Short head of biceps femoris', 'Semitendinosus muscle', 'Semimembranosus muscle'];
// itens de cada tema: b = estruturas destacadas (base do nome), ctx = músculos em volta (translúcidos), cores por tipo, gerar = desenhado aqui
const ITENS_TEC = {
  tendoes: [
    { id: 'calcaneo', b: ['Calcaneal tendon'], ctx: ['Soleus muscle', 'Medial head of gastrocnemius', 'Lateral head of gastrocnemius'], dir: [-0.85, 0.12, -0.55] },
    { id: 'patelar', b: ['Patellar ligament', 'Quadriceps femoris muscle'], cam: ['insercoes'], ctx: ['Rectus femoris muscle', 'Vastus lateralis muscle', 'Vastus medialis muscle', 'Vastus intermedius muscle'], dir: [-0.75, 0.15, 0.7], foco: ['Patella'] },
    { id: 'epicondilos', b: ['Common extensor tendon', 'Common flexor tendon'], cam: ['insercoes'], cores: { 'Common extensor tendon': '#f2c879', 'Common flexor tendon': '#ff9f43' }, ctx: ['Extensor carpi radialis brevis', 'Extensor digitorum', 'Flexor carpi radialis', 'Palmaris longus muscle', 'Superficial head of pronator teres'], dir: [-0.15, 0.25, 1], mult: 4 },
    { id: 'extdedos', b: ['Tendon of extensor digitorum longus'], ctx: ['Extensor digitorum longus'], dir: [-0.55, 0.6, 0.7] },
    { id: 'enteses', insercoes: true, dir: [-0.6, 0.2, 1] },
  ],
  cartilagens: [
    { id: 'articular', gerar: 'cart', tipo: 'hialina' },
    { id: 'costais', b: COSTAIS, tipo: 'hialina', dir: [-0.25, 0.15, 1] },
    { id: 'laringe', b: ['Thyroid cartilage', 'Cricoid cartilage', 'Arytenoid cartilage', 'Corniculate cartilage'], cores: { 'Corniculate cartilage': COR_TIPO.elastica }, tipo: 'hialina', dir: [-0.55, 0.15, 1] },
    { id: 'nariz', b: ['Nasal septal cartilage', 'Lateral process of nasal septal cartilage', 'Major alar cartilage'], tipo: 'hialina', dir: [-0.7, 0.1, 1] },
    { id: 'meniscos', b: ['Medial meniscus', 'Lateral meniscus'], cam: ['articulacoes'], esconder: ['Femur', 'Patella'], tipo: 'fibro', dir: [-0.3, 1.3, 0.75], mult: 1.6 },
    { id: 'discos', b: [...NIVEIS_D.map(n => 'Intervertebral disc ' + n), ...NIVEIS_D.map(n => 'Nucleus pulposus ' + n)], cam: ['articulacoes'], cores: Object.fromEntries(NIVEIS_D.map(n => ['Nucleus pulposus ' + n, COR_TIPO.nucleo])), vidro: NIVEIS_D.map(n => 'Intervertebral disc ' + n), foco: ['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5', 'L5-S1'].map(n => 'Intervertebral disc ' + n), tipo: 'fibro', dir: [-1, 0.12, 0.3], mult: 1.6 },
    { id: 'labio_ombro', b: ['Glenoid labrum'], cam: ['articulacoes'], esconder: ['Humerus'], tipo: 'fibro', dir: [-1, 0.2, 0.25], mult: 4 },
    { id: 'labio_quadril', b: ['Acetabular labrum'], cam: ['articulacoes'], esconder: ['Femur'], tipo: 'fibro', dir: [-1, 0.15, 0.3], mult: 2.6 },
    { id: 'sinfise', b: ['Interpubic disc', 'Pubic symphysis'], cam: ['articulacoes'], tipo: 'fibro', dir: [-0.2, 0.15, 1], mult: 4 },
    { id: 'atm', b: ['Articular disc of temporomandibular joint'], cam: ['articulacoes'], esconder: ['Mandible'], tipo: 'fibro', dir: [-1, 0.1, 0.25], mult: 5 },
  ],
  fascias: [
    { id: 'lata', gerar: 'lata', b: ['Iliotibial tract'], dir: [-1, 0.15, 0.55], mult: 0.95 },
    { id: 'it', b: ['Iliotibial tract'], ctx: ['Gluteus maximus muscle', 'Gluteus medius muscle'], dir: [-1, 0.12, 0.2] },
    { id: 'plantar', b: ['Plantar aponeurosis'], dir: [-1, -0.45, 0.35], mult: 1.5 },
    { id: 'palmar', b: ['Palmar aponeurosis'], dir: [-0.6, 0.2, 1] },
    { id: 'alba', b: ['Linea alba'], ctx: ['Rectus abdominis muscle', 'External abdominal oblique muscle'], op: 0.7, dir: [-0.2, 0.1, 1] },
    { id: 'galea', b: ['Epicranial aponeurosis'], ctx: ['Frontalis muscle', 'Occipitalis muscle'], dir: [-0.8, 0.5, 0.6] },
    { id: 'epimisio', gerar: 'epi', ctx: ['Long head of biceps brachii', 'Short head of biceps brachii'], lado: 'direito', dir: [-0.7, 0.15, 1] },
    { id: 'toracolombar', b: ['Latissimus dorsi muscle', 'Gluteus maximus muscle'], cores: { 'Latissimus dorsi muscle': '#4dabf7', 'Gluteus maximus muscle': '#ff5d73' }, cruzado: true, dir: [0.1, 0.1, -1] },
  ],
};
// articulações da cartilagem desenhada: pares de ossos (a superfície de cada um que fica de frente para o outro)
const JUNTAS_C = {
  joelho: { n: 'Joelho', pares: [['Femur', 'Tibia'], ['Femur', 'Patella']], foco: ['Patella', 'Femur'], fz: 0.25, dir: [-0.75, 0.35, 0.9] },
  quadril: { n: 'Quadril', pares: [['Femur', 'Hip bone']], foco: ['Femur'], fy: 0.95, dir: [-1, 0.2, 0.45] },
  ombro: { n: 'Ombro', pares: [['Humerus', 'Scapula'], ['Clavicle', 'Scapula']], foco: ['Humerus'], fy: 0.88, dir: [-0.9, 0.3, 0.9] },
  cotovelo: { n: 'Cotovelo', pares: [['Humerus', 'Ulna'], ['Humerus', 'Radius'], ['Radius', 'Ulna']], foco: ['Humerus'], fy: 0.06, dir: [-0.6, 0.25, 1] },
  tornozelo: { n: 'Tornozelo', pares: [['Tibia', 'Talus'], ['Fibula', 'Talus'], ['Talus', 'Calcaneus'], ['Talus', 'Navicular bone']], foco: ['Talus'], dir: [-0.9, 0.3, 0.6] },
};
const malhasDe = (bases, lado) => { const s = new Set(bases), outro = lado === 'direito' ? 'esquerdo' : 'direito'; return Object.keys(E).filter(n => s.has(E[n].b) && MESH[n] && (!lado || E[n].l !== outro)); };

// ---- geometria: casca de cartilagem nas superfícies de contato e envoltório de fáscia sobre os músculos ----
function verticesMundo(m) {
  const p = m.geometry.attributes.position, out = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  return out;
}
function normaisMundo(m) {
  const g = m.geometry.clone(); g.deleteAttribute('normal'); g.computeVertexNormals();
  const n = g.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld), out = new Float32Array(n.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) { v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  g.dispose(); return out;
}
function grade(P, h) { const G = new Map(); for (let i = 0; i < P.length / 3; i++) { const k = `${Math.floor(P[i * 3] / h)},${Math.floor(P[i * 3 + 1] / h)},${Math.floor(P[i * 3 + 2] / h)}`; let a = G.get(k); if (!a) G.set(k, a = []); a.push(i); } return G; }
function maisPerto(G, P, h, x, y, z) {
  const cx = Math.floor(x / h), cy = Math.floor(y / h), cz = Math.floor(z / h); let best = Infinity, bi = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const L = G.get(`${cx + a},${cy + b},${cz + c}`); if (!L) continue;
    for (const i of L) { const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2 + (P[i * 3 + 2] - z) ** 2; if (d < best) { best = d; bi = i; } }
  }
  return [Math.sqrt(best), bi];
}
// triângulos do osso A que ficam de frente para o osso B (perto, ou um pouco mais longe mas virados para ele): viram uma casca de 2 mm
function cascaContato(A, B, perto = 0.009, longe = 0.022, esp = 0.0013) {
  const PA = verticesMundo(A), NA = normaisMundo(A), PB = verticesMundo(B), G = grade(PB, longe), n = PA.length / 3, sel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = PA[i * 3], y = PA[i * 3 + 1], z = PA[i * 3 + 2], [d, j] = maisPerto(G, PB, longe, x, y, z);
    if (j < 0) continue;
    if (d < perto) { sel[i] = 1; continue; }
    if (d < longe) { const dx = (PB[j * 3] - x) / d, dy = (PB[j * 3 + 1] - y) / d, dz = (PB[j * 3 + 2] - z) / d; if (NA[i * 3] * dx + NA[i * 3 + 1] * dy + NA[i * 3 + 2] * dz > 0.55) sel[i] = 1; }
  }
  const idx = A.geometry.index ? A.geometry.index.array : [...Array(n).keys()], pos = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (sel[a] + sel[b] + sel[c] < 3) continue;
    for (const v of [a, b, c]) pos.push(PA[v * 3] + NA[v * 3] * esp, PA[v * 3 + 1] + NA[v * 3 + 1] * esp, PA[v * 3 + 2] + NA[v * 3 + 2] * esp);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
function envoltorio(m, esp) {   // a mesma superfície do músculo, empurrada para fora: representa a fáscia em volta dele
  const P = verticesMundo(m), N = normaisMundo(m), n = P.length / 3, pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = P[i] + N[i] * esp;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (m.geometry.index) g.setIndex(m.geometry.index.clone()); g.computeVertexNormals(); return g;
}
function tecG() {
  if (TEC.g) return TEC.g;
  TEC.g = new THREE.Group(); TEC.g.visible = false; scene.add(TEC.g);
  TEC.matCart = new THREE.MeshStandardMaterial({ color: '#9fdcff', emissive: '#12324a', roughness: 0.18, metalness: 0, transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -2 });
  TEC.matFasc = new THREE.MeshStandardMaterial({ color: '#eef5ff', emissive: '#2a3a55', roughness: 0.35, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  return TEC.g;
}
function tecCartilagem() {   // desenha uma vez, para os dois lados
  if (TEC.cart) return TEC.cart; tecG(); scene.updateMatrixWorld(true);
  TEC.cart = {};
  for (const [k, J] of Object.entries(JUNTAS_C)) {
    const grupo = new THREE.Group(); grupo.visible = false; TEC.g.add(grupo); TEC.cart[k] = grupo;
    for (const l of ['direito', 'esquerdo']) for (const [a, b] of J.pares) {
      const [ma] = malhasDe([a], l), [mb] = malhasDe([b], l); if (!ma || !mb) continue;
      for (const [x, y] of [[ma, mb], [mb, ma]]) { const g = cascaContato(MESH[x], MESH[y]); if (g) { const me = new THREE.Mesh(g, TEC.matCart); me.userData.lado = l; grupo.add(me); } }
    }
  }
  return TEC.cart;
}
function tecEnvoltorio(id, bases, esp, lado) {
  if (TEC.env[id]) return TEC.env[id]; tecG(); scene.updateMatrixWorld(true);
  const grupo = new THREE.Group(); grupo.visible = false; TEC.g.add(grupo); TEC.env[id] = grupo;
  for (const n of malhasDe(bases, lado)) { const me = new THREE.Mesh(envoltorio(MESH[n], esp), TEC.matFasc); me.renderOrder = 5; grupo.add(me); }
  return grupo;
}

// ---- mostrar um item no 3D ----
function tecRestaurar() {
  for (const n of TEC.esc || []) oculto.delete(n); TEC.esc = [];
  for (const m of TEC.pint) { m.material.emissive.copy(m.userData.emT); delete m.userData.emT; } TEC.pint = [];
  for (const m of TEC.ghost) { const o = m.userData.tec0; if (o) { m.material.transparent = o.t; m.material.opacity = o.o; m.material.depthWrite = o.d; m.material.needsUpdate = true; delete m.userData.tec0; } }
  TEC.ghost = []; if (TEC.g) TEC.g.children.forEach(c => c.visible = false);
}
function fantasma(n, op = 0.2) { const m = MESH[n]; if (!m) return; if (!m.userData.tec0) m.userData.tec0 = { t: m.material.transparent, o: m.material.opacity, d: m.material.depthWrite }; m.material.transparent = true; m.material.opacity = op; m.material.depthWrite = false; m.material.needsUpdate = true; TEC.ghost.push(m); }
function pintar(n, cor) { const m = MESH[n]; if (!m) return; if (!m.userData.cor0) m.userData.cor0 = m.material.color.clone(); m.material.color.set(cor); if (!m.userData.emT) { m.userData.emT = m.material.emissive.clone(); TEC.pint.push(m); } m.material.emissive.set(cor).multiplyScalar(0.28); }   // brilho leve: aparece mesmo do lado da sombra
function tecFoco(nomes, dir, fy, fz, mult = 1.25) {   // enquadra as malhas na área livre da tela (lado direito do corpo)
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3(); for (const n of nomes) if (MESH[n]) b.expandByObject(MESH[n]); else if (n && n.isObject3D) b.expandByObject(n);
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  if (fy != null) c.y = b.min.y + s.y * fy; if (fz != null) { s.multiplyScalar(fz); }
  const t = Math.tan(cam.fov * Math.PI / 360), r = Math.max(s.x, s.y, s.z) * 0.5, dist = Math.max(0.3, mult * r / (t * Math.min(1, cam.aspect)) + r);
  voar(c.toArray(), dist, new THREE.Vector3(...(dir || [-0.6, 0.2, 1])));
}
async function tecItem(id, junta) {
  const def = ITENS_TEC[TEC.tema].find(x => x.id === id); if (!def) return;
  if (!TEC.on && !TEC.cam0) TEC.cam0 = { ...visCamada };
  TEC.item = id; TEC.trocando = true; limparDesvio(); TEC.trocando = false; tecRestaurar(); TEC.on = true; tecG().visible = true;
  movAtivo = { id: 'tec' }; filtroInsercao = null;
  for (const c of def.cam || []) { visCamada[c] = true; document.querySelector(`[data-c=${c}]`)?.classList.add('on'); await garantir(c); }
  if (!visCamada.ossos) { visCamada.ossos = true; document.querySelector('[data-c=ossos]').classList.add('on'); }
  const lado = def.lado || null, alvo = [], vis = new Set();
  const cor = TEC.tema === 'cartilagens' ? COR_TIPO[def.tipo] || COR_TEC.cartilagens : COR_TEC[TEC.tema];
  if (def.b) { visCamada.musculos = true; document.querySelector('[data-c=musculos]').classList.add('on');
    for (const n of malhasDe(def.b, lado)) {
      if (def.cruzado && ((E[n].b === 'Latissimus dorsi muscle' && E[n].l !== 'direito') || (E[n].b === 'Gluteus maximus muscle' && E[n].l !== 'esquerdo'))) continue;
      vis.add(n); alvo.push(n); pintar(n, (def.cores && def.cores[E[n].b]) || cor);
    } }
  TEC.esc = malhasDe(def.esconder || []).filter(n => !oculto.has(n)); TEC.esc.forEach(n => oculto.add(n));
  for (const n of malhasDe(def.ctx || [], def.lado)) { vis.add(n); if (def.gerar !== 'epi') fantasma(n, def.op || 0.22); }
  for (const n of malhasDe(def.vidro || [])) fantasma(n, 0.4);
  if (def.insercoes) { visCamada.insercoes = true; document.querySelector('[data-c=insercoes]').classList.add('on'); await garantir('insercoes'); for (const n of Object.keys(E)) if (E[n].c === 'insercoes' && MESH[n]) vis.add(n); }
  let foco = alvo;
  if (def.gerar === 'cart') {
    const C = tecCartilagem(), j = junta || TEC.junta, J = JUNTAS_C[j]; TEC.junta = j; C[j].visible = true;
    isolado = vis; aplicarVis(); destacar(null);
    tecFoco(C[j].children.filter(m => m.userData.lado === 'direito'), J.dir, null, null, J.mult || 2.2);
  } else {
    if (def.gerar === 'lata') { visCamada.musculos = true; for (const n of malhasDe(COXA_M)) vis.add(n); tecEnvoltorio('lata', COXA_M, 0.0025).visible = true; foco = malhasDe(COXA_M, 'direito'); }
    if (def.gerar === 'epi') { visCamada.musculos = true; tecEnvoltorio('epi', def.ctx, 0.003, 'direito').visible = true; foco = malhasDe(def.ctx, 'direito'); }
    isolado = vis; aplicarVis(); destacar(null);
    const fr = def.foco ? malhasDe(def.foco, 'direito') : foco.filter(n => !E[n] || E[n].l !== 'esquerdo');
    if (def.id === 'enteses') enquadrarP('corpo', 'ant');
    else tecFoco(fr.length ? fr : foco, def.dir, null, def.fz, def.mult);
  }
  sujar(); tecCartao();
}
function tecCartao() {
  const el = $('tecItem'); if (!el || !TEC.txt) return;
  const def = ITENS_TEC[TEC.tema].find(x => x.id === TEC.item), t = TEC.txt[TEC.tema].itens[TEC.item] || {};
  const ficha = def && def.b ? malhasDe(def.b).find(n => INFO[E[n].b]) : null;
  const tipos = TEC.tema === 'cartilagens' ? `<div class="leg" style="margin-top:6px">${[['hialina', 'Hialina'], ['elastica', 'Elástica'], ['fibro', 'Fibrocartilagem']].concat(def.id === 'discos' ? [['nucleo', 'Núcleo pulposo']] : []).map(([k, n]) => `<span><i style="background:${COR_TIPO[k]}"></i>${n}</span>`).join('')}</div>` : '';
  el.innerHTML = `<div class="tecard" style="--k:${TEC.tema === 'cartilagens' ? COR_TIPO[def.tipo] : COR_TEC[TEC.tema]}"><small>${esc(t.tipo || '')}</small><b>${esc(t.nome || '')}</b><p>${t.txt || ''}</p>${tipos}
    ${def.gerar === 'cart' ? `<div class="seg" id="tecJ">${Object.entries(JUNTAS_C).map(([k, J]) => `<button data-j="${k}" class="${k === TEC.junta ? 'on' : ''}">${J.n}</button>`).join('')}</div>` : ''}
    ${ficha ? `<div class="acoes" style="margin-top:8px"><button data-ficha="${esc(ficha)}">Abrir a ficha</button></div>` : ''}</div>`;
  $('pB').querySelectorAll('#tecLista button').forEach(b => b.classList.toggle('on', b.dataset.i === TEC.item));
}

// ---- ilustrações ----
const SVGT = (h, corpo, leg) => `<figure class="tfig"><svg viewBox="0 0 360 ${h}" role="img" aria-label="${esc(leg || '')}" font-family="Instrument Sans, system-ui, sans-serif">${corpo}</svg>${leg ? `<figcaption>${leg}</figcaption>` : ''}</figure>`;
const tx = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 10.5}" fill="${o.c || '#c9d2e3'}" text-anchor="${o.a || 'middle'}" font-weight="${o.w || 600}">${s}</text>`;
const seta = (x1, y1, x2, y2, c = '#939dba') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1.6"/><path d="M${x2},${y2} l-6,-3.5 v7z" fill="${c}" transform="rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI} ${x2} ${y2})"/>`;
const onda = (x, y0, y1, a, fase, k = 0.32) => { let d = ''; for (let y = y0; y <= y1; y += 2) d += (y === y0 ? 'M' : 'L') + (x + a * Math.sin(y * k + fase)).toFixed(1) + ',' + y; return d; };
let _sr = 7; const rnd = () => ((_sr = (_sr * 16807) % 2147483647) / 2147483647);
const FIG_T = {
  hierarquia() {
    const xs = [36, 108, 180, 252, 324], ou = '#f2c879', ou2 = '#d9a441'; let s = '';
    s += [0, 2.1, 4.2].map((f, i) => `<path d="${onda(36, 40, 140, 6, f, 0.22)}" fill="none" stroke="${['#ffe08a', ou, ou2][i]}" stroke-width="2.6" stroke-linecap="round"/>`).join('');
    s += `<rect x="100" y="40" width="16" height="100" rx="8" fill="${ou}"/>` + Array.from({ length: 12 }, (_, i) => `<rect x="100" y="${44 + i * 8}" width="16" height="3.2" fill="${ou2}"/>`).join('');
    s += [-12, -6, 0, 6, 12].map(dx => `<path d="${onda(180 + dx, 40, 140, 2.2, dx, 0.5)}" fill="none" stroke="${ou}" stroke-width="5" stroke-linecap="round"/>`).join('');
    _sr = 11; let pts = ''; for (let i = 0; i < 46; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 25; pts += `<circle cx="${(252 + r * Math.cos(a)).toFixed(1)}" cy="${(90 + r * Math.sin(a)).toFixed(1)}" r="2.3" fill="${ou2}"/>`; }
    s += `<circle cx="252" cy="90" r="30" fill="#fff1cf"/>${pts}<circle cx="252" cy="90" r="30" fill="none" stroke="#3fd8cb" stroke-width="2.4"/>`;
    s += `<circle cx="324" cy="90" r="36" fill="#fff1cf" stroke="#ff8fa3" stroke-width="3"/><circle cx="324" cy="90" r="41" fill="none" stroke="#ff8fa3" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    for (const [dx, dy] of [[0, 0], [-15, -15], [15, -15], [-19, 7], [19, 7], [-6, 21], [9, 21]]) { s += `<circle cx="${324 + dx}" cy="${90 + dy}" r="8.6" fill="#ffe6ad" stroke="#3fd8cb" stroke-width="1.4"/>`; for (let i = 0; i < 4; i++) s += `<circle cx="${(324 + dx + (i % 2 ? 2.6 : -2.6)).toFixed(1)}" cy="${(90 + dy + (i < 2 ? -2.6 : 2.6)).toFixed(1)}" r="1.5" fill="${ou2}"/>`; }
    for (let i = 0; i < 4; i++) s += seta(xs[i] + (i === 3 ? 33 : 17), 90, xs[i + 1] - (i === 3 ? 43 : 34), 90);
    const nomes = ['Molécula de colágeno', 'Fibrila', 'Fibra', 'Fascículo', 'Tendão'], esc_ = ['nanômetros', 'nanômetros', 'micrômetros', 'décimos de mm', 'milímetros'];
    xs.forEach((x0, i) => { const x = i === 0 ? x0 + 7 : x0; s += tx(x, 168, nomes[i].split(' ')[0], { c: '#f3f5fb', w: 700, fs: 11 }); if (i === 0) s += tx(x, 180, 'de colágeno', { c: '#f3f5fb', w: 700, fs: 10.5 }); s += tx(x, i === 0 ? 193 : 181, esc_[i], { c: '#939dba', fs: 9.5, w: 500 }); });
    s += tx(252, 214, 'endotendão', { c: '#3fd8cb', fs: 10 }) + tx(324, 214, 'epitendão', { c: '#ff8fa3', fs: 10 }) + tx(324, 226, 'e paratendão', { c: '#ff8fa3', fs: 10 });
    s += tx(43, 214, 'tripla hélice', { c: '#939dba', fs: 10 }) + tx(108, 214, 'com estrias', { c: '#939dba', fs: 10 }) + tx(180, 214, 'ondulada', { c: '#939dba', fs: 10 });
    s = `<g transform="translate(-7,0)">${s}</g>`;
    return SVGT(234, s, 'Cada nível junta muitas unidades do nível anterior. As cores das membranas mostram onde fica cada envoltório.');
  },
  pontas() {
    let s = `<rect x="8" y="60" width="138" height="56" rx="10" fill="#c43d4b"/>`;
    for (let y = 66; y < 112; y += 7) s += `<line x1="14" y1="${y}" x2="134" y2="${y}" stroke="#ff8b98" stroke-width="2.2"/>`;
    s += `<path d="M146,60 ${Array.from({ length: 8 }, (_, i) => `L${i % 2 ? 136 : 160},${60 + i * 8}`).join(' ')} L146,116 Z" fill="#f2c879"/>`;
    s += `<rect x="150" y="66" width="128" height="44" fill="#f2c879"/>`;
    for (let y = 70; y < 108; y += 6) s += `<path d="${Array.from({ length: 33 }, (_, i) => (i ? 'L' : 'M') + (154 + i * 3.8).toFixed(1) + ',' + (y + 1.6 * Math.sin(i * 1.3)).toFixed(1)).join(' ')}" fill="none" stroke="#d9a441" stroke-width="1.4"/>`;
    s += `<rect x="278" y="62" width="22" height="52" fill="#c9a7ff"/>`; _sr = 3; for (let i = 0; i < 9; i++) s += `<ellipse cx="${282 + (i % 3) * 7}" cy="${70 + Math.floor(i / 3) * 15}" rx="2.6" ry="1.8" fill="#6e4bb5"/>`;
    s += `<rect x="300" y="60" width="14" height="56" fill="#9a8fb8"/><line x1="300" y1="58" x2="300" y2="118" stroke="#3fd8cb" stroke-width="1.6" stroke-dasharray="3 2"/>`;
    s += `<rect x="314" y="44" width="40" height="88" rx="6" fill="#e9e2d2"/>`; for (let i = 0; i < 14; i++) s += `<circle cx="${320 + (i * 13) % 30}" cy="${52 + (i * 17) % 72}" r="3.6" fill="#c9bea6"/>`;
    s += tx(76, 46, 'Músculo', { c: '#ff8b98', w: 700, fs: 11.5 }) + tx(152, 34, 'Junção', { c: '#f3f5fb', w: 700 }) + tx(152, 46, 'miotendínea', { c: '#f3f5fb', w: 700 }) + tx(214, 46, 'Tendão', { c: '#f2c879', w: 700, fs: 11.5 }) + tx(289, 34, 'Êntese', { c: '#c9a7ff', w: 700, fs: 11.5 }) + tx(336, 34, 'Osso', { c: '#e9e2d2', w: 700, fs: 11.5 });
    s += tx(300, 140, 'fibrocartilagem que', { c: '#c9a7ff', fs: 9.5 }) + tx(300, 152, 'vai calcificando', { c: '#9a8fb8', fs: 9.5 }) + tx(152, 136, 'dobras que aumentam o contato', { c: '#939dba', fs: 9.5 });
    return SVGT(158, s, 'Da contração ao osso: o tendão é ondulado em repouso e a êntese faz a transição gradual para o osso.');
  },
  curva() {
    const X = e => 40 + e * 30, Y = f => 168 - f * 140; let s = '';
    s += `<rect x="${X(0)}" y="20" width="${X(2) - X(0)}" height="148" fill="#3fd8cb14"/><rect x="${X(2)}" y="20" width="${X(4.5) - X(2)}" height="148" fill="#ffd43b14"/><rect x="${X(4.5)}" y="20" width="${X(8) - X(4.5)}" height="148" fill="#ff8a3d14"/><rect x="${X(8)}" y="20" width="${X(10) - X(8)}" height="148" fill="#ff3b5c14"/>`;
    s += `<line x1="40" y1="168" x2="345" y2="168" stroke="#5b6a8c"/><line x1="40" y1="168" x2="40" y2="16" stroke="#5b6a8c"/>`;
    for (const e of [0, 2, 4, 6, 8, 10]) s += tx(X(e), 182, e + '%', { c: '#939dba', fs: 9.5, w: 500 });
    let d = ''; for (let e = 0; e <= 10; e += 0.1) { let f; if (e < 2) f = 0.06 * e * e; else if (e < 4.5) f = 0.24 + 0.2 * (e - 2); else if (e < 8) f = 0.74 + 0.2 * (e - 4.5) - 0.028 * (e - 4.5) ** 2; else f = Math.max(0, 1.08 - 0.55 * (e - 8) ** 1.5); d += (e ? 'L' : 'M') + X(e).toFixed(1) + ',' + Y(f).toFixed(1); }
    s += `<path d="${d}" fill="none" stroke="#f2c879" stroke-width="3" stroke-linejoin="round"/>`;
    s += tx(X(1), 34, 'pé', { c: '#3fd8cb', w: 700 }) + tx(X(1), 46, 'a ondulação', { c: '#3fd8cb', fs: 9.5 }) + tx(X(1), 57, 'se desfaz', { c: '#3fd8cb', fs: 9.5 });
    s += tx(X(3.25), 34, 'linear', { c: '#ffd43b', w: 700 }) + tx(X(3.25), 46, 'estica e volta', { c: '#ffd43b', fs: 9.5 });
    s += tx(X(6.25), 34, 'microrrupturas', { c: '#ff8a3d', w: 700 }) + tx(345, 34, 'ruptura', { c: '#ff5d73', w: 700, a: 'end' });
    s += `<path d="${onda(0, 0, 0, 0, 0)}"/>` + `<path d="M${X(0.3)},80 ${Array.from({ length: 10 }, (_, i) => `l4,${i % 2 ? -5 : 5}`).join(' ')}" fill="none" stroke="#3fd8cb" stroke-width="1.6"/><line x1="${X(2.3)}" y1="96" x2="${X(4.2)}" y2="96" stroke="#ffd43b" stroke-width="1.8"/>`;
    s += `<text x="14" y="94" font-size="10" fill="#939dba" transform="rotate(-90 14 94)" text-anchor="middle">força</text>` + tx(192, 198, 'deformação (quanto o tendão estica)', { c: '#939dba', fs: 10, w: 500 });
    return SVGT(206, s, 'Curva de tensão e deformação do tendão. Valores aproximados.');
  },
  tipos() {
    let s = '<defs>' + [62, 180, 298].map((x, i) => `<clipPath id="tc${i}"><circle cx="${x}" cy="72" r="54"/></clipPath>`).join('') + '</defs>';
    const cel = (x, y, rx = 4.4, ry = 3.4, rot = 0) => `<ellipse cx="${x}" cy="${y}" rx="${rx + 2.4}" ry="${ry + 2.2}" fill="#ffffff55" transform="rotate(${rot} ${x} ${y})"/><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#3b4f8f" transform="rotate(${rot} ${x} ${y})"/><circle cx="${x}" cy="${y}" r="1.5" fill="#c9d6ff"/>`;
    _sr = 5; let a = `<g clip-path="url(#tc0)"><rect x="0" y="0" width="130" height="140" fill="#a8cdf5"/>`;
    for (let i = 0; i < 9; i++) { const x = 22 + (i % 3) * 30 + rnd() * 8, y = 34 + Math.floor(i / 3) * 30 + rnd() * 8, n = 1 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) a += cel(x + k * 9, y + (k % 2) * 4, 4, 3.2, rnd() * 60); }
    a += '</g>';
    let b = `<g clip-path="url(#tc1)"><rect x="110" y="0" width="140" height="140" fill="#f3e3a0"/>`;
    for (let i = 0; i < 16; i++) { let d = `M${110 + rnd() * 140},${10 + rnd() * 130}`; for (let k = 0; k < 5; k++) d += ` q${(rnd() - 0.5) * 30},${(rnd() - 0.5) * 30} ${(rnd() - 0.5) * 40},${(rnd() - 0.5) * 40}`; b += `<path d="${d}" fill="none" stroke="#7a3f8f" stroke-width="1.5"/>`; }
    for (let i = 0; i < 7; i++) b += cel(140 + (i % 3) * 30 + rnd() * 6, 40 + Math.floor(i / 3) * 30 + rnd() * 6, 4.6, 3.6, rnd() * 90);
    b += '</g>';
    let c = `<g clip-path="url(#tc2)"><rect x="240" y="0" width="120" height="140" fill="#f4c6d0"/>`;
    for (let y = 22; y < 130; y += 12) c += `<path d="${Array.from({ length: 30 }, (_, i) => (i ? 'L' : 'M') + (240 + i * 4.4).toFixed(1) + ',' + (y + 2.4 * Math.sin(i * 0.7 + y)).toFixed(1)).join(' ')}" fill="none" stroke="#d76a86" stroke-width="5"/>`;
    for (let y = 28; y < 125; y += 24) for (let x = 262; x < 340; x += 13) c += cel(x, y, 3.4, 2.4);
    c += '</g>';
    s += a + b + c + [62, 180, 298].map(x => `<circle cx="${x}" cy="72" r="54" fill="none" stroke="#2e3a66" stroke-width="3"/>`).join('');
    s += tx(62, 146, 'Hialina', { c: '#8fd3ff', w: 800, fs: 12 }) + tx(180, 146, 'Elástica', { c: '#ffe066', w: 800, fs: 12 }) + tx(298, 146, 'Fibrocartilagem', { c: '#c9a7ff', w: 800, fs: 12 });
    s += tx(62, 160, 'matriz lisa', { c: '#939dba', fs: 9.5 }) + tx(180, 160, 'rede de fibras elásticas', { c: '#939dba', fs: 9.5 }) + tx(298, 160, 'feixes de colágeno tipo I', { c: '#939dba', fs: 9.5 });
    return SVGT(168, s, 'Os condrócitos (pontos azuis) ficam em lacunas, sozinhos ou em pequenos grupos.');
  },
  zonas() {
    const x0 = 30, x1 = 210; let s = `<rect x="${x0}" y="18" width="${x1 - x0}" height="138" fill="#bfdcf7"/>`;
    s += `<rect x="${x0}" y="156" width="${x1 - x0}" height="20" fill="#8fa3c4"/><rect x="${x0}" y="176" width="${x1 - x0}" height="40" fill="#e9e2d2"/>`;
    for (let i = 0; i < 9; i++) s += `<circle cx="${x0 + 12 + i * 20}" cy="${190 + (i % 2) * 12}" r="${4 + (i % 3)}" fill="#c9bea6"/>`;
    for (let x = x0 + 10; x < x1; x += 18) s += `<path d="M${x},176 L${x},96 Q${x},40 ${x + 26},24" fill="none" stroke="#5f86c2" stroke-width="1.4" opacity=".8"/>`;
    s += `<line x1="${x0}" y1="156" x2="${x1}" y2="156" stroke="#3fd8cb" stroke-width="2" stroke-dasharray="4 3"/>`;
    for (let x = x0 + 8; x < x1; x += 16) s += `<ellipse cx="${x}" cy="26" rx="5" ry="1.8" fill="#3b4f8f"/>`;
    for (let i = 0; i < 10; i++) s += `<circle cx="${x0 + 14 + i * 17}" cy="${58 + (i % 2) * 14}" r="3.4" fill="#3b4f8f"/>`;
    for (let x = x0 + 16; x < x1; x += 28) for (let y = 104; y < 150; y += 10) s += `<ellipse cx="${x}" cy="${y}" rx="2.8" ry="3.6" fill="#3b4f8f"/>`;
    const L = (y, t, sub, c) => `<line x1="${x1 + 4}" y1="${y}" x2="${x1 + 16}" y2="${y}" stroke="${c}" stroke-width="1.4"/>` + tx(x1 + 20, y + 3.5, t, { a: 'start', c, w: 700, fs: 10.5 }) + (sub ? tx(x1 + 20, y + 15, sub, { a: 'start', c: '#939dba', fs: 9.5, w: 500 }) : '');
    s += L(26, 'Superficial', 'fibras paralelas', '#f3f5fb') + L(64, 'Média', 'fibras oblíquas', '#f3f5fb') + L(120, 'Profunda', 'células em colunas', '#f3f5fb') + L(156, 'Linha de maré', '', '#3fd8cb') + L(167, 'Calcificada', '', '#8fa3c4') + L(196, 'Osso subcondral', '', '#e9e2d2');
    s += tx(120, 12, 'líquido sinovial', { c: '#4dabf7', fs: 10 });
    return SVGT(222, s, 'As linhas azuis mostram a direção das fibras de colágeno, que formam arcos da base até a superfície.');
  },
  esponja() {
    const bloco = (x, h, sai) => {
      let s = `<rect x="${x}" y="${150 - h}" width="120" height="${h}" rx="8" fill="#8fd3ff"/>`;
      for (let i = 0; i < 8; i++) s += `<circle cx="${x + 15 + (i % 4) * 30}" cy="${150 - h + 14 + Math.floor(i / 4) * (h - 28)}" r="3.2" fill="#3b4f8f"/>`;
      for (let i = 0; i < 3; i++) { const y = 150 - h * 0.25 - i * h * 0.25; s += sai ? seta(x - 2, y, x - 26, y, '#4dabf7') + seta(x + 122, y, x + 146, y, '#4dabf7') : seta(x - 28, y, x - 4, y, '#63e6be') + seta(x + 148, y, x + 124, y, '#63e6be'); }
      return s;
    };
    let s = `<rect x="40" y="150" width="280" height="10" rx="4" fill="#e9e2d2"/>` + bloco(48, 56, true) + bloco(196, 80, false);
    s += seta(108, 40, 108, 84, '#ff8a3d') + seta(256, 60, 256, 30, '#94d82d');
    s += tx(108, 30, 'carga: a água sai', { c: '#ff8a3d', w: 700 }) + tx(256, 20, 'alívio: o líquido volta', { c: '#94d82d', w: 700 }) + tx(256, 176, 'com oxigênio e nutrientes', { c: '#63e6be', fs: 10 }) + tx(108, 176, 'e leva resíduos', { c: '#4dabf7', fs: 10 });
    return SVGT(184, s, 'A cartilagem funciona como uma esponja: o movimento é a bomba que a alimenta.');
  },
  camadas() {
    const cx = 104, cy = 112; let s = `<circle cx="${cx}" cy="${cy}" r="98" fill="#e7a98f"/><circle cx="${cx}" cy="${cy}" r="90" fill="#f7dd8a"/>`;
    _sr = 9; for (let i = 0; i < 26; i++) { const a = rnd() * 6.28; s += `<circle cx="${(cx + 82 * Math.cos(a)).toFixed(1)}" cy="${(cy + 82 * Math.sin(a)).toFixed(1)}" r="${4 + rnd() * 2}" fill="#fbe9b4" stroke="#e8c45d" stroke-width=".8"/>`; }
    s += `<circle cx="${cx}" cy="${cy}" r="74" fill="#dbe8f7"/><circle cx="${cx}" cy="${cy}" r="68" fill="#b23a48" stroke="#ffffff" stroke-width="2.4"/>`;
    for (const [dx, dy, r] of [[0, 0, 20], [-34, -26, 17], [32, -28, 18], [-40, 18, 17], [36, 20, 18], [-6, -50, 13], [-4, 44, 16], [48, -2, 11], [-52, -4, 10]]) {
      s += `<circle cx="${cx + dx}" cy="${cy + dy}" r="${r}" fill="#d94d5c" stroke="#ffe3e8" stroke-width="1.6"/>`;
      for (let k = 0; k < 7; k++) { const a = k * 0.9, rr = k ? r * 0.55 : 0; s += `<circle cx="${(cx + dx + rr * Math.cos(a)).toFixed(1)}" cy="${(cy + dy + rr * Math.sin(a)).toFixed(1)}" r="${(r * 0.2).toFixed(1)}" fill="#ef7482" stroke="#ffd0d6" stroke-width=".6"/>`; }
    }
    const L = (px, py, ty, t, c) => `<line x1="${px}" y1="${py}" x2="222" y2="${ty}" stroke="${c}" stroke-width="1.1"/><circle cx="${px}" cy="${py}" r="2.2" fill="${c}"/>` + t.split('|').map((l, i) => tx(226, ty + 3.5 + i * 12, l, { a: 'start', c, w: i ? 500 : 700, fs: i ? 9.5 : 10.5 })).join('');
    s += L(cx + 69, cy - 69, 22, 'Pele', '#e7a98f') + L(cx + 64, cy - 52, 50, 'Fáscia superficial|com gordura', '#f7dd8a') + L(cx + 71, cy - 22, 82, 'Fáscia profunda', '#dbe8f7') + L(cx + 67, cy + 6, 112, 'Epimísio', '#ffffff') + L(cx + 50, cy + 18, 142, 'Perimísio|em volta do fascículo', '#ffe3e8') + L(cx + 36 + 4, cy + 20 + 3, 172, 'Endomísio|em volta de cada fibra', '#ffd0d6');
    return SVGT(222, s, 'Corte de um músculo do braço ou da perna, da pele para dentro.');
  },
  desliza() {
    let s = ''; const folha = (y, ang, c) => { let f = `<rect x="20" y="${y}" width="320" height="26" rx="6" fill="${c}"/>`; for (let x = 24; x < 336; x += 9) f += `<line x1="${x}" y1="${y + 3}" x2="${x + ang}" y2="${y + 23}" stroke="#ffffff66" stroke-width="1.6"/>`; return f; };
    s += folha(20, 10, '#9fb4d6') + `<rect x="20" y="48" width="320" height="10" fill="#63e6be88"/>` + folha(60, -10, '#b9cbe6') + `<rect x="20" y="88" width="320" height="10" fill="#63e6be88"/>` + folha(100, 10, '#9fb4d6');
    s += seta(120, 33, 200, 33, '#ffd43b') + seta(240, 73, 160, 73, '#ffd43b') + seta(120, 113, 200, 113, '#ffd43b');
    s += tx(180, 146, 'lâminas de colágeno com fibras em direções diferentes', { c: '#c9d2e3', fs: 10 }) + tx(342, 56, 'ácido hialurônico', { c: '#63e6be', a: 'end', fs: 10, w: 700 });
    return SVGT(154, s, 'As camadas escorregam umas sobre as outras graças à camada lubrificante entre elas.');
  },
  toracolombar() {
    let s = `<path d="M118,44 Q180,30 242,44 Q262,50 266,66 L254,128 Q248,148 246,162 L114,162 Q112,148 106,128 L94,66 Q98,50 118,44 Z" fill="#2a3557"/>`;
    s += `<path d="M96,70 L74,150 L66,196 M264,70 L286,150 L294,196" fill="none" stroke="#33416a" stroke-width="15" stroke-linecap="round"/>`;
    s += `<path d="M112,160 Q180,150 248,160 Q258,190 246,214 L114,214 Q102,190 112,160 Z" fill="#2f3b63"/>`;
    s += `<path d="M126,212 L130,256 M234,212 L230,256" stroke="#33416a" stroke-width="34" stroke-linecap="round"/>`;
    s += `<path d="M180,132 L154,156 L180,178 L206,156 Z" fill="#dbe8f7" opacity=".95"/>`;
    s += `<path d="M262,74 Q252,104 240,124 L198,150 L180,132 Q206,96 262,74 Z" fill="#4dabf7" opacity=".92"/>`;
    s += `<path d="M178,176 Q160,166 140,172 Q118,182 120,204 Q130,220 158,214 Q176,202 178,176 Z" fill="#ff5d73" opacity=".92"/>`;
    s += `<path d="M268,80 Q226,150 134,232" fill="none" stroke="#ffd43b" stroke-width="2.4" stroke-dasharray="6 4"/>` + seta(144, 224, 132, 234, '#ffd43b');
    s += tx(312, 40, 'Latíssimo do dorso', { c: '#4dabf7', w: 700, a: 'end' }) + tx(312, 52, '(direito)', { c: '#4dabf7', a: 'end', fs: 9.5 });
    s += tx(56, 238, 'Glúteo máximo', { c: '#ff5d73', w: 700 }) + tx(56, 250, '(esquerdo)', { c: '#ff5d73', fs: 9.5 });
    s += tx(318, 186, 'Fáscia', { c: '#dbe8f7', w: 700, a: 'end' }) + tx(318, 198, 'toracolombar', { c: '#dbe8f7', w: 700, a: 'end' }) + `<line x1="270" y1="184" x2="206" y2="160" stroke="#dbe8f7" stroke-width="1"/>`;
    s += tx(180, 20, 'vista de trás', { c: '#939dba', fs: 10 });
    return SVGT(262, s, 'A diagonal amarela é a cadeia oblíqua posterior: braço de um lado, perna do outro.');
  },
  molinete() {
    let s = `<path d="M40,150 Q30,118 60,104 L110,98 Q170,58 240,96 L282,114 Q300,120 300,134 L300,150 Z" fill="#e9e2d2"/>`;
    s += `<circle cx="296" cy="134" r="13" fill="#d8ccb2"/><path d="M300,128 L332,100 L340,108 L310,138 Z" fill="#e9e2d2"/>`;
    s += `<path d="M52,154 Q170,166 290,148 Q306,146 312,138 L336,112" fill="none" stroke="#dbe8f7" stroke-width="7" stroke-linecap="round"/>`;
    s += seta(318, 150, 344, 120, '#ffd43b') + seta(170, 74, 170, 46, '#94d82d');
    s += tx(170, 36, 'o arco sobe', { c: '#94d82d', w: 700 }) + tx(340, 160, 'dedos estendem', { c: '#ffd43b', w: 700, a: 'end', fs: 10 });
    s += tx(54, 176, 'calcâneo', { c: '#e9e2d2', fs: 10 }) + tx(286, 176, 'cabeça do metatarso', { c: '#e9e2d2', fs: 10 }) + tx(170, 184, 'aponeurose plantar fica tensa', { c: '#dbe8f7', w: 700 });
    return SVGT(192, s, 'Mecanismo de molinete (Hicks): estender os dedos tensiona a aponeurose e transforma o pé numa alavanca firme.');
  },
};

// ---- painel ----
async function mostrarTecidos(tema = TEC.tema) {
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.toggle('on', b.dataset.r === 'tecidos'));
  if (MOV.on) sairMov(false); if (AG.on) sairAg(false);
  if (!TEC.txt) {
    try { TEC.txt = await (window.__conteudo ? window.__conteudo('tecidos.json') : Promise.reject(new Error('sem acesso'))); }
    catch (e) { console.error(e); toast('Não foi possível carregar este conteúdo. Verifique a conexão.'); return; }
  }
  TEC.tema = ITENS_TEC[tema] ? tema : 'tendoes';
  const T = TEC.txt[TEC.tema], cor = COR_TEC[TEC.tema];
  const comp = c => `<div class="tcomp">${c.map(([n, v, k, d]) => `<div><div class="agm-t"><span><i style="background:${k}"></i>${esc(n)}</span></div><div class="agm-b"><i style="width:${Math.max(3, v)}%;background:${k}"></i></div><small>${esc(d)}</small></div>`).join('')}</div>`;
  const sec = s => `<h3>${esc(s.t)}</h3>${s.fig && FIG_T[s.fig] ? FIG_T[s.fig]() : ''}${s.comp ? comp(s.comp) : ''}${s.p ? `<p>${s.p}</p>` : ''}${s.lista ? `<ul>${s.lista.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}`;
  painelP('Tecidos', `<span class="tag" style="background:${cor}22;color:${cor}">tecido conjuntivo</span>tendões, cartilagens e fáscias`, `
    <div class="seg" id="tecTema">${Object.entries(TEC.txt).map(([k, t]) => `<button data-tema="${k}" class="${k === TEC.tema ? 'on' : ''}">${esc(t.nome)}</button>`).join('')}</div>
    <p style="margin-top:10px">${T.resumo}</p>
    <h3>Onde fica no corpo</h3>
    <div class="lista" id="tecLista">${ITENS_TEC[TEC.tema].map(d => `<button data-i="${d.id}"><i style="background:${TEC.tema === 'cartilagens' ? COR_TIPO[d.tipo] : cor}"></i><span class="lnome">${esc((T.itens[d.id] || {}).nome || d.id)}</span></button>`).join('')}</div>
    <div id="tecItem"></div>
    ${T.secoes.map(sec).join('')}
    <div class="aviso">Material educativo. Os valores de composição e de deformação são aproximados e variam entre estruturas, idades e pessoas.</div>
    <div class="fontes">Fontes: ${T.fontes.map(esc).join(' · ')} · Modelo 3D: Z-Anatomy (CC BY-SA 4.0).</div>`);
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.tema) { if (b.dataset.tema !== TEC.tema) mostrarTecidos(b.dataset.tema); return; }
    if (b.dataset.i) { tecItem(b.dataset.i); if (CEL()) $('tecItem').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (b.dataset.j) { tecItem('articular', b.dataset.j); return; }
    if (b.dataset.ficha) { const n = b.dataset.ficha; sairTecidos(); abrir(n); }
  };
  const primeiro = ITENS_TEC[TEC.tema].some(d => d.id === TEC.item) ? TEC.item : ITENS_TEC[TEC.tema][0].id;
  await tecItem(primeiro);
}
function sairTecidos() {
  if (!TEC.on) return; TEC.on = false; tecRestaurar(); if (TEC.g) TEC.g.visible = false;
  if (!TEC.trocando && TEC.cam0) {   // saindo da área: as camadas voltam a ser as de antes
    for (const [c, v] of Object.entries(TEC.cam0)) { visCamada[c] = v; document.querySelector(`[data-c=${c}]`)?.classList.toggle('on', v); }
    TEC.cam0 = null; isolado = null;
  }
}

/* ---------- versão celular: abas embaixo, folha que arrasta e ferramentas na lateral ---------- */
const TAB_DE = r => /^(ombro|cotovelo|joelho)$/.test(r) ? 'regioes' : r || 'corpo';
function marcarTab() {
  const on = document.querySelector('#regioes .chip.on'), t = painelAberto && !on ? $('tabbar').dataset.fixa || '' : TAB_DE(on && on.dataset.r);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.t === (t || 'corpo')));
}
new MutationObserver(marcarTab).observe($('regioes'), { attributes: true, subtree: true, attributeFilter: ['class'] });
new MutationObserver(marcarTab).observe($('painel'), { attributes: true, attributeFilter: ['class'] });
function abaRegioes() {
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.remove('on')); limparDesvio();
  painelP('Regiões', '<span class="tag">atlas</span>estudo por articulação', `
    <p>Cada região isola os músculos daquela articulação e traz as fichas, os ligamentos, o movimento com ângulo e torque e as amplitudes seguras.</p>
    <div class="lista">${Object.entries(DADOS.regioes).map(([k, R]) => `<button data-r="${k}"><i></i><span class="lnome">${esc(R.nome)}</span><span class="pl sagital">abrir</span></button>`).join('')}</div>
    <h3>Também</h3><div class="lista"><button data-t="tecidos"><i style="background:#f2c879"></i><span class="lnome">Tecidos: tendões, cartilagens e fáscias</span></button><button data-t="movimento"><i style="background:var(--ac)"></i><span class="lnome">Movimento: todas as articulações, exercícios, modo livre e marcha</span></button><button data-t="postura"><i style="background:#ff6b8b"></i><span class="lnome">Postura: desvios, cadeias, fio de prumo e ângulo Q</span></button></div>`);
  $('tabbar').dataset.fixa = 'regioes'; marcarTab();
// placeholder curto no celular e corpo inteiro enquadrado acima das abas
const ajustarCel = () => { $('q').placeholder = CEL() ? 'Buscar…' : 'Buscar osso ou músculo'; if (CEL() && !painelAberto) enquadrarP('corpo', 'ant'); };
addEventListener('versao', ajustarCel); ajustarCel();
  $('pB').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; if (b.dataset.r) regiao(b.dataset.r); else if (b.dataset.t) abrirTab(b.dataset.t); };
}
function abaMais() {
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.remove('on'));
  const cheia = !!document.fullscreenElement;
  painelP('Mais', '<span class="tag">opções</span>', `
    <h3>Versão</h3><p>Você está usando a <b>versão para ${CEL() ? 'celular' : 'computador'}</b>.</p>
    <div class="acoes"><button class="pri" data-m="versao">Trocar para a versão ${CEL() ? 'do computador' : 'do celular'}</button>${document.documentElement.requestFullscreen ? `<button data-m="cheia">${cheia ? 'Sair da tela cheia' : 'Tela cheia'}</button>` : ''}<button data-m="padrao">⟲ Voltar ao modelo padrão</button></div>
    <h3>Como usar</h3><ul>
      <li><b>Um dedo:</b> gira o modelo. <b>Dois dedos:</b> pinça para zoom e arrasto para mover.</li>
      <li><b>Toque</b> num osso, músculo ou ligamento para abrir a ficha.</li>
      <li>A <b>folha de baixo</b> sobe e desce: arraste pela alça ou toque no título.</li>
      <li>Na lateral: <b>Tirar</b> (remove estruturas com um toque), <b>Voltar</b>, <b>Padrão</b> e <b>Só direito</b>.</li>
      <li>As <b>camadas</b> (ossos, músculos, origem e inserção, ligamentos) ficam logo abaixo do título.</li></ul>
    <h3>Créditos</h3><p class="pnota">Modelos 3D: Z-Anatomy (CC BY-SA 4.0), derivados do BodyParts3D (DBCLS). Modificados.</p><div class="acoes"><button data-m="creditos">Créditos e licenças completos</button></div>`);
  $('tabbar').dataset.fixa = 'mais'; marcarTab();
// placeholder curto no celular e corpo inteiro enquadrado acima das abas
const ajustarCel = () => { $('q').placeholder = CEL() ? 'Buscar…' : 'Buscar osso ou músculo'; if (CEL() && !painelAberto) enquadrarP('corpo', 'ant'); };
addEventListener('versao', ajustarCel); ajustarCel();
  $('pB').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.m === 'versao') { escolherVersao(CEL() ? 'pc' : 'cel'); abaMais(); }
    if (b.dataset.m === 'cheia') { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}).finally(() => setTimeout(abaMais, 300)); }
    if (b.dataset.m === 'padrao') padrao();
    if (b.dataset.m === 'creditos') mostrarCreditos();
  };
}
// créditos e licenças: atribuição exigida pela CC BY-SA 4.0 (autor, licença com link e aviso de modificação)
function mostrarCreditos() {
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.remove('on'));
  const L = (t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  painelP('Créditos e licenças', '<span class="tag">atribuições</span>', `
    <h3>Modelos 3D</h3>
    <p><b>Z-Anatomy</b>, the libre 3D atlas of anatomy, de Gauthier Kervyn e colaboradores (${L('z-anatomy.com', 'https://www.z-anatomy.com/')}), licença ${L('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/deed.pt-br')}.</p>
    <p>Derivado do <b>BodyParts3D</b>, © The Database Center for Life Science (DBCLS), ${L('dbarchive.biosciencedbc.jp', 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/')}, licença ${L('CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/deed.pt-br')} (versões anteriores em CC BY-SA 2.1 JP).</p>
    <p><b>Modificações feitas aqui:</b> seleção de ossos, músculos, ligamentos e áreas de origem e inserção; conversão para glTF com compressão; nomes em português; e animação dos ossos e deformação dos músculos em tempo real. Os arquivos de modelo modificados são distribuídos sob a mesma licença CC BY-SA 4.0: ${['ossos', 'musculos', 'articulacoes', 'insercoes'].map(n => L(n + '.glb', 'modelo/' + n + '.glb')).join(', ')}.</p>
    <p class="pnota">Os autores dos modelos não endossam este site nem o uso que ele faz dos modelos.</p>
    <h3>Bibliotecas e fontes</h3>
    <ul><li>${L('three.js', 'https://threejs.org/')}: licença MIT, © 2010–2026 three.js authors.</li>
      <li>meshoptimizer (decodificador): licença MIT, © Arseny Kapoulkine.</li>
      <li>Fontes Bricolage Grotesque e Instrument Sans: ${L('SIL Open Font License 1.1', 'https://openfontlicense.org/')}.</li></ul>
    <h3>Conteúdo</h3>
    <p>As fichas, os textos, a organização do conteúdo, o design e o código do site são obra própria do Cinesiomecânica, com todos os direitos reservados. Isso não inclui os arquivos de modelo acima, que continuam livres sob a CC BY-SA 4.0. As fichas citam a bibliografia em que se baseiam (Moore, Neumann, Kapandji, entre outros).</p>
    <p class="pnota">Material educativo: não substitui avaliação ou orientação de um profissional de saúde.</p>`);
}
document.querySelector('.cred').addEventListener('click', mostrarCreditos);
/* ---------- fibras musculares: estrias na direção das fibras de cada músculo ----------
   Cada fibra é tratada como uma reta que sai de um ponto da origem e chega a um ponto da inserção (as áreas de origem e inserção do
   próprio modelo). Para cada vértice guardamos uma coordenada que é igual ao longo de toda a fibra; o desenho das estrias usa essa coordenada. */
// A direção das fibras vem da forma do próprio modelo: fora do navegador (ferramentas/gera.py) cada malha de músculo ganha, por vértice,
// uma coordenada "através das fibras" (phi, em metros: igual ao longo de toda a fibra) e uma "ao longo" (psi, 0 em cima e 1 embaixo).
// O arquivo modelo/fibras.bin traz esses dois números; aqui o shader só desenha os veios seguindo phi. Como é atributo do vértice,
// vale igual em repouso, em postura e em movimento.
function fibMaterial(m) {
  if (m.userData.fib) return; m.userData.fib = true; const U = fibU(m);
  m.onBeforeCompile = sh => fibShader(sh, U); m.customProgramCacheKey = () => 'fib16'; m.needsUpdate = true;
}
function relMaterial(m, forca) {   // realce do relevo para o que não é músculo (ossos, cartilagens, ligamentos)
  const u = { value: new THREE.Vector2(forca * (FIB.rel.value.x > 0 ? 1 : 0), 1 / 260) }; m.userData.uSelf = { value: 0 };
  m.onBeforeCompile = sh => { sh.uniforms.uRel = u; sh.uniforms.uDim = SELDIM; sh.uniforms.uSelf = m.userData.uSelf;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uRel; uniform float uDim, uSelf;').replace('#include <opaque_fragment>', '#include <opaque_fragment>' + APAGA).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uRel.x > 0.0) { vec3 rpx = dFdx(-vViewPosition), rpy = dFdy(-vViewPosition), rnx = dFdx(normal), rny = dFdy(normal);
  float curv = (dot(rnx, rpx) + dot(rny, rpy)) / max(dot(rpx, rpx) + dot(rpy, rpy), 1e-12);
  float rk = clamp(curv * uRel.y, -1.0, 1.0); diffuseColor.rgb *= max(0.5, 1.0 + uRel.x * (rk < 0.0 ? 1.1 * rk : 0.35 * rk)); }`); };
  m.customProgramCacheKey = () => 'rel3'; m.needsUpdate = true;
}
function fibShader(sh, U) {   // realce do relevo + veios das fibras (também é chamada pelos músculos que se deformam com o esqueleto)
    sh.uniforms.uFib = FIB.u; sh.uniforms.uRel = FIB.rel; sh.uniforms.uDim = SELDIM; sh.uniforms.uLeve = FIB.leve; Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 fibS; varying vec2 vFibS;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFibS = fibS;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uFib, uDim, uSelf, uLeve; uniform vec2 uRel; uniform vec4 uFP, uFT; varying vec2 vFibS;
float fibH(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float fibN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fibH(i), fibH(i + vec3(1,0,0)), f.x), mix(fibH(i + vec3(0,1,0)), fibH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fibH(i + vec3(0,0,1)), fibH(i + vec3(1,0,1)), f.x), mix(fibH(i + vec3(0,1,1)), fibH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fibAlt(float x) { float a = fibN(vec3(x * 330.0, 0.37, 0.11)), b = fibN(vec3(x * 900.0 + 7.3, 0.37, 0.11)); float sulco = smoothstep(0.0, 0.34, abs(a - 0.5) * 2.0); return sulco * (0.82 + 0.18 * b); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fibh = 1.0, fibk = 0.0, fibkg = 0.0, fibt = 0.0, fibv = 0.0, fibk0 = 0.0, fibtk = 0.0, fibdx = 0.0, fibdy = 0.0;
if (uFib > 0.0 && uFP.w > 1.5) {
  float x = vFibS.x, sm = vFibS.y * uFT.z * uFT.y;   // penados: os veios ficam inclinados em relação ao eixo pelo ângulo de penação
  if (uFT.x > 2.5) { float pz = uFT.w * 0.6667, xx = abs(mod(x, pz) - 0.5 * pz); fibt = 1.0 - smoothstep(0.0005, 0.0018, xx); x = xx + abs(sm); }   // multipenado: várias penas lado a lado
  else if (uFT.x > 1.5) { float x1 = x - uFT.w; fibt = 1.0 - smoothstep(0.0005, 0.0020, abs(x1)); x = abs(x1) + abs(sm); }   // bipenado: em pena, dos dois lados do tendão central
  else if (uFT.x > 0.5) x += sm;   // unipenado: todos para o mesmo lado
  float fdq = max(abs(dFdx(x)), abs(dFdy(x)));   // de longe os veios somem aos poucos, sem serrilhar: três tamanhos, cada um com a sua distância
  fibk = uFib * (1.0 - smoothstep(0.30, 0.85, fdq * 330.0)); fibkg = uFib * (1.0 - smoothstep(0.09, 0.34, fdq * 330.0)); float fk2 = uFib * (1.0 - smoothstep(0.30, 0.85, fdq * 1100.0)); fibk0 = uFib * (1.0 - smoothstep(0.30, 0.85, fdq * 80.0));
  fibh = fibAlt(x); if (uLeve < 0.5) { const float e = 0.0006; float gx = (fibAlt(x + e) - fibh) / e; fibdx = gx * dFdx(x); fibdy = gx * dFdy(x); }
  float fl = fibN(vec3(x * 80.0 + 1.9, 0.37, 0.11));
  fibv = (fibN(vec3(x * 330.0, 0.37, 0.11)) - 0.5) * 0.6 * fibk + (uLeve < 0.5 ? (fibN(vec3(x * 1100.0 + 3.7, 0.37, 0.11)) - 0.5) * 0.5 * fk2 : 0.0) + (fl - 0.5) * 0.55 * fibk0;
  diffuseColor.rgb *= mix(1.0, 0.72 + 0.32 * fibh, fibkg);   // sulcos finos: só de perto, senão viram pontilhado
  diffuseColor.rgb = diffuseColor.rgb * (1.0 + (0.6 - 0.25 * uFP.x) * fibv) + vec3(0.17, 0.075, 0.065) * max(fibv, 0.0) * (1.0 - uFP.x);   // veios claros rosados entre os escuros (no tendão, só claro e escuro)
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.70, 0.63), 0.34 * fibt * fibkg);   // linha clara: tendão no meio da pena
  float te = vFibS.y; fibtk = (1.0 - uFP.x) * fibk0 * max(smoothstep(0.90 + 0.08 * fl, 1.02, te), 1.0 - smoothstep(-0.02, 0.10 - 0.08 * fl, te));   // perto das pontas, o vermelho passa para o tom claro do tendão, em línguas irregulares
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.66, 0.58) * (0.92 + 0.25 * fibv), 0.7 * fibtk); }`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>' + APAGA)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, clamp(0.44 - 0.2 * fibv, 0.36, 0.6), max(fibk, fibk0) * (1.0 - fibtk));   // brilho de tecido úmido, mais vivo nos veios claros`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (uRel.x > 0.0) {   // realce do relevo que o modelo já traz esculpido (feixes, sulcos entre ventres): sulco escurece, crista clareia
  vec3 rpx = dFdx(-vViewPosition), rpy = dFdy(-vViewPosition), rnx = dFdx(normal), rny = dFdy(normal);
  float curv = (dot(rnx, rpx) + dot(rny, rpy)) / max(dot(rpx, rpx) + dot(rpy, rpy), 1e-12);
  float rk = clamp(curv * uRel.y, -1.0, 1.0); diffuseColor.rgb *= max(0.42, 1.0 + uRel.x * (rk < 0.0 ? 1.25 * rk : 0.5 * rk)); }
if (fibkg > 0.0 && uLeve < 0.5) { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec3 r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1);
  vec3 g = sign(det) * (fibdx * r1 + fibdy * r2); normal = normalize(abs(det) * normal - 0.00055 * fibkg * g); }`);
}
async function fibDados() {   // baixa e abre modelo/fibras.bin uma vez; põe phi e psi em cada malha de músculo
  if (FIB.dados) return FIB.dados;
  return FIB.dados = (async () => {
    const buf = await (await fetch('modelo/fibras.bin')).arrayBuffer(), dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x31424946) throw new Error('fibras.bin inválido');
    const hl = dv.getUint32(4, true), cab = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))), ini = 8 + hl;
    for (const [n, c] of Object.entries(cab)) { const m = MESH[n]; if (!m || m.geometry.attributes.position.count !== c[1]) continue;
      const q = new Uint16Array(buf.slice(ini + c[0], ini + c[0] + c[1] * 2)), p8 = new Uint8Array(buf, ini + c[0] + c[1] * 2, c[1]), a = new Float32Array(c[1] * 2), k = (c[3] - c[2]) / 65535;
      for (let i = 0; i < c[1]; i++) { a[2 * i] = c[2] + q[i] * k; a[2 * i + 1] = p8[i] / 255; }
      m.geometry.setAttribute('fibS', new THREE.BufferAttribute(a, 2)); m.userData.fibC = c; }
    return cab;
  })();
}
async function fibras(on) {
  FIB.on = on; $('bFibras').classList.toggle('on', on); FIB.u.value = on ? 1 : 0; sujar(); if (!on || FIB.pronto) return;
  try { await fibDados(); } catch (e) { console.warn('fibras indisponíveis', e); FIB.dados = null; toast('Não foi possível carregar as fibras'); return; }
  for (const [n, m] of Object.entries(MESH)) { const c = m.userData.fibC; if (m.userData.camada !== 'musculos' || !c || !c[4]) continue;
    const U = fibU(m.material), arq = ARQ[E[n].b]; U.uFP.value.set(U.uFP.value.x, 0, 0, 2);
    if (arq) { const s = arq[2] === 'post' ? c[8] : c[7], sinal = arq[0] === 'uni' ? s * (arq[3] === 'med' ? 1 : -1) : 1; U.uFT.value.set(arq[0] === 'uni' ? 1 : arq[0] === 'bi' ? 2 : 3, sinal * Math.tan(arq[1] * Math.PI / 180), c[5], arq[0] === 'bi' ? (arq[2] === 'post' ? c[10] : c[9]) : c[6] / 2); }   // no bipenado: phi do meio da face (tendão central)
    else U.uFT.value.set(0, 0, c[5], c[6] / 2); }
  for (const [n, cl] of POSE.S.clones || []) { const at = MESH[n] && MESH[n].geometry.attributes.fibS; if (at) cl.geometry.setAttribute('fibS', at); }   // músculos já copiados para o corpo em pose
  FIB.pronto = true; sujar();
}
$('bFibras').onclick = ev => { ev.stopPropagation(); fibras(!FIB.on); };
$('bFibras').style.display = '';   // cópia de teste: o botão aparece e as fibras já começam ligadas (?fibras=0 começa sem)
if (new URLSearchParams(location.search).get('fibras') !== '0') fibras(true);   // em teste: o botão só aparece com ?fibras na URL

/* ---------- lista de estruturas: tudo o que o modelo tem, por tipo e por região do corpo ---------- */
{ const st = document.createElement('style'); st.textContent = '.lsrow{display:flex;gap:6px;align-items:stretch;margin-bottom:6px}.lsn{flex:1;display:flex;align-items:center;gap:10px;text-align:left;padding:9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg2);color:var(--ink);font-size:14px;line-height:1.25;min-height:44px}.lsn:hover,.lsn:focus-visible{border-color:#4a5a94}.lsn i{width:10px;height:10px;border-radius:50%;flex:none}.lso{width:46px;flex:none;border:1px solid var(--line);border-radius:12px;background:var(--bg2);color:var(--ink);display:grid;place-items:center}.lso svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.lsrow.off .lsn{opacity:.45}.lsrow.off .lso{color:var(--ink3)}.lsrow.sel .lsn{border-color:var(--sel);box-shadow:inset 0 0 0 1px var(--sel)}#lsQ{width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--bg2);color:var(--ink);font-size:15px;margin:10px 0 8px}.lsreg{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin}.lsreg button{white-space:nowrap;padding:7px 12px;border-radius:999px;border:1px solid var(--line);font-size:12.5px;color:var(--ink2)}.lsreg button.on{background:var(--sel);color:#04211f;border-color:var(--sel);font-weight:700}.lsh{display:flex;justify-content:space-between;align-items:baseline}.lsh small{font-weight:500;color:var(--ink3);font-size:12px}.lsback{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;margin-bottom:10px;border-radius:999px;border:1px solid var(--line);color:var(--ink);font-size:13.5px;background:var(--bg2)}.lstudo{display:block;width:100%;padding:9px;margin-bottom:8px;border-radius:12px;border:1px dashed #4a5a94;color:var(--ink2);font-weight:700;font-size:13.5px}.lsvazio{color:var(--ink3);padding:14px 0}'; document.head.appendChild(st); }
const REG_L = [['cab', 'Cabeça e pescoço'], ['tro', 'Tronco e coluna'], ['omb', 'Ombro e braço'], ['ant', 'Antebraço e mão'], ['qua', 'Quadril e coxa'], ['per', 'Perna e pé']];
const ABAS_L = [['musculos', 'Músculos', 'var(--mus)'], ['ossos', 'Ossos', 'var(--osso)'], ['articulacoes', 'Ligamentos', '#d9c27a']];
const regOsso = b => /rib$|sternum|Xiphoid|Vertebra [TL]|Costal cartilage|Sacrum|Coccyx/.test(b) ? 'tro' : /Clavicle|Scapula|Humerus/.test(b) ? 'omb' : /Radius|Ulna|of hand|metacarpal|Capitate|Hamate|Lunate|Pisiform|Scaphoid|Trapezium|Trapezoid|Triquetrum/.test(b) ? 'ant' : /Hip bone|Femur|Patella/.test(b) ? 'qua' : /Tibia|Fibula|of foot|metatarsal|Calcaneus|Talus|Cuboid|Navicular|cuneiform/.test(b) ? 'per' : 'cab';
const REG_NOME = [[/abdomin|Linea alba|Rectus sheath|Diaphragm|ntercostal|Quadratus lumborum|Thoracolumbar|Serratus|Erector|Iliocostalis|Longissimus thoracis|Spinalis thoracis|Latissimus|Rhomboid|Pectoralis|Trapezius/i, 'tro'], [/hyoid|thyroid|Sternocleido|Scalen|Platysma|capitis|colli|cervicis|Levator scapulae/i, 'cab'], [/Psoas|Iliacus|Piriformis|Obturator|Gemellus|Quadratus femoris|Tensor fasciae|Iliotibial|Fascia lata/i, 'qua']];
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const OLHO = ['<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>', '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5C18.4 5.5 22 12 22 12a17 17 0 0 1-3.2 3.9M6.3 7.6A16.5 16.5 0 0 0 2 12s3.6 6.5 10 6.5c1.4 0 2.7-.3 3.8-.8"/></svg>'];
function lstItens(c) {   // uma linha por estrutura (direita e esquerda juntas), com a região do corpo
  if (LST.cache[c]) return LST.cache[c];
  const ossos = Object.entries(MESH).filter(([, m]) => m.userData.camada === 'ossos').map(([n, m]) => [new THREE.Box3().setFromObject(m), regOsso(E[n].b)]);
  const porBase = new Map(), v = new THREE.Vector3(), bx = new THREE.Box3();
  for (const [n, e] of Object.entries(E)) { if (e.c !== c || !MESH[n]) continue; let it = porBase.get(e.b); if (!it) porBase.set(e.b, it = { b: e.b, t: e.n, nomes: [], n: null }); it.nomes.push(n); if (!it.n || (E[it.n].l === 'esquerdo' && e.l !== 'esquerdo')) it.n = n; }
  const itens = [...porBase.values()].map(it => {
    if (c === 'ossos') it.r = regOsso(it.b);
    else if (REG_NOME.some(([re, r]) => re.test(it.b) && (it.r = r))) { /* região pelo nome: estruturas longas ou coladas em outro osso */ }
    else { bx.setFromObject(MESH[it.n]).getCenter(v); let d = 1e9; for (const [b, r] of ossos) { const x = b.distanceToPoint(v); if (x < d) { d = x; it.r = r; } } }
    it.s = semAcento(it.t); return it;
  }).sort((a, b) => a.t.localeCompare(b.t, 'pt'));
  return LST.cache[c] = itens;
}
function lstDesenhar() {
  const el = $('lsL'); if (!el) return;
  const cor = ABAS_L.find(a => a[0] === LST.aba)[2], q = semAcento(LST.q.trim()), todos = lstItens(LST.aba), itens = todos.filter(it => (!q || it.s.includes(q)) && (!LST.reg || it.r === LST.reg));
  const limpo = !isolado && !oculto.size;
  let h = limpo ? '' : '<button class="lstudo" data-m="tudo">⟲ Mostrar o modelo inteiro de novo</button>';
  for (const [r, nome] of REG_L) { const g = itens.filter(it => it.r === r); if (!g.length) continue;
    h += `<h3 class="lsh">${nome}<small>${g.length}</small></h3>` + g.map(it => { const off = it.nomes.every(n => oculto.has(n));
      return `<div class="lsrow${off ? ' off' : ''}${it.nomes.includes(sel) ? ' sel' : ''}"><button class="lsn" data-b="${esc(it.b)}"><i style="background:${cor}"></i><span>${esc(it.t)}</span></button><button class="lso" data-o="${esc(it.b)}" aria-pressed="${!off}" aria-label="${off ? 'Mostrar' : 'Esconder'} ${esc(it.t)} no modelo" title="${off ? 'Mostrar' : 'Esconder'} no modelo">${OLHO[off ? 1 : 0]}</button></div>`; }).join(''); }
  el.innerHTML = h + (itens.length ? '' : `<p class="lsvazio">Nada com esse nome em ${ABAS_L.find(a => a[0] === LST.aba)[1].toLowerCase()}. Confira a grafia ou procure em outra aba.</p>`);
  const ct = $('lsCt'); if (ct) ct.textContent = `${itens.length} de ${todos.length}`;
}
async function mostrarLista(rolar) {
  if (MOV.on) sairMov(false); if (AG.on) sairAg(false); limparDesvio();
  document.querySelectorAll('#regioes .chip').forEach(b => b.classList.remove('on'));
  if (LST.aba === 'articulacoes') { await garantir('articulacoes'); if (!visCamada.articulacoes) { visCamada.articulacoes = true; document.querySelector('[data-c=articulacoes]').classList.add('on'); aplicarVis(); } }
  painelP('Lista de estruturas', '<span class="tag">atlas</span>ache pelo nome ou pela região', `
    <div class="seg" id="lsAba" role="tablist">${ABAS_L.map(([k, t]) => `<button role="tab" aria-selected="${k === LST.aba}" data-aba="${k}" class="${k === LST.aba ? 'on' : ''}">${t}</button>`).join('')}</div>
    <input id="lsQ" type="search" placeholder="Filtrar pelo nome…" autocomplete="off" aria-label="Filtrar a lista pelo nome" value="${esc(LST.q)}">
    <div class="lsreg" id="lsReg"><button data-reg="" class="${LST.reg ? '' : 'on'}">Todas</button>${REG_L.map(([k, t]) => `<button data-reg="${k}" class="${k === LST.reg ? 'on' : ''}">${t}</button>`).join('')}</div>
    <small style="color:var(--ink3);display:block;margin-bottom:2px"><span id="lsCt"></span> · toque no nome para ver no modelo · o olho esconde ou mostra</small>
    <div id="lsL"></div>`);
  LST.de = false; lstDesenhar(); if (rolar) $('pB').scrollTop = LST.rol;
  $('lsQ').oninput = ev => { LST.q = ev.target.value; lstDesenhar(); };
  $('pB').onclick = async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.aba) { LST.aba = b.dataset.aba; LST.rol = 0; return mostrarLista(); }
    if (b.dataset.reg !== undefined) { LST.reg = b.dataset.reg; $('lsReg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return lstDesenhar(); }
    if (b.dataset.m === 'tudo') { isolado = null; filtroInsercao = null; oculto.clear(); hist.length = 0; $('bVoltar').disabled = true; aplicarVis(); return lstDesenhar(); }
    const it = lstItens(LST.aba).find(x => x.b === (b.dataset.o || b.dataset.b)); if (!it) return;
    if (b.dataset.o) { const off = it.nomes.every(n => oculto.has(n)); it.nomes.forEach(n => off ? oculto.delete(n) : oculto.add(n)); aplicarVis(); const rl = $('pB').scrollTop; lstDesenhar(); $('pB').scrollTop = rl; return; }
    // toque no nome: mostra só essa estrutura sobre o esqueleto (assim as profundas também aparecem), aproxima a câmera e abre a ficha
    it.nomes.forEach(n => oculto.delete(n)); filtroInsercao = null;
    if (!visCamada[LST.aba]) { visCamada[LST.aba] = true; document.querySelector(`[data-c=${LST.aba}]`).classList.add('on'); }
    isolado = LST.aba === 'ossos' ? new Set() : new Set(it.nomes); aplicarVis();
    LST.rol = $('pB').scrollTop; $('pB').onclick = null; LST.de = true; abrir(it.n); focar(it.n, LST.aba === 'ossos' ? 2.8 : 2.4);
  };
}
function lstVoltar() { if (!LST.de || $('lsBack')) return; $('pB').insertAdjacentHTML('afterbegin', '<button class="lsback" id="lsBack">← Voltar à lista</button>'); $('lsBack').onclick = () => mostrarLista(true); }
$('bLista').onclick = () => mostrarLista();
function abrirTab(t) {
  delete $('tabbar').dataset.fixa;
  if (t === 'regioes') return abaRegioes();
  if (t === 'mais') return abaMais();
  if (t === 'corpo') { padrao(); return marcarTab(); }
  regiao(t);
}
$('tabbar').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) abrirTab(b.dataset.t); });
// folha de baixo com três alturas: só o título, metade e quase a tela toda
(() => {
  const P = $('painel'), H = P.querySelector('.p-h'); let y0 = null, h0 = 0, mexeu = false;
  const alturas = () => ({ min: 84, meio: Math.round(innerHeight * 0.46), max: Math.round(innerHeight - ($('tabbar').offsetHeight || 64) - 64) });
  const estado = () => P.classList.contains('min') ? 'min' : P.classList.contains('max') ? 'max' : 'meio';
  const ir = e => { P.classList.toggle('min', e === 'min'); P.classList.toggle('max', e === 'max'); P.style.height = ''; setTimeout(() => { resize(); sujar(); }, 300); };
  H.addEventListener('pointerdown', e => { if (!CEL() || e.target.closest('#pX')) return; y0 = e.clientY; h0 = P.getBoundingClientRect().height; mexeu = false; P.style.transition = 'none'; H.setPointerCapture(e.pointerId); });
  H.addEventListener('pointermove', e => { if (y0 == null) return; const dy = e.clientY - y0; if (Math.abs(dy) > 6) mexeu = true; if (mexeu) { const a = alturas(); P.style.height = Math.max(a.min, Math.min(a.max, h0 - dy)) + 'px'; } });
  const fim = e => {
    if (y0 == null) return; P.style.transition = ''; const a = alturas(), hAt = P.getBoundingClientRect().height; y0 = null;
    if (!mexeu) return ir(estado() === 'meio' ? 'max' : 'meio');   // toque: alterna entre metade e tela cheia
    const perto = Object.entries(a).sort((x, y) => Math.abs(x[1] - hAt) - Math.abs(y[1] - hAt))[0][0]; ir(perto);
  };
  H.addEventListener('pointerup', fim); H.addEventListener('pointercancel', fim);
})();
marcarTab();
// placeholder curto no celular e corpo inteiro enquadrado acima das abas
const ajustarCel = () => { $('q').placeholder = CEL() ? 'Buscar…' : 'Buscar osso ou músculo'; if (CEL() && !painelAberto) enquadrarP('corpo', 'ant'); };
addEventListener('versao', ajustarCel); ajustarCel();

/* ---------- oclusão de ambiente (GTAO): sombras de contato entre músculos, ossos e dobras ---------- */
// carregada só no computador (no celular pesa demais); a profundidade vem da própria imagem, então funciona também
// com as fibras deformadas na GPU e com os músculos semitransparentes
const AO = { on: false, comp: null };
async function prepararAO() {
  if (AO.comp || CEL() || /[?&]ao=0/.test(location.search)) return;
  try {
    const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all(['EffectComposer', 'RenderPass', 'GTAOPass', 'OutputPass'].map(n => import(`three/addons/postprocessing/${n}.js`)));
    const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
    const dt = new THREE.DepthTexture(w * pr, h * pr); dt.type = THREE.UnsignedIntType;
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4, depthTexture: dt });
    const comp = new EffectComposer(renderer, rt); comp.setPixelRatio(pr); comp.setSize(w, h);
    const rp = new RenderPass(scene, cam); rp.clearAlpha = 0; comp.addPass(rp);
    const ao = new GTAOPass(scene, cam, w * pr, h * pr, { depthTexture: dt });   // a oclusão é calculada em meia resolução (4× mais leve) e suavizada
    const s0 = ao.setSize.bind(ao); ao.setSize = (a, b) => s0(Math.ceil(a / 2), Math.ceil(b / 2)); ao.setSize(w * pr, h * pr);
    ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: 0.05, distanceExponent: 1.4, thickness: 1.2, scale: 1.3, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    comp.addPass(ao); comp.addPass(new OutputPass());
    AO.comp = comp; AO.ao = ao; AO.on = true;
    addEventListener('resize', () => { comp.setPixelRatio(renderer.getPixelRatio()); comp.setSize(innerWidth, innerHeight); sujar(); });
    addEventListener('versao', () => { AO.on = !CEL(); sujar(); });
    sujar();
  } catch (e) { console.warn('AO indisponível', e); AO.comp = null; }
}
prepararAO();

/* ---------- laço ---------- */
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
renderer.setAnimationLoop(() => {
  const voando = anim.t < 1;
  if (voando) { anim.t = Math.min(1, (performance.now() - anim.t0) / 900); const k = ease(anim.t); ctl.target.lerpVectors(anim.de.t, anim.ate.t, k); cam.position.lerpVectors(anim.de.p, anim.ate.p, k); }
  const posando = POSE.tick();
  if (ctl.update()) { sujar(2); SOMBRA.mov = performance.now(); } if (voando) SOMBRA.mov = performance.now();
  if (luzPasso()) sujar(2);
  if (luzSegue()) sujar(2);
  if (!voando && !posando && suja <= 0) {
    // celular: enquanto mexe, desenha leve; meio segundo depois de parar, redesenha uma vez na resolução cheia da tela (imagem parada nítida)
    if (CEL() && NITIDO.pode && !NITIDO.on && NITIDO.t && performance.now() - NITIDO.t > 450 && !MOV.on && !AG.on) { NITIDO.on = true; FIB.leve.value = 0; renderer.setPixelRatio(Math.min(devicePixelRatio, 3)); renderer.render(scene, cam); }
    return;
  }
  NITIDO.t = performance.now(); if (NITIDO.on) { NITIDO.on = false; ajustarPixels(); } FIB.leve.value = CEL() && NITIDO.pode ? 1 : 0;
  if (suja > 0) suja--;
  if (MOV.on) movQuadro(); if (AG.on) agQuadro(); if (POSE.ativo) POSE.rotulos();
  const comAO = !!(AO.comp && AO.on); HULL.saida(comAO);
  if (SOMBRA.on && (SOMBRA.suja || posando || MOV.on || AG.on)) { renderer.shadowMap.needsUpdate = true; SOMBRA.suja = false; }
  { const t = performance.now(), dt = t - SOMBRA.t; SOMBRA.t = t; if (SOMBRA.arrastando && dt < 200 && !SOMBRA.lento) { SOMBRA.n = dt > 34 ? SOMBRA.n + 1 : Math.max(0, SOMBRA.n - 1); if (SOMBRA.n > 24) SOMBRA.lento = true; } }   // máquina lenta: a sombra passa a se acomodar só no fim do giro
  if (comAO) AO.comp.render(); else renderer.render(scene, cam);
});
// painel no celular: tocar no cabeçalho recolhe ou expande a folha
$('painel').querySelector('.p-h').addEventListener('click', e => { if (innerWidth < 900 && !CEL() && !e.target.closest('#pX')) $('painel').classList.toggle('min'); });
new MutationObserver(() => $('painel').classList.remove('min', 'max')).observe($('pT'), { childList: true, characterData: true, subtree: true });
// prepara em segundo plano os pesos que deixam os músculos acompanharem os ossos
setTimeout(() => POSE.pele(), 1200);
// link direto para o simulador: ?sim=agachamento, terra, stiff, pelvica, remada ou puxada
{ const q = new URLSearchParams(location.search).get('sim'); if (q !== null) setTimeout(() => mostrarSim(EX_S[q] ? q : 'agachamento'), 400); }
aplicarVis();
window.__cm = { scene, renderer, NITIDO, LUZ, luzAplicar, SOMBRA, sol, ARQ, FIB, fibras, mostrarLista, focar, TEC, mostrarTecidos, tecItem, SIM, EX_S, BRACOS_S, mostrarSim, defLivre, simDef, simMedir, simTabela, MESH, E, abrir, mostrarCreditos, mostrarLivre, mostrarMarcha, enquadrarP, puxPrep, PUX_V, PUX_C, US, JS, LV, irPreset, mudarL, PRESETS_L, get iso() { return isolado; }, regiao, MOV, setAng: a => { MOV.ang = a; movAplicar(); }, entrarMov, padrao, cam, ctl, THREE, AG, entrarAg, POSE, PE: typeof PE !== 'undefined' ? PE : null, mostrarMov, mostrarArt, listaMov, mostrarDesvio, mostrarFerramenta, listaPostura, setK: k => { AG.k = k; agAplicar(); } };
