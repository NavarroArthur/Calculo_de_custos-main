// ---------------------------------------------------------------------------
// CONFIGURACAO DA API
// Um unico lugar para a URL do back-end. Em producao, TROQUE a linha abaixo
// pela URL real do seu deploy no Railway (ex.: https://seuapp.up.railway.app/api).
// ---------------------------------------------------------------------------
const PRODUCTION_API_URL = 'https://arthur.pythonanywhere.com/api'; 
const rodandoLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = rodandoLocal ? 'http://localhost:5000/api' : PRODUCTION_API_URL;

// Precos de FALLBACK (usados so no modo offline). Com a API no ar,
// carregarConfiguracoes() sobrescreve estes valores com os precos do banco,
// que sao a fonte oficial dos precos.
let PRECOS = { GELO: 8.5, PAPELAO: 7.3, FITA: 0.34 };
let USUARIO_ID = null;
// Lista de produtos vinda do banco (id, nome, preco_kg)
let PRODUTOS = [];

// ---------------------------------------------------------------------------
// AUTENTICACAO: intercepta as chamadas da API para anexar o token e tratar 401
// (um unico ponto, em vez de repetir o cabecalho em cada fetch)
// ---------------------------------------------------------------------------
const _fetchOriginal = window.fetch.bind(window);
window.fetch = async function (url, options = {}) {
    const ehApi = typeof url === 'string' && url.startsWith(API_BASE_URL);
    if (ehApi) {
        const token = localStorage.getItem('token');
        options.headers = Object.assign({}, options.headers,
            token ? { 'Authorization': 'Bearer ' + token } : {});
    }
    const resp = await _fetchOriginal(url, options);
    // Token expirado/invalido em qualquer chamada -> volta para o login
    if (ehApi && resp.status === 401 && !url.endsWith('/login')) {
        localStorage.removeItem('token');
        mostrarLogin();
    }
    return resp;
};

// Elementos DOM
const form = document.getElementById('calcForm');
const resultadoContainer = document.getElementById('resultado');
const resultContent = document.getElementById('resultContent');
const closeResult = document.getElementById('closeResult');
const btnLoading = document.getElementById('btnLoading');
const toast = document.getElementById('toast');

// Elementos do formulário
const campos = {
    produto: document.getElementById('produto'),
    categoria: document.getElementById('categoria'),
    preco: document.getElementById('preco'),
    peso_inicial: document.getElementById('peso_inicial'),
    peso_final: document.getElementById('peso_final'),
    sacos_de_gelo: document.getElementById('sacos_de_gelo'),
    caixa_papelao: document.getElementById('caixa_papelao')
};

// Histórico de cálculos
let historicoCalculos = JSON.parse(localStorage.getItem('historicoCalculos') || '[]');

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    inicializarEventos();
    aplicarValidacoes();
    inicializarTabs();
    // So inicializa o sistema se ja estiver logado; senao, mostra a tela de login
    if (localStorage.getItem('token')) {
        esconderLogin();
        inicializarSistema();
    } else {
        mostrarLogin();
    }
});

// Event Listeners
function inicializarEventos() {
    form.addEventListener('submit', handleSubmit);
    closeResult.addEventListener('click', fecharResultado);

    // Formulario de configuracoes (editar precos)
    const configForm = document.getElementById('configForm');
    if (configForm) configForm.addEventListener('submit', handleConfigSubmit);

    // Busca por produto: debounce de 250ms para nao re-renderizar a lista a
    // cada tecla digitada (roda so quando o usuario para de digitar).
    const filtroBusca = document.getElementById('filtroProduto');
    if (filtroBusca) filtroBusca.addEventListener('input', debounce(atualizarHistorico, 250));
    // Demais filtros (categoria e datas): reagem imediatamente.
    ['filtroCategoria', 'filtroDe', 'filtroAte'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', atualizarHistorico);
    });
    const btnLimparFiltros = document.getElementById('btnLimparFiltros');
    if (btnLimparFiltros) btnLimparFiltros.addEventListener('click', limparFiltros);

    // Ao escolher um produto, preenche o preco por Kg com o valor salvo
    if (campos.produto) campos.produto.addEventListener('change', autoPreencherPreco);
    // Formulario de adicionar produto (na aba Configuracoes)
    const formNovoProduto = document.getElementById('formNovoProduto');
    if (formNovoProduto) formNovoProduto.addEventListener('submit', adicionarProduto);

    // Busca dentro da lista de produtos (filtra enquanto digita)
    const buscaProduto = document.getElementById('buscaProduto');
    if (buscaProduto) buscaProduto.addEventListener('input', renderListaProdutos);

    // Modal de perfil do produto
    const fecharModal = document.getElementById('fecharModalProduto');
    if (fecharModal) fecharModal.addEventListener('click', fecharModalProduto);
    const btnSalvarPerfil = document.getElementById('btnSalvarPerfil');
    if (btnSalvarPerfil) btnSalvarPerfil.addEventListener('click', salvarPerfilProduto);
    const btnExcluirPerfil = document.getElementById('btnExcluirPerfil');
    if (btnExcluirPerfil) btnExcluirPerfil.addEventListener('click', excluirPerfilProduto);
    const overlayModal = document.getElementById('produtoModal');
    if (overlayModal) {
        overlayModal.addEventListener('click', function(e) {
            if (e.target === overlayModal) fecharModalProduto();   // clique fora fecha
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && !overlayModal.classList.contains('hidden')) {
                fecharModalProduto();
            }
        });
    }

    // Login, logout e backup
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', fazerLogin);
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', logout);
    const btnBaixarBackup = document.getElementById('btnBaixarBackup');
    if (btnBaixarBackup) btnBaixarBackup.addEventListener('click', baixarBackup);
    const btnBackupServidor = document.getElementById('btnBackupServidor');
    if (btnBackupServidor) btnBackupServidor.addEventListener('click', criarBackupServidor);
    
    // Validação em tempo real
    Object.values(campos).forEach(campo => {
        campo.addEventListener('input', validarCampo);
        campo.addEventListener('blur', validarCampo);
    });
    
    // Fechar resultado com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !resultadoContainer.classList.contains('hidden')) {
            fecharResultado();
        }
    });
}

