// Servidor do Abará da Baiana (Node.js, sem dependências externas)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const SENHA_LOJA = process.env.LOJA_SENHA || 'abara123';
const ARQUIVO_DADOS = path.join(__dirname, 'data', 'pedidos.json');
const PRECO_COM_CAMARAO = 14;
const PRECO_SEM_CAMARAO = 12;

if (!process.env.LOJA_SENHA) {
  console.warn('AVISO: usando a senha padrão da loja. Defina a variável LOJA_SENHA antes de publicar.');
}

/* ---------- Armazenamento (arquivo JSON) ---------- */
fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
let pedidos = {};
try { pedidos = JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8')); } catch { pedidos = {}; }

function salvar() {
  const tmp = ARQUIVO_DADOS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(pedidos, null, 2));
  fs.renameSync(tmp, ARQUIVO_DADOS);
}

/* ---------- Utilidades ---------- */
const PUBLICOS = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/app.js': 'app.js',
  '/qrcode.js': 'qrcode.js',
  '/fundo.jpg': 'fundo.jpg',
  '/fundo.png': 'fundo.png',
  '/loja': 'loja.html',
  '/loja.html': 'loja.html',
  '/loja.js': 'loja.js',
};
const TIPOS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 10000) { reject(new Error('grande')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(dados ? JSON.parse(dados) : {}); } catch { reject(new Error('json')); }
    });
    req.on('error', reject);
  });
}

function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ---------- Sessão da loja ---------- */
const sessoes = new Map(); // token -> expiração
const tentativas = new Map(); // ip -> { n, ate }
const DURACAO_SESSAO = 12 * 60 * 60 * 1000;

function autenticado(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const exp = sessoes.get(m[1]);
  if (!exp || exp < Date.now()) { sessoes.delete(m[1]); return false; }
  return true;
}

/* ---------- Regras do pedido ---------- */
const SN = ['Sim', 'Não'];
const STATUS = ['aguardando_pagamento', 'em_preparo', 'finalizado'];
const METODOS = ['Pix', 'Cartão de crédito', 'Cartão de débito'];

function novoCodigo() {
  let c;
  do { c = String(1000 + crypto.randomInt(9000)); } while (pedidos[c]);
  return c;
}

const MAX_ITENS = 10;
const CAMPOS = ['vatapa', 'salada', 'camarao', 'pimenta'];

function visaoCliente(p) {
  return {
    codigo: p.codigo, nome: p.nome, itens: p.itens, total: p.total,
    status: p.status, pagamento: p.pagamento,
  };
}

/* ---------- Rotas da API ---------- */
async function api(req, res, url) {
  const rota = url.pathname;
  const metodo = req.method;
  let m;

  // Cliente: criar pedido
  if (metodo === 'POST' && rota === '/api/pedidos') {
    const b = await lerCorpo(req);
    const nome = String(b.nome || '').trim().slice(0, 40);
    if (!nome) return json(res, 400, { erro: 'Informe seu nome.' });
    if (!Array.isArray(b.itens) || b.itens.length < 1 || b.itens.length > MAX_ITENS) {
      return json(res, 400, { erro: `Escolha de 1 a ${MAX_ITENS} abarás.` });
    }
    const itens = [];
    for (const it of b.itens) {
      const limpo = {};
      for (const k of CAMPOS) {
        if (!it || !SN.includes(it[k])) return json(res, 400, { erro: 'Opção inválida: ' + k });
        limpo[k] = it[k];
      }
      itens.push(limpo);
    }
    const codigo = novoCodigo();
    pedidos[codigo] = {
      codigo, nome, itens,
      // preço sempre calculado no servidor
      total: itens.reduce((s, it) => s + (it.camarao === 'Sim' ? PRECO_COM_CAMARAO : PRECO_SEM_CAMARAO), 0),
      status: 'aguardando_pagamento', pagamento: null,
      criadoEm: Date.now(), atualizadoEm: Date.now(),
    };
    salvar();
    return json(res, 201, visaoCliente(pedidos[codigo]));
  }

  // Cliente: consultar / informar pagamento
  if ((m = /^\/api\/pedidos\/(\d{4})(\/pagamento)?$/.exec(rota))) {
    const p = pedidos[m[1]];
    if (!p) return json(res, 404, { erro: 'Pedido não encontrado.' });
    if (metodo === 'GET' && !m[2]) return json(res, 200, visaoCliente(p));
    if (metodo === 'POST' && m[2]) {
      const b = await lerCorpo(req);
      if (!METODOS.includes(b.metodo)) return json(res, 400, { erro: 'Forma de pagamento inválida.' });
      if (p.status === 'aguardando_pagamento') {
        p.pagamento = b.metodo;
        p.status = 'em_preparo';
        p.atualizadoEm = Date.now();
        salvar();
      }
      return json(res, 200, visaoCliente(p));
    }
  }

  // Loja: login
  if (metodo === 'POST' && rota === '/api/loja/login') {
    const ip = req.socket.remoteAddress;
    const t = tentativas.get(ip) || { n: 0, ate: 0 };
    if (t.ate > Date.now()) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const b = await lerCorpo(req);
    if (!iguais(b.senha || '', SENHA_LOJA)) {
      t.n++;
      if (t.n >= 5) { t.n = 0; t.ate = Date.now() + 5 * 60 * 1000; }
      tentativas.set(ip, t);
      return json(res, 401, { erro: 'Senha incorreta.' });
    }
    tentativas.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessoes.set(token, Date.now() + DURACAO_SESSAO);
    return json(res, 200, { token });
  }

  // Loja: rotas protegidas
  if (rota.startsWith('/api/loja/')) {
    if (!autenticado(req)) return json(res, 401, { erro: 'Não autorizado.' });

    if (metodo === 'GET' && rota === '/api/loja/pedidos') {
      const lista = Object.values(pedidos).sort((a, b) => b.criadoEm - a.criadoEm);
      return json(res, 200, lista);
    }
    if ((m = /^\/api\/loja\/pedidos\/(\d{4})$/.exec(rota)) && metodo === 'PATCH') {
      const p = pedidos[m[1]];
      if (!p) return json(res, 404, { erro: 'Pedido não encontrado.' });
      const b = await lerCorpo(req);
      if (!STATUS.includes(b.status)) return json(res, 400, { erro: 'Status inválido.' });
      p.status = b.status;
      p.atualizadoEm = Date.now();
      salvar();
      return json(res, 200, p);
    }
  }

  return json(res, 404, { erro: 'Rota não encontrada.' });
}

/* ---------- Servidor ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    const arquivo = PUBLICOS[url.pathname];
    if (req.method === 'GET' && arquivo) {
      const conteudo = fs.readFileSync(path.join(__dirname, arquivo));
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)], 'Cache-Control': 'no-cache' });
      return res.end(conteudo);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  } catch (e) {
    json(res, e.message === 'json' || e.message === 'grande' ? 400 : 500, { erro: 'Requisição inválida.' });
  }
});

server.listen(PORT, () => console.log(`Abará da Baiana no ar: http://localhost:${PORT}  |  Painel da loja: http://localhost:${PORT}/loja`));
