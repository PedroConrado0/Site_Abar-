(function () {
  const $ = (s) => document.querySelector(s);
  const moeda = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');
  const ROTULO = {
    aguardando_pagamento: 'Aguardando pagamento',
    em_preparo: 'Sendo preparado',
    finalizado: 'Finalizado',
  };
  let token = sessionStorage.getItem('loja_token');
  let filtro = 'abertos';
  let pedidos = [];
  let timer = null;

  function esc(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  async function chamar(url, opcoes = {}) {
    const r = await fetch(url, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    });
    if (r.status === 401 && token) { sair(); throw new Error('sessão'); }
    const dados = await r.json();
    if (!r.ok) throw new Error(dados.erro || 'Erro');
    return dados;
  }

  function mostrar(logado) {
    $('#login').classList.toggle('ativa', !logado);
    $('#painel').classList.toggle('ativa', logado);
    $('#sair').hidden = !logado;
  }

  function sair() {
    token = null;
    sessionStorage.removeItem('loja_token');
    clearInterval(timer);
    mostrar(false);
  }

  async function carregar() {
    try {
      pedidos = await chamar('/api/loja/pedidos');
      $('#atualizado').textContent = '· atualizado às ' + new Date().toLocaleTimeString('pt-BR');
      desenhar();
    } catch (e) { /* sessão expirada já tratada */ }
  }

  function desenhar() {
    const lista = pedidos.filter((p) =>
      filtro === 'todos' ? true : filtro === 'finalizado' ? p.status === 'finalizado' : p.status !== 'finalizado');
    if (!lista.length) { $('#lista').innerHTML = '<p class="dica">Nenhum pedido aqui.</p>'; return; }
    $('#lista').innerHTML = lista.map((p) => `
      <div class="card pedido st-${p.status}">
        <div class="pedido-topo">
          <strong>#${p.codigo} · ${esc(p.nome)}</strong>
          <span class="selo">${ROTULO[p.status]}</span>
        </div>
        <p><b>${p.itens.length} abará(s)</b></p>
        <ul class="itens-loja">${p.itens.map((it, i) =>
          `<li>Abará ${i + 1}: Vatapá ${it.vatapa} · Salada ${it.salada} · Camarão ${it.camarao} · Pimenta ${it.pimenta}</li>`).join('')}</ul>
        <p><b>${moeda(p.total)}</b> · Pagamento: ${p.pagamento ? esc(p.pagamento) : 'ainda não informado'}
           · ${new Date(p.criadoEm).toLocaleString('pt-BR')}</p>
        <div class="pedido-acoes">
          ${p.status !== 'em_preparo' ? `<button class="btn sec" data-id="${p.codigo}" data-st="em_preparo">Em preparo</button>` : ''}
          ${p.status !== 'finalizado' ? `<button class="btn" data-id="${p.codigo}" data-st="finalizado">Finalizar</button>` : ''}
        </div>
      </div>`).join('');
  }

  $('#lista').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    b.disabled = true;
    try {
      await chamar('/api/loja/pedidos/' + b.dataset.id, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.st }) });
      carregar();
    } catch (err) { alert(err.message); b.disabled = false; }
  });

  document.querySelectorAll('.aba').forEach((a) => a.addEventListener('click', () => {
    filtro = a.dataset.filtro;
    document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('ativa', x === a));
    desenhar();
  }));

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await fetch('/api/loja/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: $('#senha').value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      token = d.token;
      sessionStorage.setItem('loja_token', token);
      $('#senha').value = '';
      $('#erro-login').hidden = true;
      iniciar();
    } catch (err) {
      $('#erro-login').textContent = err.message;
      $('#erro-login').hidden = false;
    }
  });

  $('#sair').addEventListener('click', sair);

  function iniciar() {
    mostrar(true);
    carregar();
    clearInterval(timer);
    timer = setInterval(carregar, 5000);
  }

  if (token) iniciar();
})();