// NOTA: aplicarValidacoes/validarCampo/mostrarErro/limparErro/validarFormulario -> validacao.js

// Submit do formulário
async function handleSubmit(event) {
    event.preventDefault();
    
    if (!validarFormulario()) {
        mostrarToast('Por favor, corrija os erros no formulário', 'error');
        return;
    }
    
    // Mostrar loading
    mostrarLoading(true);
    
    try {
        // Simular delay para melhor UX
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Coletar dados do formulario
        const dados = coletarDados();

        // FONTE UNICA DA CONTA: online, quem calcula e a API (calculos.py),
        // que tambem salva no banco e devolve os resultados de uma vez so.
        // Se a API estiver fora do ar, caimos no calculo local (fallback offline).
        let resultados;
        try {
            resultados = await salvarNoBanco(dados);
            await carregarHistoricoAPI();
            mostrarToast('Cálculo salvo no banco de dados!', 'success');
        } catch (error) {
            resultados = calcularCustos(dados);
            salvarNoHistorico(dados, resultados);
            mostrarToast('Modo offline: cálculo salvo localmente!', 'warning');
        }

        // Exibir resultados
        exibirResultados(dados, resultados);
        
    } catch (error) {
        console.error('Erro no cálculo:', error);
        mostrarToast('Erro ao realizar o cálculo. Tente novamente.', 'error');
    } finally {
        mostrarLoading(false);
    }
}

// NOTA: arredondar(), coletarDados() e calcularCustos() foram para calculo.js

