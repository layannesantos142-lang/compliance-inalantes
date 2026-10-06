/* =====================================================================
   Compliance — Inalantes & Produtos Perigosos
   Front-end conectado ao Supabase. Nenhum dado fica embutido no HTML:
   tudo é lido das tabelas descritas em supabase/01_schema.sql.
   ===================================================================== */
(function () {
  'use strict';

  // Botão 👁 para mostrar/ocultar o que foi digitado em todos os campos de senha
  document.querySelectorAll('input[type="password"]').forEach(inp => {
    const envolve = document.createElement('div');
    envolve.style.cssText = 'position:relative;' + (inp.style.maxWidth ? 'max-width:' + inp.style.maxWidth + ';flex:1' : '');
    inp.parentNode.insertBefore(envolve, inp);
    envolve.appendChild(inp);
    inp.style.paddingRight = '38px';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = '👁'; b.title = 'Mostrar/ocultar senha';
    b.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;cursor:pointer;font-size:15px;padding:4px;width:auto;margin:0;color:inherit';
    b.onclick = () => { inp.type = inp.type === 'password' ? 'text' : 'password'; b.style.opacity = inp.type === 'text' ? '1' : '.6'; };
    b.style.opacity = '.6';
    envolve.appendChild(b);
  });

  const CFG = window.SUPABASE_CONFIG || {};
  const BUCKET = CFG.bucket || 'evidencias';
  const TTL = CFG.urlAssinadaSegundos || 3600;
  const $ = id => document.getElementById(id);

  if (!window.supabase || !CFG.url || CFG.url.includes('SEU-PROJETO')) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="overlay"><div class="login-box"><h2>Configuração pendente</h2><p>Preencha <code>config.js</code> com a Project URL e a chave anon do Supabase.</p></div></div>');
    return;
  }
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey);

  // ---------------------------------------------------------------- estado
  const S = {
    param: {}, filiais: [], familias: [], classes: [], produtos: [], kpi: {},
    estoque: null, revisao: null, evFiliais: null,
    galeria: [], nf: [], ncFotos: [], documentos: {}
  };

  // ---------------------------------------------------------------- utilitários
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtR = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = v => Number(v || 0).toLocaleString('pt-BR');
  const TAG_INATIVO = '<span class="tag-inativo">● INATIVO</span>';
  const COR = {
    vermelho: { c: 'var(--vermelho)', bg: 'var(--vermelho-claro)', t: 'var(--vermelho-texto)' },
    laranja:  { c: 'var(--laranja)',  bg: 'var(--laranja-claro)',  t: 'var(--laranja-texto)' },
    amarelo:  { c: 'var(--amarelo)',  bg: 'var(--amarelo-claro)',  t: 'var(--amarelo-texto)' },
    verde:    { c: 'var(--verde)',    bg: 'var(--verde-claro)',    t: 'var(--verde-texto)' },
    azul:     { c: 'var(--azul)',     bg: 'var(--azul-claro)',     t: 'var(--azul-texto)' },
    cinza:    { c: '#525252',         bg: 'rgba(82,82,82,.1)',     t: '#525252' }
  };
  const cor = n => COR[n] || COR.cinza;

  // Substitui marcadores de conteúdo vindos do banco por valores calculados
  function tpl(s) {
    return String(s == null ? '' : s)
      .replace(/\{skus\}/g, fmtN(S.kpi.skus))
      .replace(/\{ativos\}/g, fmtN(S.kpi.ativos))
      .replace(/\{inativos\}/g, fmtN(S.kpi.inativos))
      .replace(/\{lista_onu\}/g, (S.kpi.listaOnu || []).map(o => o.replace('UN ', '')).join(', '))
      .replace(/\{INATIVO\}/g, TAG_INATIVO);
  }

  function badgeRisco(r) {
    const m = { 'ALTO': 'risco-alto', 'MÉDIO': 'risco-medio', 'BAIXO': 'risco-baixo', 'ISENTO': 'risco-isento' };
    return r ? `<span class="risco ${m[r] || 'risco-isento'}">${esc(r)}</span>` : '—';
  }
  function badgeClasse(c) {
    const m = { '2.1': 'classe-21', '3': 'classe-3', '8': 'classe-8', '4.1': 'classe-41' };
    return c && c !== '—' ? `<span class="classe ${m[c] || 'classe-3'}">${esc(c)}</span>` : '<span style="color:var(--cinza-medio)">—</span>';
  }

  async function buscar(tabela, ordem, filtro) {
    let q = sb.from(tabela).select('*');
    if (filtro) q = filtro(q);
    if (ordem) q = q.order(ordem, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(tabela + ': ' + error.message);
    return data || [];
  }
  // Supabase devolve no máximo 1000 linhas por requisição: pagina até o fim
  async function buscarTudo(tabela, ordem, filtro) {
    const todas = [];
    for (let de = 0; ; de += 1000) {
      let q = sb.from(tabela).select('*').order(ordem || 'id').range(de, de + 999);
      if (filtro) q = filtro(q);
      const { data, error } = await q;
      if (error) throw new Error(tabela + ': ' + error.message);
      todas.push(...data);
      if (data.length < 1000) return todas;
    }
  }
  async function urlsAssinadas(lista) {
    const paths = lista.map(e => e.storage_path).filter(Boolean);
    if (!paths.length) return lista;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, TTL);
    if (error) throw new Error('storage: ' + error.message);
    const mapa = {};
    (data || []).forEach(d => { mapa[d.path] = d.signedUrl; });
    lista.forEach(e => { e.url = mapa[e.storage_path] || ''; });
    return lista;
  }
  function paginacao(el, pagina, total, porPagina, fn) {
    const totalPag = Math.ceil(total / porPagina);
    if (totalPag <= 1) { el.innerHTML = ''; return; }
    let h = `<button class="pag-btn" data-p="${pagina - 1}" ${pagina === 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = Math.max(1, pagina - 2); i <= Math.min(totalPag, pagina + 2); i++)
      h += `<button class="pag-btn ${i === pagina ? 'ativo' : ''}" data-p="${i}">${i}</button>`;
    h += `<button class="pag-btn" data-p="${pagina + 1}" ${pagina === totalPag ? 'disabled' : ''}>›</button>`;
    el.innerHTML = h;
    el.querySelectorAll('button').forEach(b => b.onclick = () => fn(+b.dataset.p));
  }
  function kpiBox(label, valor, c) {
    return `<div class="kpi"><div class="lb">${label}</div><div class="vl" style="color:${c}">${valor}</div></div>`;
  }
  function opcoes(id, valores) {
    const s = $(id);
    s.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
    valores.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; s.appendChild(o); });
  }

  // ---------------------------------------------------------------- autenticação
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (data.session) carregar(); else $('tela-login').hidden = false;
  }
  $('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-erro').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-senha').value });
    if (error) { $('login-erro').textContent = 'Não foi possível entrar: ' + error.message; return; }
    $('tela-login').hidden = true;
    carregar();
  });
  window.sair = async () => { await sb.auth.signOut(); location.reload(); };

  // ---------------------------------------------------------------- carga inicial
  async function carregar() {
    $('tela-carregando').hidden = false;
    try {
      const { data: acesso, error: eAcesso } = await sb.rpc('meu_acesso');
      if (eAcesso) throw new Error('permissões: ' + eAcesso.message);
      S.acesso = acesso || { abas: [] };
      if (!S.acesso.ativo) {
        $('carregando-msg').innerHTML = '<strong style="color:#BD2335">Acesso não liberado.</strong><br>Seu usuário está desativado ou ainda não foi cadastrado pela administradora.' +
          '<br>Fale com <strong>Layanne Santos</strong> (Compliance): <a href="mailto:layanne.santos@ferreiracosta.com.br?subject=Acesso%20ao%20Compliance%20Inalantes" style="color:#BD2335">layanne.santos@ferreiracosta.com.br</a>' +
          '<br><br><button class="topo-btn" style="margin:auto" onclick="sair()">Sair</button>';
        document.querySelector('#tela-carregando .spinner').hidden = true;
        return;
      }
      const [param, filiais, familias, classes, produtos, normas, comparativos, blocos, requisitos, incompat,
        criterios, exposicao, vistoria, ncs, ccProd, ccCrit, etapas, passos, prazos, fases, acoes, roteiro, docs, evid] =
        await Promise.all([
          buscar('parametros'), buscar('filiais', 'ordem'), buscar('familias_onu', 'ordem'), buscar('classes_risco', 'ordem'),
          sb.rpc('fn_base_kpis').then(r => { if (r.error) throw new Error('indicadores: ' + r.error.message); return r.data || []; }),
          buscar('normas', 'ordem'), buscar('comparativos', 'ordem'), buscar('blocos_conteudo', 'ordem'),
          buscar('requisitos_familia', 'ordem'), buscar('incompatibilidades', 'ordem'), buscar('criterios_conformidade', 'ordem'),
          buscar('exposicao_grupos', 'ordem'), buscar('produtos_vistoria', 'ordem'), buscar('nao_conformidades', 'ordem'),
          buscar('concorrencia_produtos', 'ordem'), buscar('concorrencia_criterios', 'ordem'), buscar('fluxo_etapas', 'numero'),
          buscar('recebimento_passos', 'ordem'), buscar('recebimento_prazos', 'ordem'), buscar('plano_acao_fases', 'ordem'),
          buscar('plano_acao', 'numero'), buscar('plano_roteiro', 'etapa'), buscar('documentos'),
          buscar('evidencias', 'ordem', q => q.in('categoria', ['recebimento', 'nota_fiscal', 'nao_conformidade']))
        ]);

      param.forEach(p => { S.param[p.chave] = p.valor; });
      S.filiais = filiais; S.familias = familias; S.classes = classes;
      // Base dos indicadores: SKUs distintos do estoque de Tintas e Químicos (mesma base do relatório original)
      // (fn_base_kpis agrega por SKU sem expor descrição/valores, então funciona para qualquer perfil)
      S.produtos = produtos.map(p => ({
        onu: p.onu, classe: p.classe, descTemOnu: p.desc_tem_onu,
        perigoso: /^UN \d{4}$/.test(p.onu || ''), inativo: !p.ativo
      }));
      docs.forEach(d => { S.documentos[d.chave] = d; });
      await urlsAssinadas(evid);
      S.galeria = evid.filter(e => e.categoria === 'recebimento');
      S.nf = evid.filter(e => e.categoria === 'nota_fiscal');
      S.ncFotos = evid.filter(e => e.categoria === 'nao_conformidade');
      const bloco = secao => blocos.filter(b => b.secao === secao);

      calcularKpis();
      aplicarParametros();
      renderSidebar(etapas);
      renderHeader();
      renderContexto(bloco, etapas);
      renderVisaoGeral(bloco);
      renderBaseLegal(normas);
      renderTabelaOnu(bloco);
      renderComparativos(comparativos);
      renderArmazenamento(bloco, criterios, exposicao, vistoria, ncs, requisitos, incompat);
      renderConcorrencia(ccProd, ccCrit);
      renderRoteiro(roteiro);
      renderRecebimento(passos, prazos);
      renderGaleria();
      S.fases = fases;
      renderPlano5w2h(fases, acoes);
      aplicarAcesso();
    } catch (e) {
      console.error(e);
      $('carregando-msg').innerHTML = '<strong style="color:#BD2335">Erro ao carregar dados:</strong><br>' + esc(e.message) +
        '<br><br><button class="topo-btn" style="margin:auto" onclick="sair()">Sair</button>';
      return;
    }
    $('tela-carregando').hidden = true;
  }

  // ---------------------------------------------------------------- KPIs calculados
  function calcularKpis() {
    const P = S.produtos.filter(p => p.perigoso);
    const semOnu = P.filter(p => !p.descTemOnu);
    const porOnu = {};
    P.forEach(p => { const k = p.onu || '—'; porOnu[k] = (porOnu[k] || 0) + 1; });
    const porClasse = {};
    P.forEach(p => { const k = p.classe || '—'; porClasse[k] = (porClasse[k] || 0) + 1; });
    const listaOnu = Object.keys(porOnu).filter(k => /^UN /.test(k))
      .sort((a, b) => ((S.familias.find(f => f.onu === a) || {}).ordem || 99) - ((S.familias.find(f => f.onu === b) || {}).ordem || 99));
    S.kpi = {
      skus: P.length,
      ativos: P.filter(p => !p.inativo).length,
      inativos: P.filter(p => p.inativo).length,
      naoConformes: semOnu.length,
      pctNaoConf: P.length ? Math.round(semOnu.length / P.length * 100) + '%' : '0%',
      porOnu, porClasse, listaOnu,
      familias: listaOnu.length
    };
    document.querySelectorAll('[data-kpi]').forEach(el => {
      const v = S.kpi[el.dataset.kpi];
      el.textContent = typeof v === 'number' ? fmtN(v) : (v || '');
    });
  }
  function aplicarParametros() {
    document.querySelectorAll('[data-param]').forEach(el => { el.textContent = S.param[el.dataset.param] || ''; });
  }

  // ---------------------------------------------------------------- navegação
  window.mudarAba = function (id, el) {
    document.querySelectorAll('.secao').forEach(s => s.classList.remove('ativa'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('ativo'));
    $(id).classList.add('ativa');
    el.classList.add('ativo');
    if (id === 'estoque') abrirEstoque();
    if (id === 'nao-inalantes') abrirRevisao();
    if (id === 'evidencias') abrirEvidenciasFiliais();
  };
  function limparAtivos() { document.querySelectorAll('.sb-steprow').forEach(a => a.classList.remove('sb-active')); }
  function mostrarVista(id) {
    document.body.classList.add('modo-fluxo');
    document.querySelectorAll('.fluxo-view').forEach(v => v.classList.remove('ativa'));
    $(id).classList.add('ativa');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.classList.remove('sb-aberta');
  }
  window.abrirCadastro = function (el) {
    document.body.classList.remove('modo-fluxo');
    document.querySelectorAll('.fluxo-view').forEach(v => v.classList.remove('ativa'));
    limparAtivos(); if (el) el.classList.add('sb-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.classList.remove('sb-aberta');
  };
  window.abrirPlanoAcao = () => mostrarVista('view-plano-acao');
  window.fecharPlanoAcao = function () {
    $('view-plano-acao').classList.remove('ativa');
    if (!document.querySelector('.fluxo-view.ativa')) document.body.classList.remove('modo-fluxo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  window.rbAcc = function (btn) {
    const acc = btn.closest('.rb-acc');
    acc.classList.toggle('aberto');
    btn.querySelector('.rb-acc-cmd').textContent = acc.classList.contains('aberto') ? 'Recolher' : 'Expandir';
  };
  window.baixarDocumento = async function (chave) {
    const d = S.documentos[chave];
    if (!d) { alert('Documento ainda não foi importado para o Supabase.'); return; }
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.storage_path, 300, { download: d.nome_arquivo });
    if (error) { alert('Erro ao gerar link: ' + error.message); return; }
    window.open(data.signedUrl, '_blank');
  };

  // ---------------------------------------------------------------- barra lateral
  function renderSidebar(etapas) {
    const caret = '<svg class="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>';
    $('sb-etapas').innerHTML = etapas.map(e => `
      <button class="sb-steprow ${e.numero === 1 ? 'sb-active' : ''}" data-n="${e.numero}">
        <span class="sb-chip">${String(e.numero).padStart(2, '0')}</span><span class="sb-steptxt">${esc(e.nome)}</span>
        ${e.status === 'AGORA' ? '<span class="sb-now">Agora</span>'
          : e.status === 'PRÓXIMO' ? '<span class="sb-now sb-prox">📍 Próximo</span>'
          : e.status ? `<span class="sb-emptytag">${esc(e.status)}</span>` : ''}${caret}
      </button>`).join('');
    $('sb-etapas').querySelectorAll('.sb-steprow').forEach(btn => {
      const e = etapas.find(x => x.numero === +btn.dataset.n);
      btn.onclick = () => {
        if (!e.view_id) return abrirCadastro(btn);
        if (e.view_id === 'view-etapa') {
          const capa = $('etapa-capa');
          capa.style.setProperty('--fc-c', e.cor || '#8C8C8C');
          $('etapa-num').textContent = 'ETAPA ' + String(e.numero).padStart(2, '0');
          $('etapa-titulo').textContent = e.nome;
          $('etapa-status').textContent = '● ' + e.status;
        }
        mostrarVista(e.view_id);
        limparAtivos(); btn.classList.add('sb-active');
      };
    });
    const comConteudo = etapas.filter(e => !['EM BREVE', 'PRÓXIMO'].includes(e.status)).length;
    $('sb-etapas-cont').textContent = comConteudo + ' / ' + etapas.length;
  }

  // ---------------------------------------------------------------- cabeçalho
  function renderHeader() {
    const k = S.kpi;
    const st = (n, l, c) => `<div class="header-stat"><div class="num ${c}">${n}</div><div class="label">${l}</div></div>`;
    $('header-stats').innerHTML = st(fmtN(k.skus), 'SKUs Avaliados', 'vermelho') + st(k.pctNaoConf, 'Não Conformes', 'vermelho') +
      st(fmtN(k.naoConformes), 'Para Adequação', 'laranja') + st(fmtN(k.ativos), 'Ativos', 'verde') + st(fmtN(k.inativos), 'Inativos', 'cinza');
  }

  // ---------------------------------------------------------------- contexto
  function renderContexto(bloco, etapas) {
    $('ctx-frentes').innerHTML = bloco('contexto_frentes').map(b => {
      const c = cor(b.cor);
      return `<div style="background:${c.bg};border-radius:10px;padding:20px;border-left:4px solid ${c.c}">
        <div style="font-size:22px;margin-bottom:10px">${b.icone || ''}</div>
        <div style="font-size:13px;font-weight:700;color:${c.t};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">${esc(b.titulo)}</div>
        <p style="font-size:13px;color:var(--cinza-medio);line-height:1.7">${tpl(b.corpo)}</p>
        <div style="margin-top:12px;font-size:11px;color:${c.t};font-weight:600">${esc(b.meta.base || '')}</div></div>`;
    }).join('');

    $('ctx-fluxo-linha').style.background = 'linear-gradient(to right,' + etapas.map(e => e.cor || '#8C8C8C').join(',') + ')';
    $('ctx-fluxo').style.gridTemplateColumns = `repeat(${etapas.length},1fr)`;
    $('ctx-fluxo').innerHTML = etapas.map((e, i) => {
      const agora = e.status === 'AGORA';
      const prox = e.status === 'PRÓXIMO';
      const etiqueta = agora ? '⚡ AGORA' : prox ? '📍 PRÓXIMO PASSO' : '';
      return `<div class="fx-step ${prox ? 'fx-proximo' : ''}" style="--fx-c:${e.cor}">
        ${prox && i > 0 ? '<div class="fx-trilha"><span></span><span></span><span></span></div>' : ''}
        <div class="fx-icon" style="background:${e.cor};${agora ? `outline:2px dashed ${e.cor};outline-offset:3px` : ''}">${e.icone || ''}</div>
        <div class="fx-card" style="border:1.5px solid ${e.cor};${agora ? 'background:rgba(189,35,53,.1)' : prox ? `background:color-mix(in srgb,${e.cor} 12%,#fff)` : ''}">
          ${etiqueta ? `<div class="fx-etiqueta ${prox ? 'fx-etiqueta-prox' : ''}" style="background:${e.cor}">${etiqueta}</div>` : ''}
          <div class="fx-num" style="color:${e.cor};margin-top:${etiqueta ? 4 : 0}px">${String(e.numero).padStart(2, '0')}</div>
          <div class="fx-title">${esc(e.nome)}</div></div></div>`;
    }).join('');

    $('ctx-riscos').innerHTML = bloco('contexto_riscos').map(b => `
      <div style="padding:16px;background:rgba(189,35,53,.1);border-radius:8px;border-top:3px solid var(--vermelho)">
        <div style="font-size:13px;font-weight:700;color:var(--vermelho-texto);margin-bottom:6px">${b.icone || ''} ${esc(b.titulo)}</div>
        <p style="font-size:12px;color:var(--cinza-medio);line-height:1.6">${tpl(b.corpo)}</p></div>`).join('');

    $('ctx-navegacao').innerHTML = bloco('contexto_navegacao').map(b => `
      <div style="display:flex;gap:10px;align-items:flex-start">
        <div style="background:${cor(b.cor).c};color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;white-space:nowrap">${esc(b.titulo)}</div>
        <div style="font-size:12px;color:var(--cinza-medio);line-height:1.5">${tpl(b.corpo)}</div></div>`).join('');
  }

  // ---------------------------------------------------------------- visão geral
  function renderVisaoGeral(bloco) {
    const k = S.kpi;
    const fam = onu => S.familias.find(f => f.onu === onu) || {};
    const pfFamilias = S.familias.filter(f => f.controle_pf || f.onu === 'UN 3264');
    const cartoesPf = pfFamilias.map(f => {
      const qtd = S.produtos.filter(p => p.perigoso && p.onu === f.onu && !p.inativo).length;
      const ativo = !f.inativo && qtd > 0;
      return `<div style="background:${ativo ? 'rgba(189,35,53,.3)' : 'rgba(0,0,0,.04)'};border:1px solid ${ativo ? 'rgba(189,35,53,.6)' : 'var(--cinza-borda)'};border-radius:8px;padding:12px 16px;text-align:center">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--cinza-medio)">${esc(f.onu)} · ${fmtN(k.porOnu[f.onu] || 0)} SKUs</div>
        <div style="font-size:11px;font-weight:800;color:${ativo ? '#BD2335' : '#C9A839'};text-transform:uppercase">● ${ativo ? 'ATIVO' : 'Inativo'}</div>
        <div style="font-size:10px;color:var(--cinza-medio)">${esc(f.nome_curto)}</div></div>`;
    }).join('');
    const corrAtivos = S.produtos.filter(p => p.perigoso && p.onu === 'UN 3264' && !p.inativo).length;
    $('vg-alerta-pf').innerHTML = `
      <div style="margin:0 20px 20px;background:linear-gradient(135deg,rgba(189,35,53,.35),rgba(122,22,34,.5));border:1px solid rgba(189,35,53,.7);border-radius:10px;padding:18px 22px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div style="font-size:28px">🚔</div>
        <div style="flex:1;min-width:240px">
          <div style="display:inline-block;background:#BD2335;color:white;font-size:9px;font-weight:800;padding:3px 10px;border-radius:4px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Polícia Federal · Lista I Controlada</div>
          <p style="font-size:12px;color:var(--cinza-escuro);line-height:1.6">Substâncias de controle máximo. ${corrAtivos
            ? `Os <strong>${fmtN(corrAtivos)} SKUs de Corrosivos (UN 3264) estão ativos</strong> e sendo comercializados sem a classificação obrigatória na NF.`
            : `<strong>Nenhum SKU de Corrosivos (UN 3264) ou Ácido Sulfúrico (UN 1830) consta ativo no estoque atual</strong> — manter monitoramento, pois qualquer reativação exige a classificação obrigatória na NF.`} Descrição omitida pode ser enquadrada como <strong style="color:#BD2335">tentativa de ocultação de substância controlada</strong> — Lei 8.137/90 (Art. 1º) e Decreto 96.044/88, com responsabilidade pessoal de sócios e diretores pelo Art. 11 da Lei 8.137/90 e Art. 135 do CTN.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">${cartoesPf}</div></div>`;

    $('vg-metricas').innerHTML = `
      <div class="card-metric card-vermelho"><div class="valor" style="color:var(--vermelho)">${fmtN(k.naoConformes)}</div><div class="rotulo">Descrições Incorretas</div><div class="sub">Produtos perigosos sem código ONU</div></div>
      <div class="card-metric card-laranja"><div class="valor" style="color:var(--laranja)">${k.pctNaoConf}</div><div class="rotulo">Taxa de Não Conformidade</div><div class="sub">${fmtN(k.naoConformes)} de ${fmtN(k.skus)} SKUs avaliados</div></div>
      <div class="card-metric card-azul"><div class="valor" style="color:var(--azul)">${k.familias}</div><div class="rotulo">Famílias ONU Identificadas</div><div class="sub">${k.listaOnu.map(o => o.replace('UN ', '')).join(', ')}</div></div>`;

    // classes
    const classes = S.classes.map(c => ({ ...c, qtd: k.porClasse[c.classe] || 0 }));
    const outras = Object.entries(k.porClasse).filter(([c]) => !S.classes.some(x => x.classe === c)).reduce((a, [, n]) => a + n, 0);
    if (outras) classes.push({ classe: 'Outras', nome: 'Classe não padronizada', cor: '#9AA1AA', qtd: outras });
    const pct = n => k.skus ? (n / k.skus * 100).toFixed(1) : '0';
    $('vg-classes-barra').innerHTML = classes.filter(c => c.qtd).map(c => `<div style="width:${pct(c.qtd)}%;background:${c.cor}"></div>`).join('');
    $('vg-classes').innerHTML = classes.map(c => `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px"><div style="width:4px;height:36px;background:${c.cor};border-radius:2px"></div>
          <div><div style="font-size:11px;color:var(--cinza-medio)">${c.classe === 'Outras' ? 'Outras' : 'Cl. ' + esc(c.classe)}</div><div style="font-size:13px;font-weight:600">${esc(c.nome)}</div></div></div>
        <div style="text-align:right"><div style="font-size:28px;font-weight:800;color:${c.cor};line-height:1">${fmtN(c.qtd)}</div><div style="font-size:10px;color:var(--cinza-medio)">${pct(c.qtd)}%</div></div>
      </div>`).join('');

    // ranking ONU
    const ranking = Object.entries(k.porOnu).sort((a, b) => b[1] - a[1]);
    const max = ranking.length ? ranking[0][1] : 1;
    $('vg-onu').innerHTML = ranking.map(([onu, n], i) => {
      const f = fam(onu);
      const c = f.cor || '#9AA1AA';
      const w = (n / max * 100).toFixed(1);
      const rotulo = f.nome_curto ? `${f.nome_curto}${f.classe && f.classe !== '—' ? ' — Cl. ' + f.classe : ''}` : (/^UN \d{4}$/.test(onu) ? 'Família não cadastrada em familias_onu' : 'Sem código ONU');
      return `<div style="display:grid;grid-template-columns:60px 1fr 50px;align-items:center;gap:10px">
        <div style="font-size:12px;font-weight:800;color:${c}">${esc(onu.replace('UN ', ''))}</div>
        <div style="background:var(--cinza-claro);border-radius:4px;height:28px;overflow:hidden;position:relative">
          <div style="position:absolute;inset:0;width:${w}%;background:linear-gradient(90deg,${c},${c}33);border-radius:4px"></div>
          <div style="position:relative;padding:0 10px;height:100%;display:flex;align-items:center"><span style="font-size:11px;font-weight:600;color:${i === 0 ? '#fff' : c}">${esc(rotulo)}</span></div></div>
        <div style="font-size:20px;font-weight:800;color:${c};text-align:right">${fmtN(n)}</div></div>`;
    }).join('') || '<div class="vazio">Sem produtos importados.</div>';

    const estilos = {
      'vermelho': 'background:rgba(189,35,53,.12);border:1px solid rgba(189,35,53,.3)',
      'vermelho-forte': 'background:rgba(189,35,53,.25);border:1px solid rgba(189,35,53,.6)',
      'cinza': 'background:rgba(82,82,82,.12);border:1px solid rgba(82,82,82,.3)',
      'cinza-forte': 'background:rgba(82,82,82,.15);border:1px solid rgba(82,82,82,.4)',
      'verde': 'background:rgba(125,143,100,.12);border:1px solid rgba(125,143,100,.3)',
      'amarelo': 'background:rgba(201,168,57,.12);border:1px solid rgba(201,168,57,.3)'
    };
    $('vg-riscos').innerHTML = bloco('visao_riscos').map(b => {
      const c = cor((b.cor || '').replace('-forte', '')).c;
      const grande = /^R\$/.test(b.destaque || '');
      return `<div style="${estilos[b.cor] || estilos.cinza};border-radius:10px;padding:18px;position:relative;overflow:hidden">
        ${b.tag ? `<div style="position:absolute;top:0;right:0;background:#BD2335;color:white;font-size:9px;font-weight:700;padding:4px 10px;border-radius:0 10px 0 8px">${esc(b.tag)}</div>` : ''}
        <div style="font-size:20px;margin-bottom:8px">${b.icone || ''}</div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${c};margin-bottom:6px">${esc(b.titulo)}</div>
        <div style="font-size:${grande ? 26 : 15}px;font-weight:800;color:${grande ? '#BD2335' : 'var(--cinza-escuro)'};line-height:1.2;margin-bottom:8px">${b.destaque || ''}</div>
        <div style="font-size:11px;color:var(--cinza-medio);line-height:1.5">${tpl(b.corpo)}</div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- base legal
  function renderBaseLegal(normas) {
    $('bl-normas').innerHTML = normas.map(n => `
      <div class="lei-card ${n.destaque ? 'destaque' : ''}">
        <div class="lei-header"><div class="lei-icone" style="background:${n.cor_icone || 'var(--cinza-claro)'}">${n.icone || ''}</div>
          <div><h4>${esc(n.titulo)}</h4><div class="lei-subtitulo">${esc(n.subtitulo)}</div></div></div>
        <p>${tpl(n.descricao)}</p>
        ${n.trecho ? `<div class="trecho">${esc(n.trecho)}</div>` : ''}
        ${n.penalidades.length ? `<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">${n.penalidades.map(p => `<div class="penal"><strong>Penalidade:</strong> ${esc(p)}</div>`).join('')}</div>` : ''}
      </div>`).join('');
  }

  // ---------------------------------------------------------------- tabela ONU
  function renderTabelaOnu(bloco) {
    const fams = S.familias.filter(f => f.na_tabela_ref);
    $('tc-qtd').textContent = fams.filter(f => f.onu !== 'ISENTO').length;
    const risco = f => {
      const g = (f.grau_risco || '').toLowerCase();
      const cl = g.startsWith('alto') || g.startsWith('crít') ? 'risco-alto' : g.startsWith('méd') ? 'risco-medio' : g.startsWith('baixo') ? 'risco-baixo' : 'risco-isento';
      return `<span class="risco ${cl}">${esc(f.grau_risco)}</span>`;
    };
    $('tc-tbody').innerHTML = fams.map(f => `
      <tr style="${f.controle_pf ? 'background:rgba(189,35,53,.1)' : f.onu === 'ISENTO' ? 'background:rgba(125,143,100,.12)' : ''}">
        <td><span class="codigo-mono">${esc(f.onu)}</span></td>
        <td><strong>${esc(f.nome_embarque)}</strong> ${f.inativo ? TAG_INATIVO : ''}</td>
        <td>${esc(f.familia_linha)}</td>
        <td>${badgeClasse(f.classe)}</td>
        <td>${esc(f.significado)}</td>
        <td style="font-weight:700">${esc(f.grupo_embalagem)}</td>
        <td>${risco(f)}</td>
        <td style="text-align:center;font-weight:700">${f.onu === 'ISENTO' ? '—' : fmtN(S.kpi.porOnu[f.onu] || 0)}</td>
        <td style="font-size:11px;color:var(--cinza-medio)">${esc(f.exemplos)}</td>
      </tr>`).join('');

    $('tc-regras').innerHTML = bloco('transporte_regras').map(b => `
      <div><div style="font-weight:700;font-size:13px;margin-bottom:8px;color:${cor(b.cor).c}">${esc(b.titulo)}</div>
      <ul style="font-size:12px;color:var(--cinza-medio);line-height:2;padding-left:16px">${b.itens.map(i => `<li>${tpl(i)}</li>`).join('')}</ul></div>`).join('');

    $('tc-fds-info').innerHTML = bloco('fds_info').map(b => `
      <div style="padding:22px 24px;border-right:1px solid var(--cinza-borda)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--cinza-medio);margin-bottom:10px">${esc(b.titulo)}</div>
        <div style="font-size:17px;font-weight:800;margin-bottom:10px;color:${b.ordem === 2 ? '#7D8F64' : 'var(--cinza-escuro)'}">${esc(b.subtitulo)}</div>
        <p style="font-size:12px;color:var(--cinza-medio);line-height:1.7">${tpl(b.corpo)}</p></div>`).join('');
    const lista = (b, ok) => b ? `
      <div style="padding:20px 24px;border-right:1px solid var(--cinza-borda)">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${ok ? '#7D8F64' : 'var(--cinza-medio)'};margin-bottom:12px">${ok ? '✓' : '✕'} ${esc(b.titulo)}</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px">${b.itens.map(i => `<li style="font-size:12px;color:var(--cinza-medio);line-height:1.6">• ${tpl(i)}</li>`).join('')}</ul></div>` : '';
    $('tc-fds-listas').innerHTML = lista(bloco('fds_obrigatoria')[0], true) + lista(bloco('fds_nao_obrigatoria')[0], false);
  }

  // ---------------------------------------------------------------- antes × depois
  function renderComparativos(lista) {
    $('comparativos').innerHTML = lista.map(c => `
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--cinza-medio);margin-bottom:12px">${esc(c.familia)}</div>
        <div class="desc-errada">✗ ATUAL: ${esc(c.antes)}</div><div class="seta-baixo">↓</div>
        <div class="desc-certa">✓ CORRETO: ${esc(c.depois)}</div>
        <div style="margin-top:10px;padding:10px 14px;background:var(--azul-claro);border-radius:6px;font-size:12px;color:var(--azul-texto)"><strong>Regra:</strong> ${esc(c.regra)}</div>
      </div>`).join('');
  }

  // ---------------------------------------------------------------- estoque (carga sob demanda)
  const EST = { lista: [], filtrada: [], pagina: 1, porPagina: 50 };
  async function abrirEstoque() {
    if (S.estoque) return renderEstoque();
    $('est-contagem').textContent = 'Carregando estoque…';
    try {
      S.estoque = await buscarTudo('estoque', 'id', q => q.eq('linha', 'TINTAS E QUIMICOS'));
    } catch (e) { $('est-contagem').textContent = 'Erro: ' + e.message; return; }
    const uniq = campo => [...new Set(S.estoque.map(d => d[campo]).filter(Boolean))].sort();
    opcoes('est-filial', uniq('filial')); opcoes('est-marca', uniq('marca')); opcoes('est-onu', uniq('onu'));
    filtrarEstoque();
  }
  window.filtrarEstoque = function () {
    if (!S.estoque) return;
    const txt = $('est-busca').value.toLowerCase(), fil = $('est-filial').value, mar = $('est-marca').value,
      onu = $('est-onu').value, risco = $('est-risco').value, ativo = $('est-ativo').value;
    EST.filtrada = S.estoque.filter(d => {
      if (fil && d.filial !== fil) return false;
      if (mar && d.marca !== mar) return false;
      if (onu && d.onu !== onu) return false;
      if (risco && d.risco !== risco) return false;
      if (ativo && (d.ativo ? 'S' : 'N') !== ativo) return false;
      if (txt && !(d.cod_produto || '').includes(txt) && !(d.descricao || '').toLowerCase().includes(txt)
        && !(d.marca || '').toLowerCase().includes(txt) && !(d.descricao_correta || '').toLowerCase().includes(txt)) return false;
      return true;
    });
    EST.pagina = 1;
    renderEstoque();
  };
  function renderEstoque() {
    const L = EST.filtrada, total = L.length;
    const ini = (EST.pagina - 1) * EST.porPagina, fim = Math.min(ini + EST.porPagina, total);
    $('est-contagem').innerHTML = `Exibindo <strong>${total ? ini + 1 : 0}–${fim}</strong> de <strong>${fmtN(total)}</strong> registros`;
    const qtd = L.reduce((a, d) => a + Number(d.qtd), 0), vl = L.reduce((a, d) => a + Number(d.vl_total), 0);
    const nS = L.filter(d => d.ativo).length, nN = total - nS;
    $('estoque-kpis').innerHTML = kpiBox('Registros', fmtN(total), 'var(--cinza-escuro)') + kpiBox('Qtd. Estoque', fmtN(qtd), 'var(--azul)') +
      kpiBox('Vl. Total', fmtR(vl), '#7D8F64') + kpiBox('Ativos', fmtN(nS), '#7D8F64') + kpiBox('Inativos', fmtN(nN), 'var(--vermelho)');
    $('tbody-estoque').innerHTML = L.slice(ini, fim).map(d => `
      <tr style="${d.ativo ? '' : 'opacity:.6;background:#FAFAFA'}">
        <td><strong style="font-size:12px">${esc(d.filial)}</strong></td>
        <td style="font-size:11px;color:var(--cinza-medio)">${esc(d.linha)}</td>
        <td style="font-size:12px;font-weight:600">${esc(d.marca)}</td>
        <td><span class="codigo-mono">${esc(d.cod_produto)}</span></td>
        <td style="font-size:12px;max-width:180px">${esc(d.descricao)}</td>
        <td><span class="codigo-mono">${esc(d.onu)}</span></td>
        <td style="text-align:center">${badgeClasse(d.classe)}</td>
        <td style="font-size:12px;font-weight:600;text-align:center">${esc(d.grupo_embalagem || '—')}</td>
        <td style="text-align:center">${badgeRisco(d.risco)}</td>
        <td style="text-align:right;font-weight:600">${fmtN(d.qtd)}</td>
        <td style="text-align:right;font-size:12px">${fmtR(d.vl_unit)}</td>
        <td style="text-align:right;font-weight:700;color:var(--verde-texto)">${fmtR(d.vl_total)}</td>
        <td style="font-size:11px;color:var(--verde-texto);max-width:220px">${esc(d.descricao_correta)}</td>
        <td style="text-align:center">${d.ativo ? '<span class="pill-s">✅ S</span>' : '<span class="pill-n">❌ N</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="14" class="vazio">Nenhum registro.</td></tr>';
    $('est-totais').innerHTML = `
      <div><div class="lb">Total registros</div><strong>${fmtN(total)}</strong></div>
      <div><div class="lb">Qtd. total estoque</div><strong>${fmtN(qtd)} un.</strong></div>
      <div><div class="lb">Valor total</div><strong style="color:#7D8F64">${fmtR(vl)}</strong></div>
      <div><div class="lb">Ativos / Inativos</div><strong><span style="color:#7D8F64">${nS}</span> / <span style="color:#BD2335">${nN}</span></strong></div>`;
    paginacao($('est-paginacao'), EST.pagina, total, EST.porPagina, p => { EST.pagina = p; renderEstoque(); $('estoque').scrollIntoView({ behavior: 'smooth' }); });
  }

  // ---------------------------------------------------------------- revisão cadastral (carga sob demanda)
  const NI = { filtrada: [], pagina: 1, porPagina: 50 };
  async function abrirRevisao() {
    if (S.revisao) return renderNI();
    $('ni-contagem').textContent = 'Carregando revisão cadastral…';
    try { S.revisao = await buscarTudo('revisao_cadastral'); }
    catch (e) { $('ni-contagem').textContent = 'Erro: ' + e.message; return; }
    const uniq = campo => [...new Set(S.revisao.map(d => d[campo]).filter(Boolean))].sort();
    opcoes('ni-filial', uniq('filial')); opcoes('ni-linha', uniq('linha')); opcoes('ni-marca', uniq('marca'));
    filtrarNI();
  }
  window.filtrarNI = function () {
    if (!S.revisao) return;
    const txt = $('ni-busca').value.toLowerCase(), fil = $('ni-filial').value, lin = $('ni-linha').value,
      mar = $('ni-marca').value, rev = $('ni-revisao').value;
    NI.filtrada = S.revisao.filter(d => {
      if (fil && d.filial !== fil) return false;
      if (lin && d.linha !== lin) return false;
      if (mar && d.marca !== mar) return false;
      if (rev === 'pendente' && d.revisao) return false;
      if (rev === 'revisado' && !d.revisao) return false;
      if (txt && !(d.cod_produto || '').includes(txt) && !(d.descricao || '').toLowerCase().includes(txt) && !(d.marca || '').toLowerCase().includes(txt)) return false;
      return true;
    });
    NI.pagina = 1;
    renderNI();
  };
  function renderNI() {
    const L = NI.filtrada, total = L.length;
    const ini = (NI.pagina - 1) * NI.porPagina, fim = Math.min(ini + NI.porPagina, total);
    $('ni-contagem').innerHTML = `Exibindo <strong>${total ? ini + 1 : 0}–${fim}</strong> de <strong>${fmtN(total)}</strong> registros`;
    const vl = L.reduce((a, d) => a + Number(d.vl_total), 0);
    const pend = L.filter(d => !d.revisao).length, revis = total - pend;
    $('ni-kpis').innerHTML = kpiBox('Registros', fmtN(total), 'var(--cinza-escuro)') + kpiBox('Vl. Total', fmtR(vl), '#7D8F64') +
      kpiBox('Pendentes', fmtN(pend), 'var(--vermelho)') + kpiBox('Revisados', fmtN(revis), '#7D8F64');
    $('tbody-ni').innerHTML = L.slice(ini, fim).map(d => `
      <tr>
        <td><strong style="font-size:12px">${esc(d.filial)}</strong></td>
        <td style="font-size:11px;color:var(--cinza-medio)">${esc(d.linha)}</td>
        <td style="font-size:12px;font-weight:600">${esc(d.marca)}</td>
        <td><span class="codigo-mono">${esc(d.cod_produto)}</span></td>
        <td style="font-size:12px;max-width:200px">${esc(d.descricao)}</td>
        <td style="text-align:right;font-weight:600">${fmtN(d.qtd)}</td>
        <td style="text-align:right;font-size:12px">${fmtR(d.vl_unit)}</td>
        <td style="text-align:right;font-weight:700;color:var(--verde-texto)">${fmtR(d.vl_total)}</td>
        <td style="text-align:center">${d.revisao ? `<span class="pill-s">✅ ${esc(d.revisao)}</span>` : '<span class="pill-p">⏳ PENDENTE</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhum registro.</td></tr>';
    $('ni-totais').innerHTML = `
      <div><div class="lb">Total registros</div><strong>${fmtN(total)}</strong></div>
      <div><div class="lb">Valor total estoque</div><strong style="color:#7D8F64">${fmtR(vl)}</strong></div>
      <div><div class="lb">Pendentes / Revisados</div><strong><span style="color:#BD2335">${pend}</span> / <span style="color:#7D8F64">${revis}</span></strong></div>`;
    paginacao($('ni-paginacao'), NI.pagina, total, NI.porPagina, p => { NI.pagina = p; renderNI(); $('nao-inalantes').scrollIntoView({ behavior: 'smooth' }); });
  }
  window.limparFiltros = function (pref) {
    document.querySelectorAll(`[id^="${pref}-"]`).forEach(el => { if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.value = ''; });
    pref === 'est' ? filtrarEstoque() : filtrarNI();
  };

  // ---------------------------------------------------------------- armazenamento
  function renderArmazenamento(bloco, criterios, exposicao, vistoria, ncs, requisitos, incompat) {
    const locais = bloco('armaz_locais');
    $('ar-qtd-locais').textContent = locais.length;
    const bullet = c => `<div style="width:20px;height:20px;background:${cor(c).bg};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px"><div style="width:7px;height:7px;background:${cor(c).c};border-radius:50%"></div></div>`;
    const cardLocal = b => {
      const c = cor(b.cor), m = b.meta || {};
      return `<div style="background:white;border-radius:12px;border:1px solid var(--cinza-borda);overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <div style="background:${c.c};padding:14px 18px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px"><div style="background:rgba(255,255,255,.2);border-radius:6px;padding:6px 8px;font-size:16px">${b.icone || ''}</div>
            <div><div style="color:white;font-size:13px;font-weight:700">${esc(b.titulo)}</div><div style="color:rgba(255,255,255,.75);font-size:11px">${esc(b.subtitulo)}</div></div></div>
          <span style="background:rgba(0,0,0,.25);color:white;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:uppercase">${esc(b.tag)}</span></div>
        <div style="padding:16px 18px">
          ${m.itens_titulo ? `<div style="font-size:11px;font-weight:700;color:var(--cinza-medio);text-transform:uppercase;margin-bottom:8px">${esc(m.itens_titulo)}</div>` : ''}
          <ul style="list-style:none;display:flex;flex-direction:column;gap:10px">${b.itens.map(i => `<li style="display:flex;gap:10px;align-items:flex-start">${bullet(i.cor)}<div style="font-size:13px;line-height:1.5">${i.texto}</div></li>`).join('')}</ul>
          ${m.aspectos ? `<div style="font-size:11px;font-weight:700;color:var(--cinza-medio);text-transform:uppercase;margin:16px 0 10px">${esc(m.aspectos_titulo)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">${m.aspectos.map(a => `
              <div style="padding:12px;background:${cor(a.cor).bg};border-radius:8px;border-top:3px solid ${cor(a.cor).c}">
                <div style="font-size:10px;font-weight:700;color:${cor(a.cor).t};text-transform:uppercase;margin-bottom:6px">${esc(a.titulo)}</div>
                <div style="font-size:11px;line-height:1.6;margin-bottom:6px">${a.texto}</div>
                <div style="font-size:10px;color:var(--cinza-medio);padding-top:6px">${esc(a.base)}</div></div>`).join('')}</div>` : ''}
          ${m.nota ? `<div style="padding:10px 12px;background:rgba(82,82,82,.1);border-radius:7px;border-left:3px solid var(--azul)"><div style="font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:3px">${esc(m.nota_titulo)}</div><div style="font-size:11px;color:var(--cinza-medio);line-height:1.6">${m.nota}</div></div>` : ''}
          ${m.rodape ? `<div style="margin-top:14px;padding:10px 12px;background:${c.bg};border-radius:7px;border-left:3px solid ${c.c}"><div style="font-size:11px;font-weight:700;color:${c.t};text-transform:uppercase;margin-bottom:3px">${esc(m.rodape_titulo)}</div><div style="font-size:11px;color:var(--cinza-medio)">${esc(m.rodape)}</div></div>` : ''}
        </div></div>`;
    };
    $('ar-locais-1').innerHTML = locais.slice(0, 1).map(cardLocal).join('');
    $('ar-locais-2').innerHTML = locais.slice(1).map(cardLocal).join('');

    $('ar-isolamento').innerHTML = bloco('armaz_isolamento').map(b => {
      let corpo;
      if (b.meta.tipo === 'html') corpo = b.corpo;
      else if (b.meta.tipo === 'alertas') corpo = `<div style="display:flex;flex-direction:column;gap:7px">${b.itens.map(i => `<div style="background:rgba(189,35,53,.1);border-radius:6px;padding:8px 10px"><div style="font-size:11px;font-weight:700;color:#BD2335">${esc(i.titulo)}</div><div style="font-size:10px;color:#BD2335;line-height:1.4">${esc(i.texto)}</div></div>`).join('')}</div>`;
      else corpo = `<ul style="list-style:none;display:flex;flex-direction:column;gap:6px">${b.itens.map(i => `<li style="font-size:11px;color:#525252;line-height:1.4;display:flex;gap:5px"><span style="color:${i.ok ? '#7D8F64' : '#BD2335'}">${i.ok ? '✔' : '✘'}</span><span>${i.texto}</span></li>`).join('')}</ul>`;
      return `<div style="background:white;border-radius:10px;border:1px solid #E2E8F0;overflow:hidden">
        <div style="background:${b.cor};padding:9px 10px;display:flex;align-items:center;gap:6px"><span style="font-size:14px">${b.icone}</span><span style="color:white;font-size:11px;font-weight:700">${esc(b.titulo)}</span></div>
        <div style="padding:10px">${corpo}</div></div>`;
    }).join('');

    // critérios
    $('ar-qtd-crit').textContent = criterios.length;
    const stBadge = { critico: '<span class="risco risco-alto">❌ Crítico</span>', alto: '<span class="risco risco-medio">⚠️ Alto</span>', conforme: '<span class="risco risco-isento">✅ Conforme</span>' };
    const stCor = { critico: 'var(--vermelho-texto)', alto: 'var(--laranja-texto)', conforme: 'var(--verde-texto)' };
    $('ar-criterios').innerHTML = criterios.map(c => `
      <tr><td><strong>${esc(c.criterio)}</strong>${c.local ? `<div style="font-size:11px;color:var(--cinza-medio);margin-top:4px">${esc(c.local)}</div>` : ''}</td>
        <td style="color:${stCor[c.status]};font-size:12px">${c.situacao}${c.situacao_detalhe ? `<span style="color:var(--cinza-medio);font-size:11px;line-height:1.6;display:block;margin-top:4px">${c.situacao_detalhe}</span>` : ''}</td>
        <td style="font-size:12px">${c.exigencia}${c.solucao_pratica ? `<div style="margin-top:6px;padding:6px 10px;background:var(--amarelo-claro);border-radius:5px;font-size:11px;color:#8a7020">${esc(c.solucao_pratica)}</div>` : ''}</td>
        <td style="font-size:11px;color:var(--cinza-medio)">${esc(c.base_normativa)}</td>
        <td>${stBadge[c.status] || esc(c.status)}</td></tr>`).join('');
    const cont = s => criterios.filter(c => c.status === s).length;
    const placar = (n, l, c) => `<div style="background:${cor(c).bg};border-radius:8px;padding:16px;text-align:center"><div style="font-size:36px;font-weight:800;color:${cor(c).c}">${n}</div><div style="font-size:11px;font-weight:700;color:${cor(c).t};text-transform:uppercase;margin-top:4px">${l}</div></div>`;
    $('ar-placar').innerHTML = placar(cont('critico'), 'Não Conformidades Críticas', 'vermelho') + placar(cont('alto'), 'Não Conformidades Altas / Médias', 'laranja') + placar(cont('conforme'), 'Critérios Conformes', 'verde');

    $('ar-como-deveria').innerHTML = bloco('armaz_como_deveria').map(b => `
      <div style="background:var(--verde-claro);border-radius:8px;padding:14px"><div style="font-size:11px;font-weight:700;color:var(--verde-texto);text-transform:uppercase;margin-bottom:8px">${esc(b.titulo)}</div>
      <p style="font-size:13px;line-height:1.7;color:var(--cinza-medio)">${tpl(b.corpo)}</p></div>`).join('');

    $('ar-exposicao').innerHTML = exposicao.map(g => {
      const c = cor(g.cor);
      const col = (t, v, last) => `<div style="padding:14px 16px;${last ? '' : 'border-right:1px solid var(--cinza-borda)'}"><div style="font-size:10px;font-weight:700;color:${c.c};text-transform:uppercase;margin-bottom:6px">${t}</div><div style="font-size:13px">${v}</div></div>`;
      return `<div style="border:1px solid var(--cinza-borda);border-radius:10px;overflow:hidden;margin-bottom:16px">
        <div style="background:${c.bg};padding:14px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--cinza-borda);flex-wrap:wrap">
          <span class="codigo-mono">${esc(g.onu)}</span><div><div style="font-size:14px;font-weight:700">${esc(g.grupo)}</div><div style="font-size:11px;color:var(--cinza-medio)">${g.marcas}</div></div>
          <span class="risco ${g.restricao_nivel === 'alto' ? 'risco-alto' : 'risco-baixo'}" style="margin-left:auto">${esc(g.restricao)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${col('📦 Quantidade Máxima no Salão', g.qtd_max_salao)}${col('🏗️ Local e Exposição', g.local_exposicao)}${col('🪪 Controle de Venda', g.controle_venda)}${col('🧯 Extintor no Ponto', g.extintor, true)}</div>
        <div style="background:${c.bg};padding:10px 16px;border-top:1px solid var(--cinza-borda);font-size:12px">${g.nota}</div></div>`;
    }).join('');
    $('ar-exposicao-resumo').innerHTML = exposicao.map(g => `
      <tr><td style="font-weight:600">${esc(g.grupo)}</td><td><span class="codigo-mono">${esc(g.onu.replace('UN ', ''))}</span></td>
      <td style="font-weight:700">${esc(g.qtd_max_resumo)}</td><td style="color:var(--cinza-medio)">${esc(g.tipo_exposicao)}</td>
      <td style="color:#7D8F64;font-weight:700">${esc(g.verif_idade)}</td><td>${esc(g.extintor_resumo)}</td></tr>`).join('');

    // fotos das não conformidades
    $('ar-ncs').innerHTML = ncs.map(nc => {
      const fotos = S.ncFotos.filter(f => f.nc_codigo === nc.codigo);
      const c = cor(nc.cor);
      return `<div style="margin-bottom:24px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap"><div style="width:4px;height:20px;background:${c.c};border-radius:2px"></div>
          <h4 style="font-size:14px;font-weight:700">${nc.severidade === 'Crítico' ? '🔴' : '⚠️'} ${esc(nc.codigo)} — ${esc(nc.titulo)}</h4>
          <span class="risco ${nc.severidade === 'Crítico' ? 'risco-alto' : 'risco-medio'}">${esc(nc.severidade)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
          ${fotos.map(f => `<div class="nc-foto" data-id="${f.id}"><div style="position:relative"><img src="${f.url}" alt="${esc(f.rotulo || nc.codigo)}" loading="lazy">
            ${f.rotulo ? `<div class="nc-rot">${esc(f.rotulo)}</div>` : ''}${f.destaque ? `<div class="nc-dest">${esc(f.destaque)}</div>` : ''}</div></div>`).join('') || '<div class="vazio">Sem fotos importadas.</div>'}
        </div></div>`;
    }).join('');
    $('ar-ncs').querySelectorAll('.nc-foto').forEach(el => el.onclick = () => {
      const f = S.ncFotos.find(x => x.id === +el.dataset.id);
      const lista = S.ncFotos.filter(x => x.nc_codigo === f.nc_codigo);
      lbAbrir(lista, lista.indexOf(f));
    });

    $('ar-vistoria').innerHTML = vistoria.map(v => `
      <tr style="${v.destaque ? 'background:rgba(189,35,53,.1)' : ''}"><td><strong>${esc(v.produto)}</strong></td><td>${esc(v.marca)}</td><td>${esc(v.volume)}</td>
      <td><span class="codigo-mono">${esc(v.onu)}</span> ${badgeClasse(v.classe)}</td>
      <td style="font-size:12px;color:${v.restricao_nivel === 'alto' ? 'var(--vermelho-texto)' : 'var(--laranja-texto)'}">${v.restricao_venda}</td>
      <td style="font-size:12px">${esc(v.local_encontrado)}</td></tr>`).join('');

    $('ar-consequencias').innerHTML = bloco('armaz_consequencias').map(b => `
      <div class="consequencia" style="border-left:4px solid ${cor(b.cor).c}"><div class="ico">${b.icone}</div><div><h5>${esc(b.titulo)}</h5><p>${tpl(b.corpo)}</p></div></div>`).join('');

    const estilo = { vermelho: 'card card-vermelho', laranja: 'card card-laranja', amarelo: 'card', verde: 'card', cinza: 'card', critico: 'card card-vermelho' };
    $('ar-requisitos').innerHTML = S.familias.filter(f => f.req_titulo).map(f => {
      const c = f.req_estilo === 'critico' ? cor('vermelho') : cor(f.req_estilo);
      const reqs = requisitos.filter(r => r.onu === f.onu);
      const cls = f.req_risco.includes('Alto') || f.req_estilo === 'critico' ? 'risco-alto' : f.req_risco.includes('Baixo') ? 'risco-baixo' : 'risco-medio';
      return `<div class="${estilo[f.req_estilo] || 'card'}" style="margin-bottom:20px;${['amarelo', 'verde', 'cinza'].includes(f.req_estilo) ? `border-left:4px solid ${c.c};` : ''}${f.req_estilo === 'critico' ? 'background:rgba(189,35,53,.1)' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:14px">
            <div style="background:${f.req_estilo === 'critico' ? '#BD2335' : c.bg};border-radius:8px;padding:10px 14px;text-align:center;min-width:80px">
              <div style="font-size:13px;font-weight:700;color:${f.req_estilo === 'critico' ? '#fff' : c.t}">${esc(f.onu)}</div>
              <div style="font-size:10px;color:${f.req_estilo === 'critico' ? 'rgba(255,255,255,.8)' : c.t};text-transform:uppercase">${esc(f.nome_curto)}</div></div>
            <div><h3 style="margin:0;font-size:17px">${esc(f.req_titulo)} ${f.inativo ? TAG_INATIVO : ''}</h3><p style="font-size:12px;color:var(--cinza-medio);margin-top:3px">${esc(f.req_subtitulo)}${f.onu !== 'ISENTO' ? ` — ${fmtN(S.kpi.porOnu[f.onu] || 0)} SKUs na base` : ''}</p></div></div>
          <span class="risco ${cls}" style="align-self:center">${esc(f.req_risco)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          ${reqs.map(r => `<div style="background:white;border-radius:8px;border:1px solid var(--cinza-borda);padding:14px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${c.c};margin-bottom:8px">${r.icone || ''} ${esc(r.topico)}</div><p style="font-size:13px;line-height:1.7;color:var(--cinza-medio)">${r.texto}</p></div>`).join('')}
        </div></div>`;
    }).join('');

    const sev = { critica: 'color:var(--vermelho);font-weight:700', alta: 'color:var(--vermelho)', media: 'color:var(--laranja)', baixa: 'color:#C9A839' };
    $('ar-incompat').innerHTML = incompat.map(i => `
      <tr style="${i.severidade === 'critica' ? 'background:rgba(189,35,53,.1)' : ''}"><td><span class="codigo-mono">${esc(i.onu)}</span> ${esc(i.produto)}</td>
      <td>${i.incompativel_com}</td><td style="font-size:13px;${sev[i.severidade] || ''}">${esc(i.risco)}</td></tr>`).join('');
  }

  // ---------------------------------------------------------------- concorrência
  function renderConcorrencia(prods, crit) {
    $('cc-produtos').innerHTML = prods.map(p => `
      <div style="background:rgba(189,35,53,.06);border:2px solid ${p.cor};border-radius:10px;overflow:hidden">
        <div style="background:${p.cor};padding:14px 20px;display:flex;align-items:center;gap:12px">
          <div style="background:white;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;color:${p.cor}">${esc(p.empresa)}</div>
          <span style="color:white;font-size:13px;font-weight:600">${esc(p.site)}</span></div>
        <div style="padding:16px 20px">
          <div style="font-size:12px;color:var(--cinza-medio);margin-bottom:10px;text-transform:uppercase;font-weight:600">Produto analisado</div>
          <div style="font-size:13px;font-weight:600;background:white;padding:10px 14px;border-radius:6px;border:1px solid var(--cinza-borda)">${esc(p.produto)}</div>
          <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:white;padding:10px;border-radius:6px;border:1px solid var(--cinza-borda);text-align:center"><div style="font-size:10px;color:var(--cinza-medio);text-transform:uppercase">Preço</div><div style="font-size:18px;font-weight:700">${p.preco != null ? fmtR(p.preco) : '—'}</div><div style="font-size:10px;color:var(--cinza-medio)">${esc(p.volume)}</div></div>
            <div style="background:white;padding:10px;border-radius:6px;border:1px solid var(--cinza-borda);text-align:center"><div style="font-size:10px;color:var(--cinza-medio);text-transform:uppercase">Marca</div><div style="font-size:14px;font-weight:700">${esc(p.marca)}</div><div style="font-size:10px;color:var(--cinza-medio)">${esc(p.linha_marca)}</div></div>
          </div></div></div>`).join('');
    $('cc-placar').innerHTML = prods.slice().reverse().map((p, i) => `
      ${i ? '<div style="font-size:24px;color:var(--cinza-medio);font-weight:300">vs</div>' : ''}
      <div style="text-align:center"><div style="font-size:32px;font-weight:800;color:${p.cor}">${esc(p.placar)}</div><div style="font-size:11px;color:var(--cinza-medio);text-transform:uppercase">${esc(p.resumo_titulo)}</div></div>`).join('');
    $('cc-criterios').innerHTML = crit.map(c => `
      <tr><td><strong style="font-size:13px">${esc(c.criterio)}</strong><br><span style="font-size:11px;color:var(--cinza-medio)">${esc(c.criterio_detalhe)}</span></td>
      <td>${c.concorrente_html}</td><td>${c.nossa_html}</td><td style="text-align:center"><span class="risco risco-isento">${esc(c.vantagem)}</span></td></tr>`).join('');
    $('cc-resumos').innerHTML = prods.map(p => `
      <div class="card" style="border-top:4px solid ${p.cor}"><h3 style="color:${p.cor}">${esc(p.resumo_titulo)}</h3>
      <div style="font-size:12px;color:var(--cinza-medio);margin-bottom:10px;font-style:italic">${esc(p.resumo_sub)}</div>
      <ul style="font-size:13px;line-height:2.1;color:var(--cinza-medio);padding-left:16px">${p.pontos.map(x => `<li>${x}</li>`).join('')}</ul></div>`).join('');
  }

  // ---------------------------------------------------------------- roteiro do plano
  function renderRoteiro(roteiro) {
    $('pl-roteiro').innerHTML = roteiro.map(r => {
      const c = cor(r.cor);
      return `<div style="margin-bottom:24px;position:relative">
        <div style="position:absolute;left:-32px;width:24px;height:24px;border-radius:50%;background:${c.c};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;top:16px">${r.etapa}</div>
        <div class="card" style="border-left:4px solid ${c.c}"><h3>${esc(r.titulo)} <span class="badge" style="background:${c.bg};color:${c.t}">${esc(r.badge)}</span></h3>
        <ul style="font-size:13px;line-height:2.2;color:var(--cinza-medio);padding-left:16px">${r.itens.map(i => `<li>${tpl(i)}</li>`).join('')}</ul></div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- plano 5W2H
  let graficoPlano = null;
  function renderPlano5w2h(fases, acoes) {
    const hoje = new Date().toISOString().slice(0, 10);
    const atrasada = a => a.status === 'Atrasado' || (a.prazo && a.prazo < hoje && !['Concluído', 'Cancelado'].includes(a.status));
    const total = acoes.length;
    const conc = acoes.filter(a => a.status === 'Concluído').length;
    const andam = acoes.filter(a => a.status === 'Em andamento').length;
    const atr = acoes.filter(atrasada).length;
    const pct = total ? Math.round(acoes.reduce((s, a) => s + a.percentual, 0) / total) : 0;
    const k = (n, l, c) => `<div class="pa-kpi" style="--kpi-c:${c}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`;
    $('pa-kpis').innerHTML = k(total, 'Total de Ações', '#333') + k(conc, 'Concluídas', '#BD2335') + k(pct + '%', '% Concluído', '#C9A839') + k(andam, 'Em Andamento', '#1E88E5') + k(atr, 'Atrasadas', '#E53935');
    $('pa-barra').style.width = pct + '%';
    $('pa-barra-pct').textContent = pct + '%';

    $('pa-fases').innerHTML = fases.map(f => {
      const af = acoes.filter(a => a.fase === f.nome);
      if (!af.length) return `<tr style="opacity:.45"><td><div style="font-weight:600">${esc(f.nome)}</div><div style="font-size:10px;color:#aaa;font-style:italic">Não preenchida</div></td><td style="text-align:center;color:#ccc">—</td><td style="text-align:center;color:#ccc">—</td><td style="text-align:center;color:#ccc">—</td></tr>`;
      const c = af.filter(a => a.status === 'Concluído').length;
      return `<tr><td><div style="font-weight:600">${esc(f.nome)}</div><div class="pa-fase-bar"><div class="pa-fase-bar-fill" style="width:${Math.round(c / af.length * 100)}%"></div></div></td>
        <td style="text-align:center;font-weight:700;color:#BD2335">${af.length}</td><td style="text-align:center;font-weight:700;color:#7D8F64">${c}</td><td style="text-align:center;font-weight:700;color:#E53935">${af.filter(atrasada).length}</td></tr>`;
    }).join('');

    const ST = [['Não iniciado', '#D8D8D8', 'pb-ni'], ['Em andamento', '#DBECFB', 'pb-and'], ['Concluído', '#D6EDD9', 'pb-ok'], ['Atrasado', '#FADBDB', 'pb-atr'], ['Cancelado', '#EDEDED', 'pb-can']];
    const contSt = ST.map(([s]) => s === 'Atrasado' ? atr : acoes.filter(a => a.status === s && !(atrasada(a) && s !== 'Atrasado')).length);
    $('pa-legenda').innerHTML = ST.map(([s, c], i) => `<div class="pa-legend-item"><div class="pa-legend-dot" style="background:${c}"></div><span style="color:#555">${s}</span><strong style="margin-left:auto;padding-left:12px">${contSt[i]}</strong></div>`).join('');
    if (window.Chart) {
      if (graficoPlano) graficoPlano.destroy();
      graficoPlano = new Chart($('paStatusChart'), {
        type: 'doughnut',
        data: { labels: ST.map(s => s[0]), datasets: [{ data: contSt, backgroundColor: ST.map(s => s[1]), borderWidth: 1.5, hoverOffset: 6 }] },
        options: { responsive: false, cutout: '68%', plugins: { legend: { display: false } } }
      });
    }
    const fasesUsadas = [...new Set(acoes.map(a => a.fase))];
    $('pa-resumo').textContent = `${total} ações · ${fasesUsadas.join(', ')}`;
    const prio = { 'Alta': 'pb-alta', 'Média': 'pb-media', 'Baixa': 'pb-baixa' };
    const dataBR = d => d ? new Date(d + 'T00:00').toLocaleDateString('pt-BR') : '—';
    const diasAte = d => Math.round((new Date(d + 'T00:00') - new Date(hoje + 'T00:00')) / 864e5);
    $('pa-acoes').innerHTML = acoes.map(a => {
      const st = atrasada(a) ? 'Atrasado' : a.status;
      const cls = (ST.find(s => s[0] === st) || [])[2] || 'pb-ni';
      let dias = '';
      if (a.prazo && !['Concluído', 'Cancelado'].includes(a.status)) {
        const n = diasAte(a.prazo);
        dias = `<div style="font-size:10px;font-weight:700;color:${n < 0 ? '#E53935' : n <= 7 ? '#C9A839' : '#7D8F64'}">${n < 0 ? Math.abs(n) + ' dia(s) de atraso' : n === 0 ? 'vence hoje' : 'faltam ' + n + ' dia(s)'}</div>`;
      } else if (!a.prazo && !['Concluído', 'Cancelado'].includes(a.status)) {
        dias = '<div style="font-size:10px;color:#aaa;font-style:italic">sem prazo definido</div>';
      }
      return `<tr><td style="text-align:center;font-weight:700;color:#aaa">${a.numero}</td>
        <td><span class="pb ${prio[a.prioridade] || 'pb-ni'}">${esc(a.prioridade)}</span></td>
        <td style="font-weight:600">${esc(a.o_que)}${a.observacoes ? `<div style="font-weight:400;font-size:11px;color:#888;margin-top:4px">Obs.: ${esc(a.observacoes)}</div>` : ''}</td>
        <td>${esc(a.por_que)}</td><td>${esc(a.onde)}</td>
        <td><strong>${esc(a.quem)}</strong><br><span style="color:#aaa;font-size:11px">${esc(a.quem_area)}</span></td>
        <td>${esc(a.como)}</td><td style="color:#aaa;font-size:12px">${esc(a.quanto)}</td><td>${esc(a.gestor || '—')}</td>
        <td style="font-size:12px;white-space:nowrap">${dataBR(a.inicio)}</td>
        <td style="font-size:12px;white-space:nowrap">${dataBR(a.prazo)}${dias}</td>
        <td><span class="pb ${cls}">${esc(st)}</span></td>
        <td style="text-align:center;font-weight:700;color:#aaa">${a.percentual}%</td></tr>`;
    }).join('');
  }

  // ---------------------------------------------------------------- atualizar plano a partir do Excel (administradores)
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  function carregarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = ok; s.onerror = () => falha(new Error('não foi possível carregar o leitor de Excel (verifique a internet)'));
      document.head.appendChild(s);
    });
  }
  function lerPlanoExcel(wb) {
    const nomeAba = wb.SheetNames.find(n => norm(n).includes('5W2H')) || wb.SheetNames.find(n => norm(n).includes('PLANO')) || wb.SheetNames[0];
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: '', raw: true });
    const iCab = linhas.findIndex(r => r.some(c => norm(c) === 'FASE') && r.some(c => norm(c).startsWith('O QUE')));
    if (iCab < 0) throw new Error(`não encontrei o cabeçalho (FASE / O QUÊ?) na aba "${nomeAba}"`);
    const cab = linhas[iCab].map(norm);
    const col = (...prefixos) => cab.findIndex(c => prefixos.some(p => c.startsWith(p)));
    const C = {
      id: col('ID', '#'), fase: col('FASE'), prio: col('PRIORIDADE'), oque: col('O QUE'), porque: col('POR QUE'),
      onde: col('ONDE'), area: col('QUEM'), colab: col('COLABORADOR'), gestor: col('GESTOR'), como: col('COMO'),
      quanto: col('QUANTO'), inicio: col('INICIO'), prazo: col('PRAZO'), status: col('STATUS'), pct: col('% CONCL', '%'), obs: col('OBSERV')
    };
    const v = (r, i) => i >= 0 ? r[i] : '';
    const txt = (r, i) => { const x = String(v(r, i) == null ? '' : v(r, i)).trim(); return x || null; };
    const data = (r, i) => {
      const x = v(r, i);
      if (x instanceof Date) return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
      if (typeof x === 'number' && x > 20000) { const d = XLSX.SSF.parse_date_code(x); return d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'); }
      const m = String(x || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
      return null;
    };
    const fase = bruta => {
      const n = (String(bruta).match(/\d+/) || [])[0];
      const f = n ? S.fases.find(x => (x.nome.match(/\d+/) || [])[0] === n) : S.fases.find(x => norm(x.nome) === norm(bruta));
      return f ? f.nome : (S.fases.find(x => norm(x.nome) === 'OUTROS') || {}).nome || null;
    };
    const statusValidos = ['Não iniciado', 'Em andamento', 'Concluído', 'Atrasado', 'Cancelado'];
    return linhas.slice(iCab + 1)
      .filter(r => txt(r, C.oque) && txt(r, C.fase))
      .map((r, k) => {
        let pct = Number(v(r, C.pct)) || 0;
        if (pct > 0 && pct <= 1) pct = pct * 100;
        const st = statusValidos.find(s => norm(s) === norm(v(r, C.status))) || 'Não iniciado';
        return {
          numero: Number(v(r, C.id)) || k + 1, fase: fase(v(r, C.fase)), prioridade: txt(r, C.prio) || 'Média',
          o_que: txt(r, C.oque), por_que: txt(r, C.porque), onde: txt(r, C.onde), quem_area: txt(r, C.area),
          quem: txt(r, C.colab), gestor: txt(r, C.gestor), como: txt(r, C.como), quanto: txt(r, C.quanto),
          inicio: data(r, C.inicio), prazo: data(r, C.prazo), status: st,
          percentual: Math.max(0, Math.min(100, Math.round(pct))), observacoes: txt(r, C.obs)
        };
      });
  }
  let excelPendente = null;
  async function importarPlanoExcel(arquivo) {
    const aviso = $('pa-import-msg');
    const msg = (t, erro) => { aviso.hidden = false; aviso.textContent = t; aviso.style.color = erro ? '#B71C1C' : '#1B5E20'; aviso.style.background = erro ? '#FFE0E0' : '#D6EDD9'; };
    try {
      msg('Lendo planilha…');
      await carregarSheetJS();
      const wb = XLSX.read(await arquivo.arrayBuffer(), { cellDates: true });
      const acoes = lerPlanoExcel(wb);
      if (!acoes.length) throw new Error('nenhuma ação encontrada na planilha');
      if (excelPendente !== arquivo.name + arquivo.size) {
        excelPendente = arquivo.name + arquivo.size;
        msg(`Encontradas ${acoes.length} ações em "${arquivo.name}". O plano atual será SUBSTITUÍDO. Selecione o mesmo arquivo de novo para confirmar.`, true);
        return;
      }
      excelPendente = null;
      msg('Atualizando plano no Supabase…');
      const { error: eDel } = await sb.from('plano_acao').delete().gte('id', 0);
      if (eDel) throw eDel;
      const { error: eIns } = await sb.from('plano_acao').insert(acoes);
      if (eIns) throw eIns;
      msg('Enviando a planilha para o Storage…');
      const path = 'documentos/Plano_5W2H_FC.xlsx';
      const { error: eUp } = await sb.storage.from(BUCKET).upload(path, arquivo, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      if (eUp) throw eUp;
      const doc = { chave: 'plano_5w2h_xlsx', nome_arquivo: arquivo.name, storage_path: path, descricao: 'Plano de Ação 5W2H' };
      const { error: eDoc } = await sb.from('documentos').upsert(doc);
      if (eDoc) throw eDoc;
      S.documentos.plano_5w2h_xlsx = doc;
      const novas = await buscar('plano_acao', 'numero');
      renderPlano5w2h(S.fases, novas);
      msg(`Plano atualizado: ${novas.length} ações importadas e planilha "${arquivo.name}" disponível em BAIXAR EXCEL.`);
    } catch (e) {
      excelPendente = null;
      msg('Erro ao importar: ' + (e.message || e), true);
    }
  }
  $('pa-xlsx-input').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarPlanoExcel(f); });

  // ---------------------------------------------------------------- recebimento
  function renderRecebimento(passos, prazos) {
    const item = p => `<div class="rb-tl-item"><div class="rb-tl-num">${p.ordem}</div><div class="rb-tl-card">
      <h4>${esc(p.titulo)}${p.local_tag ? ` <span class="rb-tag-loc">${esc(p.local_tag)}</span>` : ''}</h4><p>${p.descricao}</p>
      ${p.mostra_nf && S.nf.length ? `<div class="rb-nf-inline">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px"><span class="rb-nf-inline-label">Evidência — nota fiscal deste recebimento</span>
        <span style="font-size:11px;color:#525252;background:#fff;border:1px solid #DEE2E6;border-radius:20px;padding:4px 10px">🔍 Clique para ampliar · zoom · girar</span></div>
        <div class="rb-nf-inline-grid">${S.nf.map((n, i) => `<div class="rb-nf-inline-card" data-nf="${i}"><img src="${n.url}" alt="${esc(n.titulo)}"><div class="rb-nf-inline-cap"><span class="rb-nf-inline-cap-t">${esc(n.titulo)}</span><span class="rb-nf-inline-cap-d">${esc(n.descricao)}</span></div></div>`).join('')}</div></div>` : ''}
      </div></div>`;
    $('rb-agendamento').innerHTML = passos.filter(p => p.processo === 'agendamento').map(item).join('');
    $('rb-fluxo').innerHTML = passos.filter(p => p.processo === 'recebimento').map(item).join('');
    $('rb-prazos').innerHTML = prazos.map(p => `<tr><td>${esc(p.faixa)}</td><td>${esc(p.prazo)}</td></tr>`).join('');
    document.querySelectorAll('[data-nf]').forEach(el => el.onclick = () => lbAbrir(S.nf, +el.dataset.nf));
  }

  // galeria do recebimento (com inclusão de fotos e edição de legendas persistidas no Supabase)
  let filtroGaleria = 'todos';
  function renderGaleria() {
    const G = S.galeria;
    $('rg-n-registros').textContent = G.length;
    const onus = [...new Set(G.map(g => g.onu).filter(Boolean))].sort();
    $('rg-n-familias').textContent = onus.length;
    $('rg-filtros').innerHTML = [['todos', 'Todos']].concat(onus.map(o => {
      const f = S.familias.find(x => x.onu === 'UN ' + o);
      return [o, 'ONU ' + o + (f ? ' — ' + f.nome_curto : '')];
    })).map(([v, l]) => `<button class="rg-filtro ${v === filtroGaleria ? 'ativo' : ''}" data-f="${v}">${esc(l)}</button>`).join('');
    $('rg-filtros').querySelectorAll('button').forEach(b => b.onclick = () => { filtroGaleria = b.dataset.f; renderGaleria(); });
    const lista = filtroGaleria === 'todos' ? G : G.filter(g => g.onu === filtroGaleria);
    $('rg-grid').innerHTML = lista.map((g, i) => `
      <div class="rg-card ${i === 0 ? 'rg-featured' : ''}" data-i="${i}"><img src="${g.url}" alt="${esc(g.titulo)}" loading="lazy">
        ${g.onu ? `<div class="rg-card-badge">ONU ${esc(g.onu)}</div>` : ''}
        <div class="rg-card-info"><div class="rg-card-info-title">${esc(g.titulo)}</div><div class="rg-card-info-desc">${esc(g.descricao)}</div></div></div>`).join('')
      || '<div class="vazio">Nenhuma foto cadastrada.</div>';
    $('rg-grid').querySelectorAll('.rg-card').forEach(el => el.onclick = () => lbAbrir(lista, +el.dataset.i, true));
  }
  function onuDaDescricao(d) { return d && d.includes('1950') ? '1950' : d && d.includes('1263') ? '1263' : null; }

  // ---------------------------------------------------------------- evidências por filial (carga sob demanda)
  async function abrirEvidenciasFiliais() {
    if (S.evFiliais) return;
    $('evPanels').innerHTML = '<div class="vazio">Carregando fotos…</div>';
    try {
      const ev = await buscar('evidencias', 'ordem', q => q.eq('categoria', 'vistoria_filial'));
      await urlsAssinadas(ev);
      S.evFiliais = ev;
    } catch (e) { $('evPanels').innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; return; }
    const filiais = S.filiais.filter(f => S.evFiliais.some(e => e.filial === f.codigo));
    $('evTabs').innerHTML = filiais.map((f, i) => `<div class="ev-tab ${i ? '' : 'ev-ativo'}" data-cod="${esc(f.codigo)}">${esc(f.codigo)} — ${esc(f.nome)}</div>`).join('');
    const mostrar = cod => {
      document.querySelectorAll('.ev-tab').forEach(t => t.classList.toggle('ev-ativo', t.dataset.cod === cod));
      const f = S.filiais.find(x => x.codigo === cod);
      const fotos = S.evFiliais.filter(e => e.filial === cod);
      $('evPanels').innerHTML = `<div class="ev-filial-header"><span class="ev-filial-badge">${esc(cod)}</span><span style="font-size:18px;font-weight:800">${esc(f.nome)}</span>
        <span style="font-size:12px;color:var(--cinza-medio)">${fotos.length} foto${fotos.length !== 1 ? 's' : ''}</span>
        <span style="font-size:11px;color:var(--cinza-medio);margin-left:auto;font-style:italic">🔍 Clique na imagem para ampliar</span></div>
        <div class="ev-gallery">${fotos.map((p, i) => `<div class="ev-img-wrap" data-i="${i}"><img src="${p.url}" alt="Foto ${i + 1}" loading="lazy"><span class="ev-img-num">${i + 1}</span></div>`).join('')}</div>`;
      $('evPanels').querySelectorAll('.ev-img-wrap').forEach(el => el.onclick = () => lbAbrir(fotos, +el.dataset.i));
    };
    $('evTabs').querySelectorAll('.ev-tab').forEach(t => t.onclick = () => mostrar(t.dataset.cod));
    if (filiais.length) mostrar(filiais[0].codigo); else $('evPanels').innerHTML = '<div class="vazio">Nenhuma foto importada.</div>';
  }

  // ---------------------------------------------------------------- lightbox único
  const LB = { lista: [], i: 0, rot: 0, sc: 1, editavel: false };
  function lbAplicar() { $('lb-img').style.transform = `rotate(${LB.rot}deg) scale(${LB.sc})`; $('lb-zoom').textContent = Math.round(LB.sc * 100) + '%'; }
  function lbMostrar() {
    const f = LB.lista[LB.i];
    $('lb-img').src = f.url;
    $('lb-title').textContent = f.titulo || f.rotulo || '';
    $('lb-desc').textContent = f.descricao || '';
    $('lb-counter').textContent = (LB.i + 1) + ' / ' + LB.lista.length;
    $('lb-edit-btn').hidden = !LB.editavel;
    lbEditar(false);
    LB.rot = 0; LB.sc = 1; lbAplicar();
  }
  function lbAbrir(lista, i, editavel) {
    LB.lista = lista; LB.i = i; LB.editavel = !!editavel;
    lbMostrar();
    $('lb').classList.add('ativo');
    document.body.style.overflow = 'hidden';
  }
  window.lbFechar = () => { $('lb').classList.remove('ativo'); document.body.style.overflow = ''; };
  window.lbNav = d => { LB.i = (LB.i + d + LB.lista.length) % LB.lista.length; lbMostrar(); };
  window.lbGirar = d => { LB.rot = (LB.rot + d + 360) % 360; lbAplicar(); };
  window.lbZoom = d => { LB.sc = Math.max(0.2, Math.min(5, LB.sc + d)); lbAplicar(); };
  window.lbReset = () => { LB.rot = 0; LB.sc = 1; lbAplicar(); };
  window.lbEditar = function (on) {
    $('lb-view').hidden = on; $('lb-edit').hidden = !on;
    if (on) {
      const f = LB.lista[LB.i];
      $('lb-edit-title').value = f.titulo || ''; $('lb-edit-desc').value = f.descricao || '';
      setTimeout(() => $('lb-edit-title').focus(), 50);
    }
  };
  window.lbSalvar = async function () {
    const f = LB.lista[LB.i];
    const titulo = $('lb-edit-title').value.trim(), descricao = $('lb-edit-desc').value.trim();
    if (!titulo) return;
    const { error } = await sb.from('evidencias').update({ titulo, descricao, onu: onuDaDescricao(descricao) }).eq('id', f.id);
    if (error) { alert('Não foi possível salvar: ' + error.message); return; }
    Object.assign(f, { titulo, descricao, onu: onuDaDescricao(descricao) });
    lbMostrar();
    renderGaleria();
  };
  $('lb').addEventListener('click', e => { if (e.target === $('lb') || e.target === $('lb-vp')) lbFechar(); });
  $('lb-vp').addEventListener('wheel', e => { e.preventDefault(); lbZoom(e.deltaY < 0 ? 0.15 : -0.15); }, { passive: false });
  document.addEventListener('keydown', e => {
    if (!$('lb').classList.contains('ativo') || !$('lb-edit').hidden) return;
    if (e.key === 'Escape') lbFechar();
    if (e.key === 'ArrowRight') lbNav(1);
    if (e.key === 'ArrowLeft') lbNav(-1);
    if (e.key === '+') lbZoom(0.25);
    if (e.key === '-') lbZoom(-0.25);
    if (e.key === 'r' || e.key === 'R') lbGirar(90);
    if (e.key === '0') lbReset();
  });

  // ---------------------------------------------------------------- permissões na interface
  // A segurança real está no banco (RLS); aqui apenas escondemos o que o perfil não pode ver.
  const ABAS_DOC = ['contexto', 'base-legal', 'tabela-codigos', 'visao-geral', 'estoque', 'nao-inalantes',
    'antes-depois', 'concorrencia', 'plano-acao', 'armazenamento', 'evidencias'];
  const pode = aba => !!S.acesso && (S.acesso.admin || (S.acesso.abas || []).includes(aba));

  function aplicarAcesso() {
    const a = S.acesso;
    // abas do documento
    let primeira = null;
    document.querySelectorAll('.tabs .tab').forEach(t => {
      const id = ((t.getAttribute('onclick') || '').match(/mudarAba\('([^']+)'/) || [])[1];
      const ok = pode(id);
      t.hidden = !ok;
      if (!ok) $(id).classList.remove('ativa');
      if (ok && !primeira) primeira = t;
    });
    const temDoc = ABAS_DOC.some(pode);
    // etapas da barra lateral
    document.querySelectorAll('#sb-etapas .sb-steprow').forEach(b => {
      const n = +b.dataset.n;
      if (n === 1) b.hidden = !temDoc;
      if (n === 2) b.hidden = !pode('recebimento');
    });
    // botões do painel 5W2H
    document.querySelectorAll('[onclick*="abrirPlanoAcao"]').forEach(b => { b.hidden = !pode('plano5w2h'); });
    document.querySelectorAll('[onclick*="baixarDocumento"]').forEach(b => { b.hidden = !(pode('plano5w2h') || pode('plano-acao')); });
    // administração
    $('sb-admin-grupo').hidden = !a.admin;
    $('pa-btn-importar').hidden = !a.admin;
    $('sb-usuario').textContent = (a.nome || '') + (a.admin ? ' · Administradora' : a.perfil ? ' · ' + a.perfil : '');

    if (temDoc && primeira) {
      if (!document.querySelector('.secao.ativa') || document.querySelector('.tabs .tab.ativo[hidden]') || !document.querySelector('.tabs .tab.ativo')) primeira.click();
    } else if (pode('recebimento')) {
      document.querySelector('#sb-etapas .sb-steprow[data-n="2"]').click();
    } else if (pode('plano5w2h')) {
      abrirPlanoAcao();
    } else {
      document.body.classList.add('modo-fluxo');
      mostrarVista('view-sem-abas');
    }
  }

  // ---------------------------------------------------------------- administração de usuários e perfis
  const ADM = { abas: [], perfis: [], usuarios: [] };

  window.abrirAdmin = async function (el) {
    if (!S.acesso || !S.acesso.admin) return;
    mostrarVista('view-admin');
    limparAtivos(); if (el) el.classList.add('sb-active');
    await admCarregar();
  };

  async function admCarregar() {
    $('adm-msg').textContent = 'Carregando…';
    try {
      const [abas, perfis, usuarios] = await Promise.all([buscar('abas', 'ordem'), buscar('perfis_acesso', 'nome'), buscar('usuarios', 'nome')]);
      const { data: adms } = await sb.from('administradores').select('user_id');
      Object.assign(ADM, { abas, perfis, usuarios });
      ADM.admins = new Set((adms || []).map(a => a.user_id));
      // A política de administradores só mostra a própria linha; a própria usuária é administradora
      const { data: eu } = await sb.auth.getUser();
      ADM.eu = eu.user && eu.user.id;
      $('adm-msg').textContent = '';
      admRenderPerfis(); admRenderUsuarios(); admRenderFormUsuario();
    } catch (e) { $('adm-msg').textContent = 'Erro: ' + e.message; }
  }

  function admOpcoesPerfil(sel) {
    return '<option value="">— sem acesso —</option>' + ADM.perfis.map(p => `<option value="${p.id}" ${String(p.id) === String(sel) ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
  }

  function admRenderFormUsuario() {
    $('adm-nu-perfil').innerHTML = admOpcoesPerfil('');
  }

  function admRenderUsuarios() {
    $('adm-usuarios').innerHTML = ADM.usuarios.map(u => {
      const souEu = u.user_id === ADM.eu;
      const ehAdmin = ADM.admins.has(u.user_id) || souEu && S.acesso.admin;
      return `<tr data-id="${u.user_id}">
        <td><strong>${esc(u.nome)}</strong><div style="font-size:11px;color:var(--cinza-medio)">${esc(u.email)}</div></td>
        <td>${ehAdmin ? '<span class="risco risco-alto">Administrador · acesso total</span>'
          : `<select class="adm-perfil">${admOpcoesPerfil(u.perfil_id)}</select>`}</td>
        <td>${u.ativo ? '<span class="pill-s">Ativo</span>' : '<span class="pill-n">Desativado</span>'}</td>
        <td style="white-space:nowrap">${ehAdmin ? '<button class="adm-btn" data-acao="senha">Nova senha</button>' : `
          <button class="adm-btn" data-acao="status">${u.ativo ? 'Desativar' : 'Reativar'}</button>
          <button class="adm-btn" data-acao="senha">Nova senha</button>
          <button class="adm-btn adm-btn-perigo" data-acao="excluir">Excluir</button>`}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="vazio">Nenhum usuário cadastrado.</td></tr>';

    $('adm-usuarios').querySelectorAll('tr[data-id]').forEach(tr => {
      const u = ADM.usuarios.find(x => x.user_id === tr.dataset.id);
      const sel = tr.querySelector('.adm-perfil');
      if (sel) sel.onchange = async () => {
        const { error } = await sb.from('usuarios').update({ perfil_id: sel.value ? +sel.value : null }).eq('user_id', u.user_id);
        admAviso(error ? 'Erro: ' + error.message : `Perfil de ${u.nome} atualizado.`, !!error);
        if (!error) u.perfil_id = sel.value ? +sel.value : null;
      };
      tr.querySelectorAll('.adm-btn').forEach(b => b.onclick = () => admAcaoUsuario(b.dataset.acao, u));
    });
  }

  async function admAcaoUsuario(acao, u) {
    if (acao === 'status') {
      if (!admConfirmar(`${u.ativo ? 'Desativar' : 'Reativar'} o acesso de ${u.nome}?`)) return;
      await admFuncao({ acao: 'status', user_id: u.user_id, ativo: !u.ativo }, `Acesso de ${u.nome} ${u.ativo ? 'desativado' : 'reativado'}.`);
    } else if (acao === 'senha') {
      $('adm-senha-alvo').textContent = u.nome;
      $('adm-senha-box').hidden = false;
      $('adm-senha-nova').value = '';
      $('adm-senha-nova').focus();
      $('adm-senha-ok').onclick = async () => {
        const senha = $('adm-senha-nova').value;
        const ok = await admFuncao({ acao: 'redefinir_senha', user_id: u.user_id, senha }, `Senha de ${u.nome} redefinida. Informe a nova senha ao usuário.`);
        if (ok) $('adm-senha-box').hidden = true;
      };
    } else if (acao === 'excluir') {
      if (!admConfirmar(`Excluir definitivamente o usuário ${u.nome} (${u.email})? Esta ação não pode ser desfeita.`)) return;
      await admFuncao({ acao: 'excluir', user_id: u.user_id }, `Usuário ${u.nome} excluído.`);
    }
  }

  // Confirmação simples (o botão precisa ser clicado duas vezes em até 4s)
  let admPendente = null;
  function admConfirmar(texto) {
    if (admPendente === texto) { admPendente = null; return true; }
    admPendente = texto;
    admAviso(texto + ' — clique novamente no mesmo botão para confirmar.', true);
    setTimeout(() => { if (admPendente === texto) admPendente = null; }, 4000);
    return false;
  }

  async function admFuncao(corpo, sucesso) {
    admAviso('Processando…');
    const { data, error } = await sb.functions.invoke('gerenciar-usuarios', { body: corpo });
    let msg = data && data.erro;
    if (error) {
      try { const ctx = await error.context.json(); msg = ctx.erro || error.message; } catch (_) { msg = error.message; }
    }
    if (msg) { admAviso('Erro: ' + msg, true); return false; }
    admAviso(sucesso);
    await admCarregar();
    return true;
  }

  function admAviso(texto, erro) {
    const el = $('adm-aviso');
    el.textContent = texto;
    el.style.background = erro ? 'var(--vermelho-claro)' : 'var(--verde-claro)';
    el.style.color = erro ? 'var(--vermelho-texto)' : 'var(--verde-texto)';
    el.hidden = !texto;
  }

  $('adm-form-usuario').addEventListener('submit', async e => {
    e.preventDefault();
    const corpo = {
      acao: 'criar', nome: $('adm-nu-nome').value.trim(), email: $('adm-nu-email').value.trim(),
      senha: $('adm-nu-senha').value, perfil_id: $('adm-nu-perfil').value ? +$('adm-nu-perfil').value : null
    };
    const ok = await admFuncao(corpo, `Usuário ${corpo.nome} cadastrado no Supabase. Informe a senha provisória ao usuário.`);
    if (ok) e.target.reset();
  });

  function admRenderPerfis() {
    $('adm-perfis').innerHTML = ADM.perfis.map(p => {
      const qtd = ADM.usuarios.filter(u => u.perfil_id === p.id).length;
      const nomes = p.abas.map(k => (ADM.abas.find(a => a.chave === k) || { nome: k }).nome);
      return `<div class="adm-perfil-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div><strong>${esc(p.nome)}</strong><div style="font-size:11px;color:var(--cinza-medio)">${esc(p.descricao || '')}</div></div>
          <span class="risco risco-isento">${qtd} usuário${qtd === 1 ? '' : 's'}</span></div>
        <div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:4px">${nomes.map(n => `<span class="adm-chip">${esc(n)}</span>`).join('') || '<span style="font-size:11px;color:var(--cinza-medio)">Nenhuma aba liberada</span>'}</div>
        <button class="adm-btn" data-editar="${p.id}">Editar</button>
        <button class="adm-btn adm-btn-perigo" data-excluir="${p.id}">Excluir</button></div>`;
    }).join('') || '<div class="vazio">Nenhum perfil cadastrado.</div>';
    $('adm-perfis').querySelectorAll('[data-editar]').forEach(b => b.onclick = () => admEditarPerfil(ADM.perfis.find(p => p.id === +b.dataset.editar)));
    $('adm-perfis').querySelectorAll('[data-excluir]').forEach(b => b.onclick = async () => {
      const p = ADM.perfis.find(x => x.id === +b.dataset.excluir);
      if (!admConfirmar(`Excluir o perfil "${p.nome}"? Usuários com este perfil ficarão sem acesso até receberem outro.`)) return;
      const { error } = await sb.from('perfis_acesso').delete().eq('id', p.id);
      admAviso(error ? 'Erro: ' + error.message : `Perfil "${p.nome}" excluído.`, !!error);
      if (!error) admCarregar();
    });
    admEditarPerfil(null);
  }

  function admEditarPerfil(p) {
    $('adm-pf-id').value = p ? p.id : '';
    $('adm-pf-nome').value = p ? p.nome : '';
    $('adm-pf-desc').value = p ? (p.descricao || '') : '';
    $('adm-pf-titulo').textContent = p ? 'Editar perfil' : 'Novo perfil de acesso';
    const grupos = [...new Set(ADM.abas.map(a => a.grupo))];
    $('adm-pf-abas').innerHTML = grupos.map(g => `<div style="margin-bottom:8px"><div class="adm-grupo">${esc(g)}</div>` +
      ADM.abas.filter(a => a.grupo === g).map(a => `<label class="adm-check"><input type="checkbox" value="${esc(a.chave)}" ${p && p.abas.includes(a.chave) ? 'checked' : ''}> ${esc(a.nome)}</label>`).join('') + '</div>').join('');
    if (p) $('adm-form-perfil').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  window.admNovoPerfil = () => admEditarPerfil(null);

  $('adm-form-perfil').addEventListener('submit', async e => {
    e.preventDefault();
    const id = $('adm-pf-id').value;
    const reg = {
      nome: $('adm-pf-nome').value.trim(), descricao: $('adm-pf-desc').value.trim() || null,
      abas: [...$('adm-pf-abas').querySelectorAll('input:checked')].map(i => i.value)
    };
    if (!reg.nome) return;
    const q = id ? sb.from('perfis_acesso').update(reg).eq('id', +id) : sb.from('perfis_acesso').insert(reg);
    const { error } = await q;
    admAviso(error ? 'Erro: ' + (/duplicate/i.test(error.message) ? 'já existe um perfil com esse nome.' : error.message) : `Perfil "${reg.nome}" salvo.`, !!error);
    if (!error) admCarregar();
  });

  // ---------------------------------------------------------------- modo claro / escuro
  function aplicarTema(escuro) {
    document.documentElement.classList.toggle('tema-escuro', escuro);
    $('btn-tema-txt').textContent = escuro ? 'Modo claro' : 'Modo escuro';
  }
  window.alternarTema = function () {
    const escuro = !document.documentElement.classList.contains('tema-escuro');
    aplicarTema(escuro);
    try { localStorage.setItem('compliance_tema', escuro ? 'escuro' : 'claro'); } catch (_) {}
  };
  try { aplicarTema(localStorage.getItem('compliance_tema') === 'escuro'); } catch (_) {}

  // impressão: todas as abas visíveis
  window.addEventListener('beforeprint', () => document.querySelectorAll('.secao').forEach(s => { s.dataset.era = s.classList.contains('ativa') ? '1' : '0'; s.style.display = 'block'; }));
  window.addEventListener('afterprint', () => document.querySelectorAll('.secao').forEach(s => { s.style.display = ''; }));

  iniciar();
})();
