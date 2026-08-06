// ---------------------------------------------------------------------------
// CONFIGURACAO DA API
// Um unico lugar para a URL do back-end. Em producao, esta e a URL da API no
// PythonAnywhere (ex.: https://SEU_USUARIO.pythonanywhere.com/api).
// ---------------------------------------------------------------------------
const PRODUCTION_API_URL = 'https://arthur.pythonanywhere.com/api'; 
const rodandoLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = rodandoLocal ? 'http://localhost:5000/api' : PRODUCTION_API_URL;

// Precos de FALLBACK (usados so no modo offline). Com a API no ar,
// carregarConfiguracoes() sobrescreve estes valores com os precos do banco,
// que sao a fonte oficial dos precos.
let PRECOS = { GELO: 8.5, PAPELAO: 7.3, FITA: 0.34 };
// Lista de produtos vinda do banco (id, nome, preco_kg)
let PRODUTOS = [];
// Tipos de embalagem cadastrados (id, nome, valor) — derivado de INSUMOS (categoria 'embalagem'),
// mantido para o select do perfil do produto e da calculadora continuarem funcionando.
let EMBALAGENS = [];
// Catálogo completo de insumos (id, nome, valor, categoria) vindo de /api/insumos.
let INSUMOS = [];
// Estado do login em duas etapas (2FA): token do 1º passo e sessão aguardando o
// usuário confirmar que guardou os códigos de backup.
let PRE_TOKEN_2FA = null;
let SESSAO_PENDENTE = null;

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
let historicoLimite = 100;        // quantos cálculos buscar do servidor
let historicoTemMais = false;     // se o servidor pode ter mais além do limite atual

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

    // A aba Insumos usa formulários criados dinamicamente (onsubmit inline em
    // renderInsumosCatalogo), então não há binding fixo aqui.

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

    // Ao escolher um produto, preenche o preco por kg com o valor salvo
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
        // 'mousedown' (nao 'click'): so fecha se o clique COMECOU no fundo do
        // modal. Assim, selecionar texto num campo e soltar no fundo nao fecha.
        overlayModal.addEventListener('mousedown', function(e) {
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
    // 2FA: form do código (2º passo) e botão de "já guardei os códigos de backup"
    const twofaForm = document.getElementById('twofaForm');
    if (twofaForm) twofaForm.addEventListener('submit', verificar2FA);
    const btnBackupOk = document.getElementById('btnBackupOk');
    if (btnBackupOk) btnBackupOk.addEventListener('click', finalizarLogin);
    // Botao de mostrar/ocultar a senha
    const toggleSenha = document.getElementById('toggleSenha');
    if (toggleSenha) toggleSenha.addEventListener('click', alternarSenha);
    // Ao digitar de novo, some com a mensagem de erro anterior
    ['login_email', 'login_senha'].forEach(function (id) {
        const campo = document.getElementById(id);
        if (campo) campo.addEventListener('input', limparErroLogin);
    });
    // Aba de Logs: botao atualizar e filtro por tipo
    const btnLogs = document.getElementById('btnAtualizarLogs');
    if (btnLogs) btnLogs.addEventListener('click', carregarLogs);
    const filtroLogs = document.getElementById('logsFiltro');
    if (filtroLogs) filtroLogs.addEventListener('change', carregarLogs);
    const filtroLogsDe = document.getElementById('logsDe');
    if (filtroLogsDe) filtroLogsDe.addEventListener('change', carregarLogs);
    const filtroLogsAte = document.getElementById('logsAte');
    if (filtroLogsAte) filtroLogsAte.addEventListener('change', carregarLogs);
    const btnLimparLogs = document.getElementById('btnLimparLogsAntigos');
    if (btnLimparLogs) btnLimparLogs.addEventListener('click', limparLogsAntigos);
    // Historico: carregar mais
    const btnMaisHist = document.getElementById('btnCarregarMais');
    if (btnMaisHist) btnMaisHist.addEventListener('click', carregarMaisHistorico);
    // Usuarios: criar novo
    const formUsuario = document.getElementById('formNovoUsuario');
    if (formUsuario) formUsuario.addEventListener('submit', criarUsuarioAdmin);
    // Lotes: adicionar novo (form dentro do modal de perfil)
    const formLote = document.getElementById('formNovoLote');
    if (formLote) formLote.addEventListener('submit', adicionarLote);
    // Comboboxes de categoria e fornecedor (sugerem valores já cadastrados)
    initCombobox('perfil_categoria', 'opcoesCategoria', () => valoresDistintos('categoria'));
    initCombobox('perfil_fornecedor', 'opcoesFornecedor', () => valoresDistintos('fornecedor'));
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
        custo_embalagem = 0,
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
                    <div class="result-card-label">Lucro por kg</div>
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
                    <span class="detail-item-label">Preço de venda por kg</span>
                    <span class="detail-item-value">R$ ${resultados.preco_venda.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label" title="Matéria-prima + todos os insumos (gelo, papelão, fita, embalagem), por kg do peso final. É a base do lucro.">Custo total por kg</span>
                    <span class="detail-item-value">R$ ${resultados.custo_total_por_kg.toFixed(2)}</span>
                </div>
            </div>
        </div>
    ` : '';

    resultContent.innerHTML = `
        <div class="result-info">
            <div class="result-header-info">
                <div class="result-product">
                    <i class="fas fa-fish"></i>
                    <span>${esc(produto)}</span>
                </div>
                <div class="result-category ${categoriaColor}">
                    <i class="${categoriaIcon}"></i>
                    <span>${esc(categoria)}</span>
                </div>
            </div>
        </div>
        
        <div class="result-grid">
            <div class="result-card">
                <div class="result-card-icon primary">
                    <i class="fas fa-percentage"></i>
                </div>
                <div class="result-card-value">${porcentagem.toFixed(1)}%</div>
                <div class="result-card-label" title="Quanto o peso aumentou do inicio ao fim do processo (em %).">Beneficiamento</div>
            </div>
            
            <div class="result-card">
                <div class="result-card-icon success">
                    <i class="fas fa-weight-hanging"></i>
                </div>
                <div class="result-card-value">+${arredondar(diferenca_pesos)} kg</div>
                <div class="result-card-label">Ganho de Peso</div>
            </div>
            
            <div class="result-card">
                <div class="result-card-icon warning">
                    <i class="fas fa-dollar-sign"></i>
                </div>
                <div class="result-card-value">R$ ${custo_pos_beneficiamento.toFixed(2)}</div>
                <div class="result-card-label">Custo por kg</div>
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
                    <span class="detail-item-label">Sacos de gelo (${sacos_de_gelo} un. &times; R$ ${(sacos_de_gelo ? custo_sacos_gelo / sacos_de_gelo : 0).toFixed(2)})</span>
                    <span class="detail-item-value">R$ ${custo_sacos_gelo.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Caixas de papelão (${caixa_papelao} un. &times; R$ ${(caixa_papelao ? custo_papelao / caixa_papelao : 0).toFixed(2)})</span>
                    <span class="detail-item-value">R$ ${custo_papelao.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Fita adesiva</span>
                    <span class="detail-item-value">R$ ${custo_fita_papelao.toFixed(2)}</span>
                </div>
                ${custo_embalagem > 0 ? `
                <div class="detail-item">
                    <span class="detail-item-label">Embalagem</span>
                    <span class="detail-item-value">R$ ${custo_embalagem.toFixed(2)}</span>
                </div>` : ''}
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
                    <span class="detail-item-value">${peso_inicial} kg</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Peso final</span>
                    <span class="detail-item-value">${peso_final} kg</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label">Preço inicial por kg</span>
                    <span class="detail-item-value">R$ ${dados.preco.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label" title="Quanto custa cada quilo depois do beneficiamento.">Custo pós-beneficiamento por kg</span>
                    <span class="detail-item-value">R$ ${custo_pos_beneficiamento.toFixed(2)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-item-label" title="Diferenca entre o preco inicial por kg e o custo por kg apos o processo.">Diferença de valor por kg</span>
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
// Ajusta a interface conforme o papel e as permissões (abas) do usuário.
// IMPORTANTE: isto é só UX (esconder botões). A segurança de verdade está no
// servidor (@exige_admin / @exige_permissao) — o front nunca é a fonte da verdade
// de permissão, porque o usuário pode alterar o HTML/JS no próprio navegador.
function aplicarPermissoesUI() {
    const ehAdmin = localStorage.getItem('papel') === 'admin';
    let permissoes = [];
    try { permissoes = JSON.parse(localStorage.getItem('permissoes') || '[]'); } catch (e) { permissoes = []; }
    // Elementos SÓ-admin (Configurações, Logs, Usuários)
    document.querySelectorAll('[data-admin]').forEach(el => {
        el.style.display = ehAdmin ? '' : 'none';
    });
    // Elementos por permissão de aba (ex.: Histórico, Produtos): admin vê tudo;
    // usuário comum vê só o que estiver na lista de permissões dele.
    document.querySelectorAll('[data-perm]').forEach(el => {
        const perm = el.getAttribute('data-perm');
        el.style.display = (ehAdmin || permissoes.includes(perm)) ? '' : 'none';
    });
}

async function inicializarSistema() {
    try {
        // Ajusta a interface conforme o papel do usuário (admin x leitura)
        aplicarPermissoesUI();

        // Verificar se a API está funcionando
        await verificarAPI();
        
        // Carregar configurações da API
        await carregarConfiguracoes();

        // Carregar produtos e seus precos
        await carregarProdutos();

        // Carregar histórico do banco de dados (do usuário logado)
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


// ---------------------------------------------------------------------------
// Login, logout e backup
// ---------------------------------------------------------------------------
function mostrarLogin() {
    resetLoginUI();   // sempre abre no passo 1 (e-mail + senha)
    const o = document.getElementById('loginOverlay');
    if (o) o.classList.remove('hidden');
}

// Volta o modal de login para o estado inicial (passo 1). Chamado ao abrir o
// login e depois de um login concluído, para o próximo começar limpo.
function resetLoginUI() {
    const set = (id, hidden) => { const el = document.getElementById(id); if (el) el.hidden = hidden; };
    set('loginForm', false);
    set('twofaStep', true);
    set('twofaForm', false);
    set('twofaSetup', true);
    set('backupCodesBox', true);
    const cod = document.getElementById('twofa_codigo'); if (cod) cod.value = '';
    const qr = document.getElementById('twofaQr'); if (qr) qr.innerHTML = '';
    limparErroLogin();
}

function esconderLogin() {
    const o = document.getElementById('loginOverlay');
    if (o) o.classList.add('hidden');
}

// Mostra/oculta a senha alternando o type do input entre "password" e "text".
function alternarSenha() {
    const input = document.getElementById('login_senha');
    const btn = document.getElementById('toggleSenha');
    if (!input || !btn) return;
    const icone = btn.querySelector('i');
    const vaiMostrar = input.type === 'password';   // se está escondida, vamos mostrar
    input.type = vaiMostrar ? 'text' : 'password';
    // Troca o ícone: olho aberto (escondida) x olho cortado (mostrando)
    if (icone) {
        icone.classList.toggle('fa-eye', !vaiMostrar);
        icone.classList.toggle('fa-eye-slash', vaiMostrar);
    }
    // Acessibilidade: informa o estado para leitores de tela
    btn.setAttribute('aria-pressed', String(vaiMostrar));
    const rotulo = vaiMostrar ? 'Ocultar senha' : 'Mostrar senha';
    btn.setAttribute('aria-label', rotulo);
    btn.setAttribute('title', rotulo);
    input.focus();
}

// Exibe uma mensagem de erro dentro da caixa de login.
function mostrarErroLogin(msg) {
    const el = document.getElementById('loginErro');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
}

// Esconde a mensagem de erro do login.
function limparErroLogin() {
    const el = document.getElementById('loginErro');
    if (el) { el.textContent = ''; el.hidden = true; }
}

// 1º passo: e-mail + senha. Se a senha estiver certa, o servidor NÃO entrega a
// sessão ainda — pede o 2FA. Guardamos o pré-token e mostramos o passo do código.
async function fazerLogin(event) {
    event.preventDefault();
    limparErroLogin();   // limpa erro de tentativa anterior
    const email = document.getElementById('login_email').value.trim();
    const senha = document.getElementById('login_senha').value;
    try {
        const resp = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });
        // Se a resposta não for JSON válido, usa objeto vazio para não quebrar
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'E-mail ou senha inválidos');
        PRE_TOKEN_2FA = data.pre_token;             // usado no 2º passo
        document.getElementById('login_senha').value = '';
        mostrarPasso2FA(data);
    } catch (error) {
        // "Failed to fetch" = servidor fora do ar / sem internet
        const msg = (error.message === 'Failed to fetch')
            ? 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'
            : error.message;
        mostrarErroLogin(msg);   // mensagem visível dentro da caixa de login
    }
}

// Mostra o passo do 2FA. No primeiro login (needs_2fa_setup), exibe o QR + o
// segredo para o usuário cadastrar no app autenticador; depois, só o campo do código.
function mostrarPasso2FA(data) {
    document.getElementById('loginForm').hidden = true;
    limparErroLogin();
    document.getElementById('twofaStep').hidden = false;
    const setup = document.getElementById('twofaSetup');
    if (data.needs_2fa_setup) {
        setup.hidden = false;
        document.getElementById('twofaSecret').textContent = data.secret || '';
        const qr = document.getElementById('twofaQr');
        qr.innerHTML = '';
        // QRCode vem da lib qrcodejs (CDN). Se faltar, o usuário ainda pode usar o
        // segredo manual acima — por isso o QR é um "extra", não um bloqueio.
        if (window.QRCode && data.otpauth_uri) {
            try { new QRCode(qr, { text: data.otpauth_uri, width: 180, height: 180 }); } catch (e) { }
        }
    } else {
        setup.hidden = true;
    }
    const cod = document.getElementById('twofa_codigo');
    if (cod) cod.focus();
}

// 2º passo: envia o código (do app ou de backup) e recebe o token de sessão.
async function verificar2FA(event) {
    event.preventDefault();
    const elErro = document.getElementById('twofaErro');
    if (elErro) elErro.hidden = true;
    const codigo = document.getElementById('twofa_codigo').value.trim();
    try {
        const resp = await fetch(`${API_BASE_URL}/login/2fa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pre_token: PRE_TOKEN_2FA, codigo })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Código inválido');
        SESSAO_PENDENTE = data;
        // Se for o primeiro login, vieram códigos de backup: mostra ANTES de entrar.
        if (data.backup_codes && data.backup_codes.length) {
            mostrarBackupCodes(data.backup_codes);
        } else {
            finalizarLogin();
        }
    } catch (error) {
        if (elErro) { elErro.textContent = error.message; elErro.hidden = false; }
    }
}

// Mostra os códigos de backup uma única vez, obrigando o usuário a confirmar que
// guardou antes de entrar (o botão chama finalizarLogin).
function mostrarBackupCodes(codes) {
    document.getElementById('twofaForm').hidden = true;
    document.getElementById('twofaSetup').hidden = true;
    document.getElementById('backupCodesList').innerHTML =
        codes.map(c => `<li>${esc(c)}</li>`).join('');
    document.getElementById('backupCodesBox').hidden = false;
}

// Efetiva a sessão: guarda o token e entra no sistema.
function finalizarLogin() {
    const data = SESSAO_PENDENTE || {};
    SESSAO_PENDENTE = null;
    PRE_TOKEN_2FA = null;
    localStorage.setItem('token', data.token);
    localStorage.setItem('papel', data.papel || 'leitura');
    localStorage.setItem('permissoes', JSON.stringify(data.permissoes || []));
    resetLoginUI();
    esconderLogin();
    switchTab('calculator');   // ao logar, sempre cai na Calculadora
    mostrarToast(`Bem-vindo, ${data.nome}!`, 'success');
    inicializarSistema();
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('papel');
    localStorage.removeItem('permissoes');
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
            await carregarInsumos();
        }
    } catch (error) {
        console.warn('⚠️ Erro ao carregar produtos (mantendo lista fixa):', error);
    }
}

// --- Catálogo de insumos (gelo, papelão, fita, embalagem) ------------------
// Categorias exibidas na aba Insumos e usadas para popular os selects da calculadora.
const CATEGORIAS_INSUMO = [
    { chave: 'gelo', titulo: 'Gelo', icone: 'fa-snowflake' },
    { chave: 'papelao', titulo: 'Caixas de papelão', icone: 'fa-box' },
    { chave: 'fita', titulo: 'Fita', icone: 'fa-tape' },
    { chave: 'embalagem', titulo: 'Embalagens', icone: 'fa-box-open' },
];

async function carregarInsumos() {
    try {
        const resp = await fetch(`${API_BASE_URL}/insumos`);
        if (!resp.ok) throw new Error('Falha');
        const data = await resp.json();
        INSUMOS = data.insumos || [];
    } catch (e) {
        console.warn('⚠️ Erro ao carregar insumos:', e);
        INSUMOS = [];
    }
    // Embalagem é uma categoria de insumo; o perfil do produto ainda usa EMBALAGENS.
    EMBALAGENS = INSUMOS.filter(i => i.categoria === 'embalagem');
    renderInsumosCatalogo();      // aba Insumos
    popularSelectEmbalagem();     // selects de embalagem (perfil do produto + calculadora)
    popularSelectsInsumos();      // selects de tipo na calculadora (gelo/papelão/fita)
}

// Preenche os <select> de tipo de embalagem (perfil do produto E calculadora).
// Ambos usam a mesma lista de embalagens cadastradas.
function popularSelectEmbalagem() {
    const opcoes = '<option value="">— Nenhuma —</option>' +
        EMBALAGENS.map(e =>
            `<option value="${e.id}">${esc(e.nome)} (R$ ${Number(e.valor).toFixed(2)})</option>`).join('');
    ['perfil_embalagem', 'calc_embalagem'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const atual = sel.value;   // preserva a escolha ao repovoar
        sel.innerHTML = opcoes;
        if (atual) sel.value = atual;
    });
}

// Preenche as datalists de categoria e fornecedor com os valores JÁ cadastrados
// Devolve os valores distintos de um campo dos produtos (para as sugestões)
function valoresDistintos(campo) {
    return [...new Set(PRODUTOS.map(p => (p[campo] || '').trim()).filter(Boolean))].sort();
}

// Combobox custom (input + lista estilizada). Substitui o <datalist> nativo, que
// não respeita o tema do site. Sugere valores existentes e deixa digitar um novo.
function initCombobox(inputId, boxId, getOpcoes) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);
    if (!input || !box) return;

    function render() {
        const termo = input.value.trim().toLowerCase();
        const ops = getOpcoes().filter(o => o.toLowerCase().includes(termo));
        if (!ops.length) { box.hidden = true; return; }
        box.innerHTML = ops.map(o => `<div class="combobox-op" role="option">${esc(o)}</div>`).join('');
        box.hidden = false;
    }
    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    // Esconde ao sair do campo (com atraso para o clique na opção acontecer antes)
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    // mousedown (não click) para disparar ANTES do blur do input
    box.addEventListener('mousedown', (e) => {
        const op = e.target.closest('.combobox-op');
        if (!op) return;
        e.preventDefault();
        input.value = op.textContent;
        box.hidden = true;
        input.dispatchEvent(new Event('change'));
    });
}

// Renderiza a aba Insumos: uma seção por categoria, cada uma com a lista editável
// (nome + valor, Salvar/Remover) e um formulário para adicionar um novo tipo.
function renderInsumosCatalogo() {
    const cont = document.getElementById('insumosCatalogo');
    if (!cont) return;
    cont.innerHTML = CATEGORIAS_INSUMO.map(cat => {
        const itens = INSUMOS.filter(i => i.categoria === cat.chave);
        const linhas = itens.length ? itens.map(i => `
            <div class="insumo-item" data-id="${i.id}">
                <input type="text" class="ins-nome" value="${esc(i.nome)}" aria-label="Nome do insumo">
                <input type="number" class="ins-valor" value="${i.valor}" step="0.01" min="0" inputmode="decimal" aria-label="Valor">
                <button type="button" class="btn-produto btn-salvar" onclick="salvarInsumo(${i.id})">
                    <i class="fas fa-save" aria-hidden="true"></i> Salvar
                </button>
                <button type="button" class="btn-produto btn-excluir" onclick="removerInsumo(${i.id})" aria-label="Excluir insumo" title="Excluir insumo">
                    <i class="fas fa-trash" aria-hidden="true"></i> Excluir
                </button>
            </div>`).join('') : '<p class="produtos-hint">Nenhum tipo cadastrado ainda.</p>';
        return `
            <div class="produtos-section">
                <h3><i class="fas ${cat.icone}" aria-hidden="true"></i> ${cat.titulo}</h3>
                <div class="insumos-lista">${linhas}</div>
                <form class="produto-novo" onsubmit="adicionarInsumo(event, '${cat.chave}')">
                    <input type="text" class="novo-ins-nome" placeholder="Nome do tipo (ex.: Caixa 5kg)" aria-label="Nome do novo tipo">
                    <input type="number" class="novo-ins-valor" step="0.01" min="0" inputmode="decimal" placeholder="Valor (R$)" aria-label="Valor">
                    <button type="submit" class="action-btn primary">
                        <i class="fas fa-plus" aria-hidden="true"></i> Adicionar
                    </button>
                </form>
            </div>`;
    }).join('');
}

// Preenche os selects de TIPO da calculadora (gelo/papelão/fita) com os insumos
// de cada categoria. Sem "nenhum": cada categoria tem ao menos o tipo padrão.
function popularSelectsInsumos() {
    [['gelo_insumo_id', 'gelo'], ['papelao_insumo_id', 'papelao'], ['fita_insumo_id', 'fita']].forEach(([selId, cat]) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const itens = INSUMOS.filter(i => i.categoria === cat);
        const atual = sel.value;   // preserva a escolha ao repovoar
        sel.innerHTML = itens.map(i =>
            `<option value="${i.id}">${esc(i.nome)} (R$ ${Number(i.valor).toFixed(2)})</option>`).join('');
        if (atual && itens.some(i => String(i.id) === String(atual))) sel.value = atual;
    });
}

async function adicionarInsumo(event, categoria) {
    event.preventDefault();
    const form = event.target;
    const nome = form.querySelector('.novo-ins-nome').value.trim();
    const valor = parseFloat(form.querySelector('.novo-ins-valor').value) || 0;
    if (!nome) { mostrarToast('Informe o nome do insumo.', 'warning'); return; }
    try {
        const resp = await fetch(`${API_BASE_URL}/insumos`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, valor, categoria })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao adicionar');
        mostrarToast('Insumo adicionado!', 'success');
        carregarInsumos();
    } catch (e) { mostrarToast(e.message, 'error'); }
}

async function salvarInsumo(id) {
    const row = document.querySelector(`.insumo-item[data-id="${id}"]`);
    if (!row) return;
    const nome = row.querySelector('.ins-nome').value.trim();
    const valor = parseFloat(row.querySelector('.ins-valor').value) || 0;
    // Ação sensível: mudar o valor afeta os próximos cálculos feitos com este tipo.
    if (!confirm('Alterar este insumo muda o custo dos próximos cálculos feitos com ele. Salvar?')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/insumos/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, valor })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao salvar');
        mostrarToast('Insumo salvo!', 'success');
        carregarInsumos();
    } catch (e) { mostrarToast(e.message, 'error'); }
}

async function removerInsumo(id) {
    if (!confirm('Remover este insumo? Cálculos antigos não mudam; produtos que usam esta embalagem ficam sem ela.')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/insumos/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Falha ao remover');
        mostrarToast('Insumo removido.', 'success');
        carregarInsumos();
    } catch (e) { mostrarToast('Não foi possível remover.', 'error'); }
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

// Ao escolher um produto, preenche o preco por kg com o valor salvo (se houver)
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

    container.innerHTML = lista.map(p => {
        // Alerta de validade: usa a validade mais próxima entre os lotes do produto
        let alerta = '';
        if (p.proxima_validade) {
            const st = statusLote(p.proxima_validade);
            if (st.cor !== 'ok') alerta = `<span class="log-badge ${st.cor}" title="Validade mais próxima">${st.texto}</span>`;
        }
        return `
        <div class="produto-item" data-id="${p.id}">
            <input type="text" class="produto-nome" value="${esc(p.nome)}" aria-label="Nome do produto">
            <input type="number" class="produto-preco" value="${p.preco_kg}" step="0.01" min="0" inputmode="decimal" aria-label="Preço por kg">
            ${alerta}
            <button type="button" class="btn-produto btn-salvar" onclick="salvarProduto(${p.id})">
                <i class="fas fa-save" aria-hidden="true"></i> Salvar
            </button>
            <button type="button" class="btn-produto btn-perfil" onclick="abrirPerfilProduto(${p.id})">
                <i class="fas fa-id-card" aria-hidden="true"></i> Perfil
            </button>
        </div>`;
    }).join('');
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
        document.getElementById('perfil_fornecedor').value = produto.fornecedor || '';
        document.getElementById('perfil_observacoes').value = produto.observacoes || '';
        // Embalagem (quantidade + unidade + peso por unidade) e o total calculado
        document.getElementById('perfil_quantidade').value = produto.quantidade ?? '';
        document.getElementById('perfil_unidade').value = produto.unidade || '';
        document.getElementById('perfil_peso_unitario').value = produto.peso_unitario ?? '';
        // Select de tipo de embalagem (as sugestões de categoria/fornecedor são o combobox)
        popularSelectEmbalagem();
        document.getElementById('perfil_embalagem').value = produto.embalagem_id || '';
        calcPesoTotalPerfil();
        renderHistorico(historico);
        carregarLotesPerfil(id);   // carrega os lotes deste produto

        document.getElementById('produtoModal').classList.remove('hidden');
    } catch (error) {
        mostrarToast(error.message, 'error');
    }
}

function fecharModalProduto() {
    document.getElementById('produtoModal').classList.add('hidden');
    perfilAtualId = null;
}

// --- Lotes do produto ------------------------------------------------------
// Status pela validade: vencido / vence em Xd (<=30) / válido / sem validade
function statusLote(validade) {
    if (!validade) return { texto: 'sem validade', cor: 'neutro' };
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const val = new Date(validade + 'T00:00:00');
    const dias = Math.round((val - hoje) / 86400000);
    if (dias < 0) return { texto: 'vencido', cor: 'erro' };
    if (dias <= 30) return { texto: `vence em ${dias}d`, cor: 'aviso' };
    return { texto: 'válido', cor: 'ok' };
}

async function carregarLotesPerfil(produtoId) {
    const cont = document.getElementById('listaLotes');
    if (!cont) return;
    cont.innerHTML = '<p class="produtos-hint">Carregando...</p>';
    try {
        const resp = await fetch(`${API_BASE_URL}/produtos/${produtoId}/lotes`);
        if (!resp.ok) throw new Error('Falha');
        renderLotes((await resp.json()).lotes || []);
    } catch (e) {
        cont.innerHTML = '<p class="produtos-hint">Não foi possível carregar os lotes.</p>';
    }
}

function renderLotes(lotes) {
    const cont = document.getElementById('listaLotes');
    if (!lotes.length) { cont.innerHTML = '<p class="produtos-hint">Nenhum lote cadastrado.</p>'; return; }
    cont.innerHTML = lotes.map(l => {
        const st = statusLote(l.validade);
        return `
        <div class="lote-item" data-id="${l.id}">
            <span class="log-badge ${st.cor}">${st.texto}</span>
            <input type="text" class="lote-cod" value="${esc(l.codigo || '')}" placeholder="Código" aria-label="Código do lote">
            <label class="lote-campo">Fab. <input type="date" class="lote-fab" value="${l.fabricacao || ''}"></label>
            <label class="lote-campo">Val. <input type="date" class="lote-val" value="${l.validade || ''}"></label>
            <input type="number" class="lote-qtd" value="${l.quantidade ?? ''}" step="0.01" min="0" inputmode="decimal" placeholder="kg" aria-label="Quantidade">
            <button type="button" class="btn-produto btn-salvar" onclick="salvarLote(${l.id})" aria-label="Salvar lote" title="Salvar lote"><i class="fas fa-save" aria-hidden="true"></i> Salvar</button>
            <button type="button" class="btn-produto btn-excluir" onclick="removerLote(${l.id})" aria-label="Excluir lote" title="Excluir lote"><i class="fas fa-trash" aria-hidden="true"></i> Excluir</button>
        </div>`;
    }).join('');
}

async function adicionarLote(event) {
    event.preventDefault();
    if (!perfilAtualId) return;
    const corpo = {
        codigo: document.getElementById('loteCodigo').value.trim(),
        fabricacao: document.getElementById('loteFabricacao').value,
        validade: document.getElementById('loteValidade').value,
        quantidade: document.getElementById('loteQuantidade').value
    };
    try {
        const resp = await fetch(`${API_BASE_URL}/produtos/${perfilAtualId}/lotes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao adicionar lote');
        document.getElementById('formNovoLote').reset();
        mostrarToast('Lote adicionado!', 'success');
        carregarLotesPerfil(perfilAtualId);
        carregarProdutos();   // atualiza os alertas de validade na lista
    } catch (e) { mostrarToast(e.message, 'error'); }
}

async function salvarLote(id) {
    const row = document.querySelector(`.lote-item[data-id="${id}"]`);
    if (!row) return;
    const corpo = {
        codigo: row.querySelector('.lote-cod').value.trim(),
        fabricacao: row.querySelector('.lote-fab').value,
        validade: row.querySelector('.lote-val').value,
        quantidade: row.querySelector('.lote-qtd').value
    };
    try {
        const resp = await fetch(`${API_BASE_URL}/lotes/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        if (!resp.ok) throw new Error('Falha');
        mostrarToast('Lote salvo!', 'success');
        carregarLotesPerfil(perfilAtualId);
        carregarProdutos();
    } catch (e) { mostrarToast('Não foi possível salvar o lote.', 'error'); }
}

async function removerLote(id) {
    if (!confirm('Remover este lote?')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/lotes/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Falha');
        mostrarToast('Lote removido.', 'success');
        carregarLotesPerfil(perfilAtualId);
        carregarProdutos();
    } catch (e) { mostrarToast('Não foi possível remover.', 'error'); }
}

// Monta a linha do tempo de precos (do mais recente ao mais antigo)
// Rotulos amigaveis de cada campo do historico
const ROTULOS_HISTORICO = { preco: 'Preço', validade: 'Validade', lote: 'Lote',
    fabricacao: 'Fabricação', fornecedor: 'Fornecedor', categoria: 'Categoria', observacoes: 'Observações' };

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
    if (out) out.value = totalKg > 0 ? arredondar(totalKg, 3) + ' kg' : '';
}

async function salvarPerfilProduto() {
    if (!perfilAtualId) return;
    const corpo = {
        nome: document.getElementById('perfil_nome').value.trim(),
        preco_kg: parseFloat(document.getElementById('perfil_preco').value) || 0,
        categoria: document.getElementById('perfil_categoria').value.trim(),
        fornecedor: document.getElementById('perfil_fornecedor').value.trim(),
        observacoes: document.getElementById('perfil_observacoes').value.trim(),
        // Embalagem: numeros vazios viram null (nao sobrescrevem); unidade vazia ('') limpa
        quantidade: parseFloat(document.getElementById('perfil_quantidade').value) || null,
        unidade: document.getElementById('perfil_unidade').value || '',
        peso_unitario: parseFloat(document.getElementById('perfil_peso_unitario').value) || null,
        // Tipo de embalagem escolhido ('' = nenhuma)
        embalagem_id: document.getElementById('perfil_embalagem').value || ''
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

// Salvar cálculo no banco de dados
async function salvarNoBanco(dados) {
    try {
        const response = await fetch(`${API_BASE_URL}/calculos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                // usuario_id NÃO é enviado: o servidor usa a identidade do token
                produto: dados.produto,
                categoria: dados.categoria,
                preco: dados.preco,
                peso_inicial: dados.peso_inicial,
                peso_final: dados.peso_final,
                sacos_de_gelo: dados.sacos_de_gelo,
                caixa_papelao: dados.caixa_papelao,
                preco_venda: dados.preco_venda,
                // Tipos de insumo escolhidos: sem isto, o servidor usava o preço padrão
                // e a escolha do tipo não tinha efeito online.
                gelo_insumo_id: dados.gelo_insumo_id,
                papelao_insumo_id: dados.papelao_insumo_id,
                fita_insumo_id: dados.fita_insumo_id,
                embalagem_id: dados.embalagem_id,
                embalagem_qtd: dados.embalagem_qtd,
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
        const response = await fetch(`${API_BASE_URL}/calculos/meus?limite=${historicoLimite}`);
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
                    caixa_papelao: calculo.caixas_papelao,
                    // Tipos usados na época (para reabrir/duplicar já re-selecionando)
                    gelo_insumo_id: calculo.gelo_insumo_id,
                    papelao_insumo_id: calculo.papelao_insumo_id,
                    fita_insumo_id: calculo.fita_insumo_id,
                    embalagem_id: calculo.embalagem_id,
                    embalagem_qtd: calculo.embalagem_qtd
                },
                resultados: {
                    custo_sacos_gelo: calculo.custo_sacos_gelo,
                    custo_papelao: calculo.custo_papelao,
                    custo_fita_papelao: calculo.custo_fita_papelao,
                    custo_embalagem: calculo.custo_embalagem || 0,
                    diferenca_pesos: calculo.diferenca_pesos,
                    custo_producao: calculo.custo_producao,
                    custo_pos_beneficiamento: calculo.custo_pos_beneficiamento,
                    porcentagem: calculo.porcentagem_beneficiamento,
                    diferenca_valor: calculo.diferenca_valor,
                    custos_totais: calculo.custos_totais,
                    custo_final: calculo.custo_final
                }
            }));

            // Se veio a quantidade cheia do limite, provavelmente há mais no servidor
            historicoTemMais = (data.calculos.length >= historicoLimite);
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
    // Se for a aba de Insumos, recarrega o catálogo (pega alterações recentes)
    if (tabId === 'config') {
        carregarInsumos();
    }
    // Se for a aba de produtos, renderizar a lista
    if (tabId === 'produtos') {
        renderListaProdutos();
    }
    // Se for a aba de logs, buscar as ocorrencias no servidor
    if (tabId === 'logs') {
        carregarLogs();
    }
    // Se for a aba de usuarios, buscar a lista
    if (tabId === 'usuarios') {
        carregarUsuarios();
    }
}

// ---------------------------------------------------------------------------
// Aba de Usuários (só admin)
// ---------------------------------------------------------------------------
async function carregarUsuarios() {
    const lista = document.getElementById('listaUsuarios');
    if (!lista) return;
    lista.innerHTML = '<p class="logs-vazio">Carregando...</p>';
    try {
        const resp = await fetch(`${API_BASE_URL}/usuarios`);
        if (!resp.ok) throw new Error('Falha');
        const data = await resp.json();
        renderUsuarios(data.usuarios || []);
    } catch (e) {
        lista.innerHTML = '<p class="logs-vazio">Não foi possível carregar os usuários.</p>';
    }
}

function renderUsuarios(usuarios) {
    const lista = document.getElementById('listaUsuarios');
    if (!usuarios.length) {
        lista.innerHTML = '<p class="logs-vazio">Nenhum usuário cadastrado.</p>';
        return;
    }
    lista.innerHTML = usuarios.map(function (u) {
        const perms = (u.permissoes || '').split(',').map(s => s.trim());
        const marc = p => perms.includes(p) ? 'checked' : '';
        const semSenha = u.tem_senha ? '' : ' <span class="log-badge aviso">sem senha (não loga)</span>';
        // Status do 2FA + botão para o admin resetar (quando o usuário perde o app).
        const badge2fa = u.totp_confirmado
            ? '<span class="log-badge ok">2FA ativo</span>'
            : '<span class="log-badge aviso">2FA pendente</span>';
        const btnReset2fa = `<button type="button" class="btn-produto btn-excluir" onclick="resetar2FA(${u.id})" title="Resetar 2FA do usuário">
                   <i class="fas fa-shield-halved" aria-hidden="true"></i> Resetar 2FA
               </button>`;
        // Admin: acesso total (sem edição de abas aqui). Comum: escolhe as abas.
        const controles = (u.papel === 'admin')
            ? `<span class="log-badge erro">Admin — acesso total</span> ${badge2fa} ${btnReset2fa}${semSenha}`
            : `<label><input type="checkbox" class="uperm" value="history" ${marc('history')}> Histórico</label>
               <label><input type="checkbox" class="uperm" value="produtos" ${marc('produtos')}> Produtos e preços de insumo</label>
               <button type="button" class="btn-produto btn-salvar" onclick="salvarPermissoesUsuario(${u.id})">
                   <i class="fas fa-save" aria-hidden="true"></i> Salvar
               </button> ${badge2fa} ${btnReset2fa}${semSenha}`;
        return `
            <div class="usuario-item" data-id="${u.id}">
                <div class="usuario-info">
                    <span class="usuario-nome">${escaparHTML(u.nome || '-')}</span>
                    <span class="usuario-email">${escaparHTML(u.email || 'sem e-mail')}</span>
                </div>
                <div class="usuario-controles">${controles}</div>
            </div>`;
    }).join('');
}

async function criarUsuarioAdmin(event) {
    event.preventDefault();
    const nome = document.getElementById('novoUsuarioNome').value.trim();
    const email = document.getElementById('novoUsuarioEmail').value.trim();
    const senha = document.getElementById('novoUsuarioSenha').value;
    const papel = document.getElementById('novoUsuarioPapel').value;
    // Coleta as abas marcadas (só valem para usuário comum)
    const permissoes = Array.from(
        document.querySelectorAll('#formNovoUsuario .perm-check:checked')).map(c => c.value);
    try {
        const resp = await fetch(`${API_BASE_URL}/usuarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, email, senha, papel, permissoes })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || 'Falha ao criar usuário');
        document.getElementById('formNovoUsuario').reset();
        mostrarToast('Usuário criado com sucesso!', 'success');
        carregarUsuarios();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

// Salva as abas liberadas de um usuário comum (PUT). Vale no próximo login dele.
async function salvarPermissoesUsuario(id) {
    const row = document.querySelector(`.usuario-item[data-id="${id}"]`);
    if (!row) return;
    const permissoes = Array.from(row.querySelectorAll('.uperm:checked')).map(c => c.value);
    try {
        const resp = await fetch(`${API_BASE_URL}/usuarios/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissoes })
        });
        if (!resp.ok) throw new Error('Falha ao salvar');
        mostrarToast('Permissões salvas (valem no próximo login do usuário).', 'success');
    } catch (e) {
        mostrarToast('Não foi possível salvar as permissões.', 'error');
    }
}

// Reseta o 2FA de um usuário (só admin). No próximo login ele configura de novo.
async function resetar2FA(id) {
    if (!confirm('Resetar o 2FA deste usuário? No próximo login ele terá que configurar tudo de novo. Use quando a pessoa perdeu o app autenticador e os códigos de backup.')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/usuarios/${id}/reset-2fa`, { method: 'POST' });
        if (!resp.ok) throw new Error('Falha ao resetar 2FA');
        mostrarToast('2FA resetado. O usuário vai reconfigurar no próximo login.', 'success');
        carregarUsuarios();
    } catch (e) {
        mostrarToast('Não foi possível resetar o 2FA.', 'error');
    }
}

// Rotulos amigaveis e cor (classe CSS) para cada tipo de ocorrencia
const LOG_TIPOS = {
    login:           { texto: 'Login',           cor: 'ok'    },
    login_falha:     { texto: 'Login falhou',    cor: 'aviso' },
    login_bloqueado: { texto: 'Login bloqueado', cor: 'erro'  },
    acesso_negado:   { texto: 'Acesso negado',   cor: 'erro'  },
    config_alterada: { texto: 'Preço alterado',  cor: 'aviso' },
    historico_limpo: { texto: 'Histórico limpo', cor: 'aviso' },
    logs_limpos:     { texto: 'Logs limpos',     cor: 'aviso' },
    erro:            { texto: 'Erro',            cor: 'erro'  },
    calculo_salvo:   { texto: 'Cálculo salvo',   cor: 'ok'    },
    usuario_criado:  { texto: 'Usuário criado',  cor: 'ok'    }
};

// Busca os logs no servidor (respeitando filtro de tipo e datas) e renderiza a lista.
async function carregarLogs() {
    const lista = document.getElementById('listaLogs');
    if (!lista) return;
    const filtro = document.getElementById('logsFiltro')?.value || '';
    const de = document.getElementById('logsDe')?.value || '';
    const ate = document.getElementById('logsAte')?.value || '';
    lista.innerHTML = '<p class="logs-vazio">Carregando...</p>';
    try {
        // encodeURIComponent: escapa cada valor para montar a query string com seguranca
        let url = `${API_BASE_URL}/logs?limite=200`;
        if (filtro) url += `&acao=${encodeURIComponent(filtro)}`;
        if (de) url += `&de=${encodeURIComponent(de)}`;
        if (ate) url += `&ate=${encodeURIComponent(ate)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Falha ao carregar logs');
        const data = await resp.json();
        renderLogs(data.logs || []);
    } catch (e) {
        lista.innerHTML = '<p class="logs-vazio">Nao foi possivel carregar os logs.</p>';
    }
}

// Apaga logs com mais de 90 dias (retenção), com confirmação.
async function limparLogsAntigos() {
    if (!confirm('Apagar todos os logs com mais de 90 dias? Esta ação não pode ser desfeita.')) return;
    try {
        const resp = await fetch(`${API_BASE_URL}/logs/antigos?dias=90`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Falha');
        const data = await resp.json();
        mostrarToast(`${data.apagados || 0} log(s) antigo(s) apagado(s).`, 'success');
        carregarLogs();
    } catch (e) {
        mostrarToast('Não foi possível limpar os logs antigos.', 'error');
    }
}

// Escapa texto para evitar que um detalhe de log injete HTML (protecao contra XSS).
function escaparHTML(txt) {
    const div = document.createElement('div');
    div.textContent = txt == null ? '' : String(txt);
    return div.innerHTML;
}

function renderLogs(logs) {
    const lista = document.getElementById('listaLogs');
    if (!logs.length) {
        lista.innerHTML = '<p class="logs-vazio">Nenhuma ocorrencia registrada.</p>';
        return;
    }
    lista.innerHTML = logs.map(function (log) {
        const tipo = LOG_TIPOS[log.acao] || { texto: log.acao, cor: 'neutro' };
        // created_at vem do banco em UTC; toLocaleString formata para o fuso do navegador
        const quando = log.created_at ? new Date(log.created_at + 'Z').toLocaleString('pt-BR') : '';
        const quem = log.usuario_nome || (log.usuario_id ? `#${log.usuario_id}` : '-');
        return `
            <div class="log-item">
                <span class="log-badge ${tipo.cor}">${escaparHTML(tipo.texto)}</span>
                <div class="log-corpo">
                    <div class="log-detalhes">${escaparHTML(log.detalhes || '')}</div>
                    <div class="log-meta">${escaparHTML(quando)} &middot; ${escaparHTML(quem)}${log.ip_address ? ' &middot; ' + escaparHTML(log.ip_address) : ''}</div>
                </div>
            </div>`;
    }).join('');
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
// Mostra um resumo dos cálculos filtrados: quantidade, custo final somado e % média.
function renderResumoHistorico(lista) {
    const el = document.getElementById('historyResumo');
    if (!el) return;
    if (!lista.length) { el.hidden = true; return; }
    let custoTotal = 0, somaPct = 0, nPct = 0;
    lista.forEach(function (c) {
        const r = c.resultados || {};
        custoTotal += Number(r.custo_final) || 0;
        if (r.porcentagem != null && !isNaN(r.porcentagem)) { somaPct += Number(r.porcentagem); nPct++; }
    });
    const pctMedia = nPct ? (somaPct / nPct) : 0;
    const money = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    el.innerHTML =
        `<div class="resumo-card"><span class="resumo-num">${lista.length}</span><span class="resumo-rot">cálculo(s)</span></div>` +
        `<div class="resumo-card"><span class="resumo-num">${money(custoTotal)}</span><span class="resumo-rot">custo final somado</span></div>` +
        `<div class="resumo-card"><span class="resumo-num">${pctMedia.toFixed(1)}%</span><span class="resumo-rot">beneficiamento médio</span></div>`;
    el.hidden = false;
}

function atualizarHistorico() {
    const historyList = document.getElementById('historyList');
    const historyCount = document.getElementById('historyCount');
    
    // Atualizar contador (mostra o total, independente do filtro)
    historyCount.textContent = historicoCalculos.length;

    // Aplica os filtros ativos (produto, categoria, periodo)
    const lista = filtrarCalculos();

    // Resumo dos cálculos filtrados e botão "carregar mais"
    renderResumoHistorico(lista);
    const btnMais = document.getElementById('btnCarregarMais');
    if (btnMais) btnMais.hidden = !historicoTemMais;

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
                        <div class="history-summary-value">+${arredondar(resultados.diferenca_pesos)} kg</div>
                        <div class="history-summary-label">Ganho</div>
                    </div>
                    <div class="history-summary-item">
                        <div class="history-summary-value">R$ ${resultados.custo_pos_beneficiamento.toFixed(2)}</div>
                        <div class="history-summary-label">Custo/kg</div>
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

// Re-seleciona os selects de tipo de insumo e a embalagem a partir dos dados
// salvos, para reabrir/duplicar um cálculo já com as escolhas da época.
function preencherTiposInsumo(dados) {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null) el.value = String(val);
    };
    set('gelo_insumo_id', dados.gelo_insumo_id);
    set('papelao_insumo_id', dados.papelao_insumo_id);
    set('fita_insumo_id', dados.fita_insumo_id);
    set('calc_embalagem', dados.embalagem_id);
    set('calc_embalagem_qtd', dados.embalagem_qtd);
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
    preencherTiposInsumo(calculo.dados);

    // Mostra os resultados SALVOS (com os preços praticados na época), sem recalcular.
    // Antes recalculava com os preços atuais/padrão, o que mudava os números do passado.
    exibirResultados(calculo.dados, calculo.resultados);

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
    preencherTiposInsumo(calculo.dados);

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

async function limparHistorico() {
    if (historicoCalculos.length === 0) {
        mostrarToast('O histórico já está vazio!', 'warning');
        return;
    }
    if (!confirm('Tem certeza que deseja apagar TODOS os seus cálculos? Esta ação apaga do banco e não pode ser desfeita.')) {
        return;
    }
    try {
        // Apaga de verdade no servidor (antes só limpava a tela e voltava ao recarregar)
        const resp = await fetch(`${API_BASE_URL}/calculos/meus`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Falha ao apagar no servidor');
        const data = await resp.json();
        historicoCalculos = [];
        localStorage.removeItem('historicoCalculos');
        atualizarHistorico();
        mostrarToast(`Histórico apagado (${data.apagados || 0} cálculo(s)).`, 'success');
    } catch (e) {
        mostrarToast('Não foi possível apagar o histórico. Tente novamente.', 'error');
    }
}

// Busca mais cálculos do servidor (aumenta o limite e recarrega)
async function carregarMaisHistorico() {
    historicoLimite += 100;
    await carregarHistoricoAPI();
}