function exibirResultados(dados, resultados) {
    const {
        produto,
        categoria,
        peso_inicial,
        peso_final,
        sacos_de_gelo,
        caixa_papelao
    } = dados;
    
    const {
        custo_sacos_gelo,
        custo_papelao,
        custo_fita_papelao,
        diferenca_pesos,
        custo_producao,
        custo_pos_beneficiamento,
        porcentagem,
        diferenca_valor,
        custos_totais,
        custo_final
    } = resultados;
    
    // Determinar ícone da categoria
    const categoriaIcon = categoria === 'Mercado' ? 'fas fa-store' : 'fas fa-utensils';
    const categoriaColor = categoria === 'Mercado' ? 'success' : 'warning';

    // Bloco de margem: so aparece se o preco de venda foi informado
    const margemHtml = (resultados.preco_venda) ? `
        <div class="detail-section">
            <h4><i class="fas fa-hand-holding-dollar"></i> Margem de Lucro</h4>
            <div class="result-grid">
                <div class="result-card">
                    <div class="result-card-icon ${resultados.lucro_por_kg >= 0 ? 'success' : 'warning'}">
                        <i class="fas fa-coins"></i>
                    </div>
                    <div class="result-card-value">R$ ${resultados.lucro_por_kg.toFixed(2)}</div>
                    <div class="result-card-label">Lucro por Kg</div>
                </div>
                <div class="result-card">
                    <div class="result-card-icon ${resultados.margem_percentual >= 0 ? 'success' : 'warning'}">
                        <i class="fas fa-percentage"></i>
                    </div>
                    <div class="result-card-value">${resultados.margem_percentual.toFixed(1)}%</div>
                    <div class="result-card-label">Margem</div>
                </div>
            </div>
            <div class="detail-list">
                <div class="detail-item">
                    <span class="detail-item-label">Preço de venda por Kg</span>
                    <span class="detail-item-value">R$ ${resultados.preco_venda.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Custo por Kg (pós-beneficiamento)</span>
                    <span class="detail-item-value">R$ ${custo_pos_beneficiamento.toFixed(2)}</span>
                </div>
            </div>
        </div>
    ` : '';

    resultContent.innerHTML = `
        <div class="result-info">
            <div class="result-header-info">
                <div class="result-product">
                    <i class="fas fa-fish"></i>
                    <span>${produto}</span>
                </div>
                <div class="result-category ${categoriaColor}">
                    <i class="${categoriaIcon}"></i>
                    <span>${categoria}</span>
                </div>
            </div>
        </div>
        
        <div class="result-grid">
            <div class="result-card">
                <div class="result-card-icon primary">
                    <i class="fas fa-percentage"></i>
                </div>
                <div class="result-card-value">${porcentagem.toFixed(1)}%</div>
                <div class="result-card-label">Beneficiamento</div>
            </div>
            
            <div class="result-card">
                <div class="result-card-icon success">
                    <i class="fas fa-weight-hanging"></i>
                </div>
                <div class="result-card-value">+${arredondar(diferenca_pesos)} Kg</div>
                <div class="result-card-label">Ganho de Peso</div>
            </div>
            
            <div class="result-card">
                <div class="result-card-icon warning">
                    <i class="fas fa-dollar-sign"></i>
                </div>
                <div class="result-card-value">R$ ${custo_pos_beneficiamento.toFixed(2)}</div>
                <div class="result-card-label">Custo por Kg</div>
            </div>
            
            <div class="result-card">
                <div class="result-card-icon primary">
                    <i class="fas fa-receipt"></i>
                </div>
                <div class="result-card-value">R$ ${custo_final.toFixed(2)}</div>
                <div class="result-card-label">Custo Total</div>
            </div>
        </div>
        
        <div class="detail-section">
            <h4><i class="fas fa-list"></i> Detalhamento dos Custos</h4>
            <div class="detail-list">
                <div class="detail-item">
                    <span class="detail-item-label">Sacos de gelo (${sacos_de_gelo} un.)</span>
                    <span class="detail-item-value">R$ ${custo_sacos_gelo.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Caixas de papelão (${caixa_papelao} un.)</span>
                    <span class="detail-item-value">R$ ${custo_papelao.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Fitas durex</span>
                    <span class="detail-item-value">R$ ${custo_fita_papelao.toFixed(2)}</span>
                </div>
                <div class="detail-item" style="border-top: 2px solid var(--border-color); font-weight: 600;">
                    <span class="detail-item-label">Subtotal custos extras</span>
                    <span class="detail-item-value">R$ ${custos_totais.toFixed(2)}</span>
                </div>
            </div>
        </div>
        
        <div class="detail-section">
            <h4><i class="fas fa-chart-bar"></i> Análise da Produção</h4>
            <div class="detail-list">
                <div class="detail-item">
                    <span class="detail-item-label">Peso inicial</span>
                    <span class="detail-item-value">${peso_inicial} Kg</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Peso final</span>
                    <span class="detail-item-value">${peso_final} Kg</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Preço inicial por Kg</span>
                    <span class="detail-item-value">R$ ${dados.preco.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Custo pós-beneficiamento por Kg</span>
                    <span class="detail-item-value">R$ ${custo_pos_beneficiamento.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Diferença de valor por Kg</span>
                    <span class="detail-item-value ${diferenca_valor >= 0 ? 'text-success' : 'text-error'}">R$ ${diferenca_valor.toFixed(2)}</span>
                </div>
            </div>
        </div>
        
        ${margemHtml}

        <div class="result-actions">
            <button class="action-btn secondary" onclick="exportarResultado()">
                <i class="fas fa-download"></i>
                Exportar Resultado
            </button>
            <button class="action-btn primary" onclick="novoCalculo()">
                <i class="fas fa-plus"></i>
                Novo Cálculo
            </button>
        </div>
    `;
    
    // Mostrar resultado com animação
    resultadoContainer.classList.remove('hidden');
    resultadoContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Funções de controle
function mostrarLoading(mostrar) {
    const btn = document.querySelector('.calculate-btn');
    if (mostrar) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function fecharResultado() {
    resultadoContainer.classList.add('hidden');
}

function novoCalculo() {
    form.reset();
    fecharResultado();
    limparTodosErros();
    mostrarToast('Formulário limpo. Pronto para novo cálculo!', 'success');
}

function limparTodosErros() {
    Object.values(campos).forEach(campo => {
        limparErro(campo);
    });
}

// Sistema de notificações
function mostrarToast(mensagem, tipo = 'success') {
    const toastIcon = toast.querySelector('.toast-icon');
    const toastMessage = toast.querySelector('.toast-message');
    
    // Definir ícone baseado no tipo
    const icones = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle'
    };
    
    toastIcon.className = `toast-icon ${icones[tipo]}`;
    toastMessage.textContent = mensagem;
    
    // Remover classes anteriores e adicionar nova
    toast.className = `toast ${tipo} show`;
    
    // Auto-remover após 4 segundos
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Inicialização do sistema
async function inicializarSistema() {
    try {
        // Verificar se a API está funcionando
        await verificarAPI();
        
        // Carregar configurações da API
        await carregarConfiguracoes();

        // Carregar produtos e seus precos
        await carregarProdutos();
        
        // Criar ou obter usuário padrão
        await inicializarUsuario();
        
        // Carregar histórico do banco de dados
        await carregarHistoricoAPI();
        
        mostrarToast('Sistema inicializado com sucesso!', 'success');
        
    } catch (error) {
        console.error('Erro ao inicializar sistema:', error);
        mostrarToast('Usando modo offline (dados locais)', 'warning');
        
        // Fallback para modo offline
        carregarHistorico();
        atualizarHistorico();
    }
}

// Verificar se a API está funcionando
async function verificarAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (!response.ok) {
            throw new Error('API não disponível');
        }
        const data = await response.json();
        console.log('✅ API funcionando:', data);
        return true;
    } catch (error) {
        console.warn('⚠️ API não disponível:', error);
        throw error;
    }
}

