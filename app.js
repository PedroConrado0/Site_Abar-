(function () {
  const PRECO_COM_CAMARAO = 14;
  const PRECO_SEM_CAMARAO = 12;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const moeda = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');

  /* ---------- Navegação ---------- */
  function ir(tela) {
    $$('.tela').forEach((t) => t.classList.toggle('ativa', t.id === tela));
    $$('.nav-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.go === tela));
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-go]');
    if (alvo) ir(alvo.dataset.go);
  });

  /* ---------- Boas-vindas interativas ---------- */
  const frases = [
    'O sabor da Bahia, quentinho e na hora! 🌴',
    'Monte o seu abará do jeito que você gosta.',
    'Com vatapá, camarão e pimenta... ou como preferir!',
    'Peça agora e acompanhe tudo em tempo real.',
  ];
  let fi = 0, ci = 0;
  function digitar() {
    const el = $('#frase');
    const f = frases[fi];
    el.textContent = f.slice(0, ci++);
    if (ci > f.length) {
      setTimeout(() => { fi = (fi + 1) % frases.length; ci = 0; digitar(); }, 2200);
    } else {
      setTimeout(digitar, 45);
    }
  }
  digitar();

  let cliques = 0;
  const msgs = ['', 'Hmm, cheiroso! 😋', 'Tá com fome, hein?', 'Já pensou nesse abará com camarão? 🍤', 'Chega de brincar, vamos pedir! 😄'];
  $('#abara-bonito').addEventListener('click', (e) => {
    cliques++;
    e.currentTarget.classList.remove('pula');
    void e.currentTarget.offsetWidth;
    e.currentTarget.classList.add('pula');
    $('#contador-cliques').textContent = msgs[Math.min(cliques, msgs.length - 1)];
  });

  /* ---------- Novo pedido ---------- */
  const form = $('#form-pedido');
  const MAX_QTD = 10;
  const INGREDIENTES = [
    ['vatapa', 'Vatapá'],
    ['salada', 'Salada'],
    ['camarao', 'Camarão'],
    ['pimenta', 'Pimenta'],
  ];
  let qtd = 1;

  const val = (n) => form.elements[n].value;

  function blocoItem(i) {
    const campos = INGREDIENTES.map(([k, nome]) => {
      const preco = (op) => (k === 'camarao' ? (op === 'Sim' ? ' (R$ 14,00)' : ' (R$ 12,00)') : '');
      return `
        <div class="opcao">
          <h3>${nome}</h3>
          <label class="radio"><input type="radio" name="${k}-${i}" value="Sim" checked> Sim${preco('Sim')}</label>
          <label class="radio"><input type="radio" name="${k}-${i}" value="Não"> Não${preco('Não')}</label>
        </div>`;
    }).join('');
    return `<fieldset class="item" data-i="${i}">
      <legend>Abará ${i + 1}</legend>
      <div class="opcoes">${campos}</div>
    </fieldset>`;
  }

  // Mantém as escolhas já feitas; só adiciona ou remove blocos no fim
  function ajustarItens() {
    const cont = $('#itens');
    while (cont.children.length > qtd) cont.lastElementChild.remove();
    while (cont.children.length < qtd) cont.insertAdjacentHTML('beforeend', blocoItem(cont.children.length));
    $('#qtd').value = qtd;
    $('#qtd-menos').disabled = qtd <= 1;
    $('#qtd-mais').disabled = qtd >= MAX_QTD;
  }

  function lerItens() {
    const itens = [];
    for (let i = 0; i < qtd; i++) {
      const it = {};
      INGREDIENTES.forEach(([k]) => { it[k] = val(`${k}-${i}`); });
      itens.push(it);
    }
    return itens;
  }

  const precoItem = (it) => (it.camarao === 'Sim' ? PRECO_COM_CAMARAO : PRECO_SEM_CAMARAO);

  function atualizarResumo() {
    const itens = lerItens();
    const total = itens.reduce((s, it) => s + precoItem(it), 0);
    $('#resumo-texto').innerHTML = itens.map((it, i) =>
      `<div><b>Abará ${i + 1}</b>: Vatapá ${it.vatapa} · Salada ${it.salada} · ` +
      `Camarão ${it.camarao} · Pimenta ${it.pimenta} — ${moeda(precoItem(it))}</div>`).join('');
    $('#total').textContent = moeda(total);
    return total;
  }

  function mudarQtd(delta) {
    qtd = Math.min(MAX_QTD, Math.max(1, qtd + delta));
    ajustarItens();
    atualizarResumo();
  }
  $('#qtd-menos').addEventListener('click', () => mudarQtd(-1));
  $('#qtd-mais').addEventListener('click', () => mudarQtd(1));
  form.addEventListener('change', atualizarResumo);
  ajustarItens();
  atualizarResumo();

  async function api(url, opcoes) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opcoes });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || 'Erro de comunicação com o servidor.');
    return dados;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    let pedido;
    try {
      pedido = await api('/api/pedidos', {
        method: 'POST',
        body: JSON.stringify({
          nome: $('#nome').value.trim(),
          itens: lerItens(),
        }),
      });
    } catch (err) {
      alert(err.message);
      return;
    } finally {
      botao.disabled = false;
    }

    $('#modal-nome').textContent = pedido.nome;
    $('#modal-codigo').textContent = '#' + pedido.codigo;
    $('#modal').hidden = false;
    setTimeout(() => {
      $('#modal').hidden = true;
      form.reset();
      qtd = 1;
      $('#itens').innerHTML = '';
      ajustarItens();
      atualizarResumo();
      abrirPagamento(pedido);
    }, 2500);
  });

  /* ---------- Pagamento ---------- */
  const CHAVE_PIX = '+5571986503825';
  let pedidoAtual = null;

  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  const campoEMV = (id, v) => id + String(v.length).padStart(2, '0') + v;

  function gerarPix(valor, codigo) {
    const conta = campoEMV('00', 'br.gov.bcb.pix') + campoEMV('01', CHAVE_PIX);
    const base =
      campoEMV('00', '01') +
      campoEMV('01', '11') +
      campoEMV('26', conta) +
      campoEMV('52', '0000') +
      campoEMV('53', '986') +
      campoEMV('54', valor.toFixed(2)) +
      campoEMV('58', 'BR') +
      campoEMV('59', 'ABARA DA BAIANA') +
      campoEMV('60', 'SALVADOR') +
      campoEMV('62', campoEMV('05', 'PED' + codigo)) +
      '6304';
    return base + crc16(base);
  }

  function abrirPagamento(p) {
    const codigo = p.codigo;
    pedidoAtual = codigo;
    $('#pg-codigo').textContent = '#' + codigo;
    $('#pg-total').textContent = moeda(p.total);

    const payload = gerarPix(p.total, codigo);
    $('#pix-codigo').value = payload;
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    $('#qr').innerHTML = qr.createImgTag(6, 4);

    $('#aba-cartao').reset();
    $('#erro-cartao').hidden = true;
    trocarAba('pix');
    ir('pagamento');
  }

  function trocarAba(nome) {
    $$('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
    $('#aba-pix').hidden = nome !== 'pix';
    $('#aba-cartao').hidden = nome === 'pix';
    if (nome !== 'pix') {
      $('#cartao-tipo').textContent = nome === 'credito' ? 'no crédito' : 'no débito';
      $('#aba-cartao').dataset.tipo = nome;
    }
  }
  $$('.aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));

  $('#btn-copiar').addEventListener('click', () => {
    const t = $('#pix-codigo');
    t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject())
      .catch(() => document.execCommand('copy'));
    $('#btn-copiar').textContent = 'Copiado!';
    setTimeout(() => ($('#btn-copiar').textContent = 'Copiar código'), 1800);
  });

  async function concluirPagamento(metodo) {
    try {
      // só o nome do método é enviado; dados de cartão nunca saem do navegador
      await api(`/api/pedidos/${pedidoAtual}/pagamento`, { method: 'POST', body: JSON.stringify({ metodo }) });
    } catch (err) {
      alert(err.message);
      return;
    }
    $('#codigo').value = pedidoAtual;
    ir('acompanhar');
    mostrarStatus(pedidoAtual);
  }

  $('#btn-paguei').addEventListener('click', () => concluirPagamento('Pix'));

  $('#cartao-numero').addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
  });
  $('#cartao-validade').addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
  $('#cartao-cvv').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  });

  function luhn(num) {
    let soma = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = +num[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      soma += n; alt = !alt;
    }
    return soma % 10 === 0;
  }

  $('#aba-cartao').addEventListener('submit', (e) => {
    e.preventDefault();
    const erro = $('#erro-cartao');
    const num = $('#cartao-numero').value.replace(/\s/g, '');
    const [mm, aa] = $('#cartao-validade').value.split('/');
    const cvv = $('#cartao-cvv').value;
    const agora = new Date();
    const mes = +mm, ano = 2000 + +aa;
    let msg = '';
    if (num.length < 13 || !luhn(num)) msg = 'Número de cartão inválido.';
    else if (!mes || mes < 1 || mes > 12 || !aa || aa.length !== 2) msg = 'Validade inválida.';
    else if (ano < agora.getFullYear() || (ano === agora.getFullYear() && mes < agora.getMonth() + 1)) msg = 'Cartão vencido.';
    else if (cvv.length < 3) msg = 'CVV inválido.';
    erro.hidden = !msg;
    erro.textContent = msg;
    if (msg) return;
    concluirPagamento($('#aba-cartao').dataset.tipo === 'credito' ? 'Cartão de crédito' : 'Cartão de débito');
  });

  /* ---------- Acompanhar pedido ---------- */
  let timer = null;

  const TITULOS = {
    aguardando_pagamento: 'aguardando pagamento',
    em_preparo: 'sendo preparado',
    finalizado: 'finalizado',
  };

  async function mostrarStatus(codigo) {
    clearInterval(timer);
    if (!/^\d{4}$/.test(codigo)) {
      $('#status-box').hidden = true;
      $('#erro-busca').hidden = false;
      return;
    }
    const render = async () => {
      let p;
      try {
        p = await api('/api/pedidos/' + codigo);
      } catch {
        clearInterval(timer);
        $('#status-box').hidden = true;
        $('#erro-busca').hidden = false;
        return;
      }
      $('#erro-busca').hidden = true;
      $('#status-box').hidden = false;
      const pronto = p.status === 'finalizado';
      const preparo = p.status === 'em_preparo';
      $('#status-titulo').textContent = `Pedido #${codigo}: ${TITULOS[p.status]}`;
      // textContent evita injeção de HTML a partir do nome digitado
      $('#status-detalhes').textContent =
        `${p.nome} · ${p.itens.length} abará(s) · ${moeda(p.total)}\n` +
        p.itens.map((it, i) =>
          `Abará ${i + 1}: Vatapá ${it.vatapa} · Salada ${it.salada} · Camarão ${it.camarao} · Pimenta ${it.pimenta}`
        ).join('\n');
      $('#etapa-preparo').classList.toggle('ativa', preparo);
      $('#etapa-final').classList.toggle('ativa', pronto);
      $('.linha').classList.toggle('ok', pronto);
      if (pronto) clearInterval(timer);
    };
    await render();
    timer = setInterval(render, 4000);
  }

  $('#form-busca').addEventListener('submit', (e) => {
    e.preventDefault();
    mostrarStatus($('#codigo').value.trim().replace('#', ''));
  });

  ir('home');
})();