// Carregar configurações da API
async function carregarConfiguracoes() {
    try {
        const response = await fetch(`${API_BASE_URL}/configuracoes`);
        if (!response.ok) {
            throw new Error('Erro ao carregar configurações');
        }
        
        const data = await response.json();
        if (data.success) {
            PRECOS.GELO = parseFloat(data.configuracoes.preco_gelo);
            PRECOS.PAPELAO = parseFloat(data.configuracoes.preco_papelao);
            PRECOS.FITA = parseFloat(data.configuracoes.preco_fita);
            // Mostra a versao do sistema no rodape
            const elVersao = document.getElementById('footerVersion');
            if (elVersao && data.configuracoes.versao_sistema) {
                elVersao.textContent = 'v' + data.configuracoes.versao_sistema;
            }
            console.log('✅ Configurações carregadas:', PRECOS);
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar configurações:', error);
    }
}

// Preenche o formulario de configuracoes com os precos atuais (ja carregados em PRECOS)
function preencherConfigForm() {
    const g = document.getElementById('cfg_gelo');
    const p = document.getElementById('cfg_papelao');
    const f = document.getElementById('cfg_fita');
    if (g) g.value = PRECOS.GELO;
    if (p) p.value = PRECOS.PAPELAO;
    if (f) f.value = PRECOS.FITA;
}

// Salva os novos precos no banco (PUT /api/configuracoes) e atualiza o fallback local
async function handleConfigSubmit(event) {
    event.preventDefault();
    const novos = {
        preco_gelo: parseFloat(document.getElementById('cfg_gelo').value),
        preco_papelao: parseFloat(document.getElementById('cfg_papelao').value),
        preco_fita: parseFloat(document.getElementById('cfg_fita').value)
    };
    try {
        const response = await fetch(`${API_BASE_URL}/configuracoes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(novos)
        });
        if (!response.ok) throw new Error('Falha ao salvar configuracoes');
        // Atualiza os precos usados no calculo offline tambem (mantem tudo em sincronia)
        PRECOS.GELO = novos.preco_gelo;
        PRECOS.PAPELAO = novos.preco_papelao;
        PRECOS.FITA = novos.preco_fita;
        mostrarToast('Configurações salvas com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao salvar configuracoes:', error);
        mostrarToast('Erro ao salvar. A API está online?', 'error');
    }
}

// ---------------------------------------------------------------------------
// Login, logout e backup
// ---------------------------------------------------------------------------
function mostrarLogin() {
    const o = document.getElementById('loginOverlay');
    if (o) o.classList.remove('hidden');
}

function esconderLogin() {
    const o = document.getElementById('loginOverlay');
    if (o) o.classList.add('hidden');
}

async function fazerLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login_email').value.trim();
    const senha = document.getElementById('login_senha').value;
    try {
        const resp = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Falha no login');
        localStorage.setItem('token', data.token);
        document.getElementById('login_senha').value = '';
        esconderLogin();
        mostrarToast(`Bem-vindo, ${data.nome}!`, 'success');
        inicializarSistema();
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

function logout() {
    localStorage.removeItem('token');
    mostrarLogin();
    mostrarToast('Você saiu.', 'success');
}

// Baixa o arquivo do banco (.db) para o computador
async function baixarBackup() {
    try {
        const resp = await fetch(`${API_BASE_URL}/backup/download`);
        if (!resp.ok) throw new Error('Falha ao baixar');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_calculadora_${new Date().toISOString().slice(0, 10)}.db`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        mostrarToast('Backup baixado!', 'success');
    } catch (error) {
        mostrarToast('Erro ao baixar backup.', 'error');
    }
}

// Cria uma copia do banco no proprio servidor
async function criarBackupServidor() {
    try {
        const resp = await fetch(`${API_BASE_URL}/backup`, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Falha');
        mostrarToast(`Cópia criada no servidor: ${data.arquivo}`, 'success');
    } catch (error) {
        mostrarToast('Erro ao criar backup.', 'error');
    }
}

// Escapa caracteres perigosos ao inserir texto do usuario no HTML (evita quebra/XSS)
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Busca os produtos no banco e atualiza o select da calculadora e a lista das configuracoes
async function carregarProdutos() {
    try {
        const response = await fetch(`${API_BASE_URL}/produtos`);
        if (!response.ok) throw new Error('Falha ao carregar produtos');
        const data = await response.json();
        if (data.success) {
            PRODUTOS = data.produtos;
            popularSelectProdutos();
            renderListaProdutos();
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar produtos (mantendo lista fixa):', error);
    }
}

// Reconstroi as opcoes do select de produtos a partir do banco
function popularSelectProdutos() {
    const select = document.getElementById('produto');
    if (!select || PRODUTOS.length === 0) return;
    const selecionado = select.value;
    select.innerHTML = '<option value="">Selecione o produto</option>' +
        PRODUTOS.map(p => `<option value="${esc(p.nome)}">${esc(p.nome)}</option>`).join('');
    if (selecionado) select.value = selecionado;   // mantem a escolha anterior
}

// Ao escolher um produto, preenche o preco por Kg com o valor salvo (se houver)
function autoPreencherPreco() {
    const produto = PRODUTOS.find(p => p.nome === campos.produto.value);
    if (produto && produto.preco_kg > 0) {
        campos.preco.value = produto.preco_kg;
    }
}

// Renderiza a lista editavel de produtos, aplicando a busca por nome
function renderListaProdutos() {
    const container = document.getElementById('listaProdutos');
    if (!container) return;

    const busca = (document.getElementById('buscaProduto')?.value || '').trim().toLowerCase();
    const lista = PRODUTOS.filter(p => p.nome.toLowerCase().includes(busca));

    // Contador: "X produtos" ou "X de Y produtos" quando ha busca ativa
    const contador = document.getElementById('produtosContador');
    if (contador) {
        contador.textContent = busca
            ? `${lista.length} de ${PRODUTOS.length} produtos`
            : `${PRODUTOS.length} produto(s)`;
    }

    if (lista.length === 0) {
        const semNada = PRODUTOS.length === 0;
        container.innerHTML = `<p class="produtos-hint">${semNada ? 'Nenhum produto cadastrado.' : 'Nenhum produto encontrado para a busca.'}</p>`;
        return;
    }

    container.innerHTML = lista.map(p => `
        <div class="produto-item" data-id="${p.id}">
            <input type="text" class="produto-nome" value="${esc(p.nome)}" aria-label="Nome do produto">
            <input type="number" class="produto-preco" value="${p.preco_kg}" step="0.01" min="0" inputmode="decimal" aria-label="Preço por Kg">
            <button type="button" class="btn-produto btn-salvar" onclick="salvarProduto(${p.id})">
                <i class="fas fa-save" aria-hidden="true"></i> Salvar
            </button>
            <button type="button" class="btn-produto btn-perfil" onclick="abrirPerfilProduto(${p.id})">
                <i class="fas fa-id-card" aria-hidden="true"></i> Perfil
            </button>
        </div>
    `).join('');
}

// Salva (PUT) o nome e o preco de um produto ja existente
async function salvarProduto(id) {
    const item = document.querySelector(`.produto-item[data-id="${id}"]`);
    if (!item) return;
    const nome = item.querySelector('.produto-nome').value.trim();
    const preco_kg = parseFloat(item.querySelector('.produto-preco').value) || 0;
    try {
        const response = await fetch(`${API_BASE_URL}/produtos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, preco_kg })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha ao salvar');
        mostrarToast('Produto atualizado!', 'success');
        await carregarProdutos();
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

// Remove (DELETE) um produto, com confirmacao
async function removerProduto(id) {
    if (!confirm('Remover este produto?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/produtos/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover');
        mostrarToast('Produto removido.', 'success');
        await carregarProdutos();
    } catch (error) {
        mostrarToast('Erro ao remover produto.', 'error');
    }
}

// Adiciona (POST) um novo produto
async function adicionarProduto(event) {
    event.preventDefault();
    const nome = document.getElementById('novoProdutoNome').value.trim();
    const preco_kg = parseFloat(document.getElementById('novoProdutoPreco').value) || 0;
    if (!nome) {
        mostrarToast('Informe o nome do produto.', 'warning');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/produtos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, preco_kg })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha ao criar');
        mostrarToast('Produto adicionado!', 'success');
        document.getElementById('novoProdutoNome').value = '';
        document.getElementById('novoProdutoPreco').value = '';
        await carregarProdutos();
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

// ---------------------------------------------------------------------------
// Modal de perfil do produto
// ---------------------------------------------------------------------------
let perfilAtualId = null;

// Abre o modal com o perfil completo + o historico de precos
async function abrirPerfilProduto(id) {
    try {
        // Busca o produto e o historico em paralelo (Promise.all e mais rapido)
        const [rp, rh] = await Promise.all([
            fetch(`${API_BASE_URL}/produtos/${id}`),
            fetch(`${API_BASE_URL}/produtos/${id}/historico`)
        ]);
        if (!rp.ok) throw new Error('Falha ao carregar o produto');
        const produto = (await rp.json()).produto;
        const historico = rh.ok ? (await rh.json()).historico : [];

        perfilAtualId = id;
        document.getElementById('perfil_id').value = produto.id;
        document.getElementById('perfil_nome').value = produto.nome || '';
        document.getElementById('perfil_preco').value = produto.preco_kg ?? '';
        document.getElementById('perfil_categoria').value = produto.categoria || '';
        document.getElementById('perfil_validade').value = produto.validade || '';
        document.getElementById('perfil_fornecedor').value = produto.fornecedor || '';
        document.getElementById('perfil_lote').value = produto.lote || '';
        document.getElementById('perfil_fabricacao').value = produto.fabricacao || '';
        document.getElementById('perfil_observacoes').value = produto.observacoes || '';
        // Embalagem (quantidade + unidade + peso por unidade) e o total calculado
        document.getElementById('perfil_quantidade').value = produto.quantidade ?? '';
        document.getElementById('perfil_unidade').value = produto.unidade || '';
        document.getElementById('perfil_peso_unitario').value = produto.peso_unitario ?? '';
        calcPesoTotalPerfil();
        renderHistorico(historico);

        document.getElementById('produtoModal').classList.remove('hidden');
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

function fecharModalProduto() {
    document.getElementById('produtoModal').classList.add('hidden');
    perfilAtualId = null;
}

// Monta a linha do tempo de precos (do mais recente ao mais antigo)
// Rotulos amigaveis de cada campo do historico
const ROTULOS_HISTORICO = { preco: 'Preço', validade: 'Validade', lote: 'Lote', fabricacao: 'Fabricação' };

// Formata o valor conforme o tipo do campo (dinheiro, data ou texto)
function formatarValorHistorico(campo, valor) {
    if (valor == null || valor === '') return '—';
    if (campo === 'preco') return `R$ ${Number(valor).toFixed(2)}`;
    if (campo === 'validade' || campo === 'fabricacao') return formatarData(valor);
    return esc(valor);   // lote (texto livre)
}

// Monta o historico UNIFICADO de alteracoes (preco, validade, lote, fabricacao)
function renderHistorico(historico) {
    const container = document.getElementById('listaHistorico');
    if (!container) return;
    if (!historico || historico.length === 0) {
        container.innerHTML = '<p class="produtos-hint">Nenhuma alteração registrada ainda.</p>';
        return;
    }
    container.innerHTML = historico.map(h => {
        const data = new Date(h.created_at).toLocaleString('pt-BR');
        const rotulo = ROTULOS_HISTORICO[h.campo] || h.campo;
        const anterior = formatarValorHistorico(h.campo, h.valor_anterior);
        const novo = formatarValorHistorico(h.campo, h.valor_novo);
        // Cor so no preco: vermelho se subiu, verde se caiu
        let classe = '';
        if (h.campo === 'preco' && h.valor_anterior != null && h.valor_anterior !== '') {
            classe = Number(h.valor_novo) > Number(h.valor_anterior) ? 'text-error' : 'text-success';
        }
        return `
            <div class="historico-item">
                <span class="historico-data">${data}</span>
                <span class="historico-campo">${rotulo}</span>
                <span class="historico-mudanca">${anterior}
                    <i class="fas fa-arrow-right" aria-hidden="true"></i>
                    <strong class="${classe}">${novo}</strong>
                </span>
            </div>
        `;
    }).join('');
}

// Formata uma data 'YYYY-MM-DD' para 'DD/MM/YYYY' (ou '—' se vazia)
function formatarData(iso) {
    if (!iso) return '—';
    const [a, m, d] = iso.split('-');
    return (a && m && d) ? `${d}/${m}/${a}` : iso;
}

// Salva as alteracoes do perfil (PUT). Se o preco mudar, o historico e recarregado.
// Calcula o "Peso total" da embalagem ao vivo no modal do perfil.
// Regra: se ha peso por unidade, total = quantidade x peso_unitario (ex.: 10 x 1 = 10 Kg).
// Senao, se a unidade ja e "Kg", o total e a propria quantidade.
function calcPesoTotalPerfil() {
    const q = parseFloat(document.getElementById('perfil_quantidade').value) || 0;
    const pu = parseFloat(document.getElementById('perfil_peso_unitario').value) || 0;
    const uni = document.getElementById('perfil_unidade').value;
    let totalKg = 0;
    if (pu > 0) totalKg = q * pu;
    else if (uni === 'Kg') totalKg = q;
    const out = document.getElementById('perfil_peso_total');
    if (out) out.value = totalKg > 0 ? arredondar(totalKg, 3) + ' Kg' : '';
}

async function salvarPerfilProduto() {
    if (!perfilAtualId) return;
    const corpo = {
        nome: document.getElementById('perfil_nome').value.trim(),
        preco_kg: parseFloat(document.getElementById('perfil_preco').value) || 0,
        categoria: document.getElementById('perfil_categoria').value.trim(),
        validade: document.getElementById('perfil_validade').value,
        fornecedor: document.getElementById('perfil_fornecedor').value.trim(),
        lote: document.getElementById('perfil_lote').value.trim(),
        fabricacao: document.getElementById('perfil_fabricacao').value,
        observacoes: document.getElementById('perfil_observacoes').value.trim(),
        // Embalagem: numeros vazios viram null (nao sobrescrevem); unidade vazia ('') limpa
        quantidade: parseFloat(document.getElementById('perfil_quantidade').value) || null,
        unidade: document.getElementById('perfil_unidade').value || '',
        peso_unitario: parseFloat(document.getElementById('perfil_peso_unitario').value) || null
    };
    try {
        const response = await fetch(`${API_BASE_URL}/produtos/${perfilAtualId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Falha ao salvar');
        mostrarToast('Perfil salvo!', 'success');
        // Recarrega o historico unificado (qualquer campo pode ter mudado) e a lista
        const rh = await fetch(`${API_BASE_URL}/produtos/${perfilAtualId}/historico`);
        renderHistorico(rh.ok ? (await rh.json()).historico : []);
        await carregarProdutos();
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

// Exclui o produto (e o seu historico), com confirmacao
async function excluirPerfilProduto() {
    if (!perfilAtualId) return;
    if (!confirm('Excluir este produto e todo o seu histórico?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/produtos/${perfilAtualId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao excluir');
        mostrarToast('Produto excluído.', 'success');
        fecharModalProduto();
        await carregarProdutos();
    } catch (error) {
        mostrarToast('Erro ao excluir produto.', 'error');
    }
}

// Inicializar usuário
async function inicializarUsuario() {
    try {
        // Verificar se já existe um usuário salvo
        const usuarioSalvo = localStorage.getItem('usuario_id');
        if (usuarioSalvo) {
            USUARIO_ID = parseInt(usuarioSalvo);
            return;
        }
        
        // Criar usuário padrão
        const response = await fetch(`${API_BASE_URL}/usuarios`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nome: 'Usuário Web',
                email: `usuario_${Date.now()}@web.local`,
                empresa: 'Sistema Web',
                telefone: '(11) 0000-0000'
            })
        });
        
        if (!response.ok) {
            throw new Error('Erro ao criar usuário');
        }
        
        const data = await response.json();
        if (data.success) {
            USUARIO_ID = data.usuario_id;
            localStorage.setItem('usuario_id', USUARIO_ID);
            console.log('✅ Usuário criado:', USUARIO_ID);
        }
    } catch (error) {
        console.warn('⚠️ Erro ao inicializar usuário:', error);
        // Usar ID padrão para modo offline
        USUARIO_ID = 1;
    }
}

// Salvar cálculo no banco de dados
async function salvarNoBanco(dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/calculos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario_id: USUARIO_ID,
                produto: dados.produto,
                categoria: dados.categoria,
                preco: dados.preco,
                peso_inicial: dados.peso_inicial,
                peso_final: dados.peso_final,
                sacos_de_gelo: dados.sacos_de_gelo,
                caixa_papelao: dados.caixa_papelao,
                preco_venda: dados.preco_venda,
                observacoes: 'Calculado via interface web'
            })
        });
        
        if (!response.ok) {
            throw new Error('Erro ao salvar no banco');
        }
        
        const data = await response.json();
        if (data.success) {
            console.log('✅ Cálculo salvo no banco:', data.calculo_id);
            return data.resultados;   // resultados calculados pelo back-end (fonte unica)
        }
        throw new Error('Resposta inesperada da API');
    } catch (error) {
        console.warn('⚠️ Erro ao salvar no banco:', error);
        throw error;
    }
}

// Carregar histórico da API
async function carregarHistoricoAPI() {
    try {
        const response = await fetch(`${API_BASE_URL}/calculos/usuario/${USUARIO_ID}?limite=100`);
        if (!response.ok) {
            throw new Error('Erro ao carregar histórico');
        }
        
        const data = await response.json();
        if (data.success) {
            // Converter dados da API para formato do frontend
            historicoCalculos = data.calculos.map(calculo => ({
                id: calculo.id,
                timestamp: calculo.created_at,
                dados: {
                    produto: calculo.produto,
                    categoria: calculo.categoria,
                    preco: calculo.preco_kg,
                    peso_inicial: calculo.peso_inicial,
                    peso_final: calculo.peso_final,
                    sacos_de_gelo: calculo.sacos_gelo,
                    caixa_papelao: calculo.caixas_papelao
                },
                resultados: {
                    custo_sacos_gelo: calculo.custo_sacos_gelo,
                    custo_papelao: calculo.custo_papelao,
                    custo_fita_papelao: calculo.custo_fita_papelao,
                    diferenca_pesos: calculo.diferenca_pesos,
                    custo_producao: calculo.custo_producao,
                    custo_pos_beneficiamento: calculo.custo_pos_beneficiamento,
                    porcentagem: calculo.porcentagem_beneficiamento,
                    diferenca_valor: calculo.diferenca_valor,
                    custos_totais: calculo.custos_totais,
                    custo_final: calculo.custo_final
                }
            }));
            
            atualizarHistorico();
            console.log('✅ Histórico carregado da API:', historicoCalculos.length, 'cálculos');
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar histórico da API:', error);
        // Fallback para localStorage
        carregarHistorico();
        atualizarHistorico();
    }
}

// Histórico de cálculos (modo offline)
function salvarNoHistorico(dados, resultados) {
    const calculo = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        dados: dados,
        resultados: resultados
    };
    
    historicoCalculos.unshift(calculo);
    
    // Manter apenas os últimos 50 cálculos
    if (historicoCalculos.length > 50) {
        historicoCalculos = historicoCalculos.slice(0, 50);
    }
    
    localStorage.setItem('historicoCalculos', JSON.stringify(historicoCalculos));
    
    // Atualizar contador do histórico
    const historyCount = document.getElementById('historyCount');
    if (historyCount) {
        historyCount.textContent = historicoCalculos.length;
    }
}

function carregarHistorico() {
    // Esta função pode ser expandida para mostrar histórico na interface
    console.log('Histórico carregado:', historicoCalculos.length, 'cálculos');
}

// Sistema de abas
function inicializarTabs() {
    // Botoes de navegacao existem no header E no footer (classe .nav-btn)
    const navBtns = document.querySelectorAll('.nav-btn');

    navBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    // Remover active de todos os botoes (header + footer) e de todos os conteudos
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    // Destacar o botao ativo em TODOS os lugares (header e footer) e mostrar o conteudo
    document.querySelectorAll(`.nav-btn[data-tab="${tabId}"]`).forEach(btn => btn.classList.add('active'));
    document.getElementById(`${tabId}-tab`).classList.add('active');
    
    // Se for a aba de histórico, atualizar a lista
    if (tabId === 'history') {
        atualizarHistorico();
    }
    // Se for a aba de configuracoes, preencher com os precos atuais
    if (tabId === 'config') {
        preencherConfigForm();
    }
    // Se for a aba de produtos, renderizar a lista
    if (tabId === 'produtos') {
        renderListaProdutos();
    }
}

// Filtra os calculos conforme os campos de busca (produto, categoria, periodo)
function filtrarCalculos() {
    const texto = (document.getElementById('filtroProduto')?.value || '').trim().toLowerCase();
    const categoria = document.getElementById('filtroCategoria')?.value || '';
    const de = document.getElementById('filtroDe')?.value;
    const ate = document.getElementById('filtroAte')?.value;

    return historicoCalculos.filter(calculo => {
        const produto = (calculo.dados?.produto || '').toLowerCase();
        if (texto && !produto.includes(texto)) return false;
        if (categoria && calculo.dados?.categoria !== categoria) return false;
        if (de || ate) {
            const data = new Date(calculo.timestamp);
            if (de && data < new Date(de + 'T00:00:00')) return false;
            if (ate && data > new Date(ate + 'T23:59:59')) return false;
        }
        return true;
    });
}

// Limpa todos os filtros e re-renderiza o historico completo
function limparFiltros() {
    ['filtroProduto', 'filtroCategoria', 'filtroDe', 'filtroAte'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    atualizarHistorico();
}

// Gerenciamento do histórico
function atualizarHistorico() {
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    
    // Atualizar contador (mostra o total, independente do filtro)
    historyCount.textContent = historicoCalculos.length;

    // Aplica os filtros ativos (produto, categoria, periodo)
    const lista = filtrarCalculos();

    // Atualiza chips de filtro ativo, contador de resultados e botao Limpar.
    // (definido em melhorias.js; guardamos com typeof para nao quebrar caso
    //  o arquivo nao esteja carregado)
    if (typeof atualizarUIFiltros === 'function') atualizarUIFiltros(lista.length);

    if (lista.length === 0) {
        const semNada = historicoCalculos.length === 0;
        historyList.innerHTML = `
            <div class="empty-history">
                <i class="fas fa-history"></i>
                <h3>${semNada ? 'Nenhum cálculo realizado ainda' : 'Nenhum resultado para o filtro'}</h3>
                <p>${semNada ? 'Realize seu primeiro cálculo para ver o histórico aqui' : 'Tente ajustar ou limpar os filtros'}</p>
            </div>
        `;
        return;
    }

    // Renderizar histórico (lista ja filtrada)
    historyList.innerHTML = lista.map(calculo => {
        const data = new Date(calculo.timestamp);
        const dataFormatada = data.toLocaleString('pt-BR');
        const { dados, resultados } = calculo;
        
        return `
            <div class="history-item" onclick="visualizarHistorico(${calculo.id})">
                <div class="history-item-header">
                    <label class="history-check-wrap" title="Selecionar para o PDF" onclick="event.stopPropagation()">
                        <input type="checkbox" class="history-check" data-id="${calculo.id}">
                    </label>
                    <div class="history-item-info">
                        <div class="history-item-title">
                            <i class="fas fa-fish"></i>
                            ${dados.produto}
                        </div>
                        <div class="history-item-meta">
                            <i class="fas fa-calendar"></i>
                            ${dataFormatada}
                            <span style="margin: 0 0.5rem;">•</span>
                            <i class="fas fa-tag"></i>
                            ${dados.categoria}
                        </div>
                    </div>
                    <div class="history-item-actions">
                        <button class="history-action-btn" onclick="event.stopPropagation(); duplicarCalculo(${calculo.id})" title="Duplicar">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="history-action-btn" onclick="event.stopPropagation(); removerHistorico(${calculo.id})" title="Remover">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="history-item-summary">
                    <div class="history-summary-item">
                        <div class="history-summary-value">${resultados.porcentagem.toFixed(1)}%</div>
                        <div class="history-summary-label">Beneficiamento</div>
                    </div>
                    <div class="history-summary-item">
                        <div class="history-summary-value">+${arredondar(resultados.diferenca_pesos)} Kg</div>
                        <div class="history-summary-label">Ganho</div>
                    </div>
                    <div class="history-summary-item">
                        <div class="history-summary-value">R$ ${resultados.custo_pos_beneficiamento.toFixed(2)}</div>
                        <div class="history-summary-label">Custo/Kg</div>
                    </div>
                    <div class="history-summary-item">
                        <div class="history-summary-value">R$ ${resultados.custo_final.toFixed(2)}</div>
                        <div class="history-summary-label">Total</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Re-marca os checkboxes conforme a selecao atual e atualiza a barra
    // (definido em historico-selecao.js; typeof evita erro se nao carregar).
    if (typeof aplicarSelecaoNaLista === 'function') aplicarSelecaoNaLista();
}

function visualizarHistorico(id) {
    const calculo = historicoCalculos.find(c => c.id === id);
    if (!calculo) return;
    
    // Preencher formulário com os dados do histórico
    Object.keys(campos).forEach(key => {
        if (campos[key] && calculo.dados[key] !== undefined) {
            campos[key].value = calculo.dados[key];
        }
    });
    
    // Calcular e mostrar resultados
    const resultados = calcularCustos(calculo.dados);
    exibirResultados(calculo.dados, resultados);
    
    // Voltar para a aba de calculadora
    switchTab('calculator');
    
    mostrarToast('Cálculo carregado do histórico!', 'success');
}

function duplicarCalculo(id) {
    const calculo = historicoCalculos.find(c => c.id === id);
    if (!calculo) return;
    
    // Preencher formulário com os dados do histórico
    Object.keys(campos).forEach(key => {
        if (campos[key] && calculo.dados[key] !== undefined) {
            campos[key].value = calculo.dados[key];
        }
    });
    
    // Voltar para a aba de calculadora
    switchTab('calculator');
    
    mostrarToast('Dados copiados para novo cálculo!', 'success');
}

function removerHistorico(id) {
    if (confirm('Tem certeza que deseja remover este cálculo do histórico?')) {
        historicoCalculos = historicoCalculos.filter(c => c.id !== id);
        localStorage.setItem('historicoCalculos', JSON.stringify(historicoCalculos));
        atualizarHistorico();
        mostrarToast('Cálculo removido do histórico!', 'success');
    }
}

function limparHistorico() {
    if (historicoCalculos.length === 0) {
        mostrarToast('O histórico já está vazio!', 'warning');
        return;
    }
    
    if (confirm('Tem certeza que deseja limpar todo o histórico? Esta ação não pode ser desfeita.')) {
        historicoCalculos = [];
        localStorage.removeItem('historicoCalculos');
        atualizarHistorico();
        mostrarToast('Histórico limpo com sucesso!', 'success');
    }
}

