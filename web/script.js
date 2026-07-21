// ---------------------------------------------------------------------------
// CONFIGURACAO DA API
// Um unico lugar para a URL do back-end. Em producao, TROQUE a linha abaixo
// pela URL real do seu deploy no Railway (ex.: https://seuapp.up.railway.app/api).
// ---------------------------------------------------------------------------
const PRODUCTION_API_URL = 'https://SEU-PROJETO-RAILWAY.railway.app/api'; // <-- TROCAR PELA URL REAL
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

    // Filtros do historico: re-renderiza a lista a cada mudanca
    ['filtroProduto', 'filtroCategoria', 'filtroDe', 'filtroAte'].forEach(id => {
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

// Validações
function aplicarValidacoes() {
    // Validação de peso final deve ser maior que inicial
    campos.peso_final.addEventListener('input', function() {
        const pesoInicial = parseFloat(campos.peso_inicial.value);
        const pesoFinal = parseFloat(this.value);
        
        if (pesoInicial && pesoFinal && pesoFinal <= pesoInicial) {
            mostrarErro(this, 'O peso final deve ser maior que o peso inicial');
        } else {
            limparErro(this);
        }
    });
    
    // Validação de preço positivo
    campos.preco.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (valor && valor <= 0) {
            mostrarErro(this, 'O preço deve ser maior que zero');
        } else {
            limparErro(this);
        }
    });
    
    // Validação de números positivos
    ['peso_inicial', 'peso_final', 'sacos_de_gelo', 'caixa_papelao'].forEach(campoId => {
        campos[campoId].addEventListener('input', function() {
            const valor = parseInt(this.value);
            if (valor && valor < 0) {
                mostrarErro(this, 'Este valor deve ser maior ou igual a zero');
            } else {
                limparErro(this);
            }
        });
    });
}

function validarCampo(event) {
    const campo = event.target;
    const valor = campo.value.trim();
    
    // Limpar erros anteriores
    limparErro(campo);
    
    // Validações básicas
    if (campo.hasAttribute('required') && !valor) {
        mostrarErro(campo, 'Este campo é obrigatório');
        return false;
    }
    
    if (campo.type === 'number' && valor && isNaN(valor)) {
        mostrarErro(campo, 'Digite um número válido');
        return false;
    }
    
    return true;
}

function mostrarErro(campo, mensagem) {
    limparErro(campo);
    
    const erroElement = document.createElement('div');
    erroElement.className = 'erro-validacao';
    erroElement.id = `${campo.id}-erro`;
    erroElement.setAttribute('role', 'alert');
    erroElement.textContent = mensagem;
    erroElement.style.cssText = `
        color: var(--error-color);
        font-size: 0.75rem;
        margin-top: 0.25rem;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    `;
    
    campo.style.borderColor = 'var(--error-color)';
    campo.setAttribute('aria-invalid', 'true');
    campo.setAttribute('aria-describedby', erroElement.id);
    campo.parentNode.appendChild(erroElement);
}

function limparErro(campo) {
    campo.style.borderColor = '';
    campo.removeAttribute('aria-invalid');
    campo.removeAttribute('aria-describedby');
    const erroExistente = campo.parentNode.querySelector('.erro-validacao');
    if (erroExistente) {
        erroExistente.remove();
    }
}

// Validação do formulário completo
function validarFormulario() {
    let valido = true;
    
    // Verificar todos os campos obrigatórios
    Object.values(campos).forEach(campo => {
        if (!validarCampo({ target: campo })) {
            valido = false;
        }
    });
    
    // Validações específicas
    const pesoInicial = parseFloat(campos.peso_inicial.value);
    const pesoFinal = parseFloat(campos.peso_final.value);
    
    if (pesoInicial && pesoFinal && pesoFinal <= pesoInicial) {
        mostrarErro(campos.peso_final, 'O peso final deve ser maior que o peso inicial');
        valido = false;
    }
    
    const preco = parseFloat(campos.preco.value);
    if (preco && preco <= 0) {
        mostrarErro(campos.preco, 'O preço deve ser maior que zero');
        valido = false;
    }
    
    return valido;
}

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

// Arredonda um numero para ate 'casas' decimais, SEM zeros a direita.
// Ex.: 7.439999999999998 -> 7.44   (resolve o "lixo" de ponto flutuante na tela).
// O toFixed arredonda e vira texto ("7.440"); o Number() tira os zeros a direita.
function arredondar(valor, casas = 3) {
    return Number(Number(valor).toFixed(casas));
}

function coletarDados() {
    return {
        produto: campos.produto.value,
        categoria: campos.categoria.value,
        preco: parseFloat(campos.preco.value),
        // pesos aceitam decimais (ex.: 127.78 kg) -> parseFloat, nao parseInt
        peso_inicial: parseFloat(campos.peso_inicial.value),
        peso_final: parseFloat(campos.peso_final.value),
        // sacos e caixas sao contagem de unidades inteiras -> parseInt
        sacos_de_gelo: parseInt(campos.sacos_de_gelo.value),
        caixa_papelao: parseInt(campos.caixa_papelao.value),
        // preco de venda e opcional: null quando o campo esta vazio
        preco_venda: document.getElementById('preco_venda').value
            ? parseFloat(document.getElementById('preco_venda').value)
            : null
    };
}

// FALLBACK OFFLINE apenas. A conta oficial vive no back-end (calculos.py) e e
// usada quando ha conexao. Esta copia em JS so roda quando a API esta indisponivel.
function calcularCustos(dados) {
    const {
        preco,
        peso_inicial,
        peso_final,
        sacos_de_gelo,
        caixa_papelao,
        preco_venda
    } = dados;
    
    // Cálculos básicos
    const custo_sacos_gelo = sacos_de_gelo * PRECOS.GELO;
    const custo_papelao = caixa_papelao * PRECOS.PAPELAO;
    const custo_fita_papelao = caixa_papelao * PRECOS.FITA;
    const diferenca_pesos = peso_final - peso_inicial;
    const custo_producao = peso_inicial * preco;
    const custo_pos_beneficiamento = custo_producao / peso_final;
    const porcentagem = ((peso_final / peso_inicial) * 100) - 100;
    const diferenca_valor = preco - custo_pos_beneficiamento;
    const custos_totais = custo_sacos_gelo + custo_papelao + custo_fita_papelao;
    const custo_final = custos_totais + (custo_pos_beneficiamento * peso_final);

    const resultado = {
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
    };

    // Margem de lucro (opcional), espelhando calculos.py
    if (preco_venda && preco_venda > 0) {
        const lucro_por_kg = preco_venda - custo_pos_beneficiamento;
        resultado.preco_venda = preco_venda;
        resultado.lucro_por_kg = lucro_por_kg;
        resultado.margem_percentual = (lucro_por_kg / preco_venda) * 100;
    }

    return resultado;
}

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
        observacoes: document.getElementById('perfil_observacoes').value.trim()
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

function exportarHistorico() {
    if (historicoCalculos.length === 0) {
        mostrarToast('Não há cálculos para exportar!', 'warning');
        return;
    }
    
    const dataAtual = new Date().toLocaleString('pt-BR');
    
    // Criar um elemento div temporário para o PDF
    const pdfContent = document.createElement('div');
    pdfContent.style.cssText = `
        width: 210mm;
        min-height: 297mm;
        padding: 20mm;
        font-family: Arial, sans-serif;
        background: white;
        color: black;
        box-sizing: border-box;
    `;
    
    pdfContent.innerHTML = `
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 28px;">🐟 Histórico de Cálculos</h1>
            <h2 style="color: #666; margin: 10px 0; font-size: 20px;">Beneficiamento de Pescados</h2>
            <p style="color: #888; margin: 5px 0; font-size: 14px;">Relatório gerado em: ${dataAtual}</p>
        </div>
        
        <div style="margin-bottom: 25px; background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb;">
            <h3 style="color: #2563eb; margin: 0 0 15px 0;">📊 Resumo Geral</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; background: white; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${historicoCalculos.length}</div>
                        <div style="font-size: 12px; color: #666;">Total de Cálculos</div>
                    </td>
                    <td style="padding: 10px; border: 1px solid #ddd; background: white; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${new Set(historicoCalculos.map(c => c.dados.produto)).size}</div>
                        <div style="font-size: 12px; color: #666;">Produtos Diferentes</div>
                    </td>
                    <td style="padding: 10px; border: 1px solid #ddd; background: white; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #2563eb;">R$ ${(historicoCalculos.reduce((acc, c) => acc + c.resultados.custo_final, 0) / historicoCalculos.length).toFixed(2)}</div>
                        <div style="font-size: 12px; color: #666;">Custo Médio</div>
                    </td>
                    <td style="padding: 10px; border: 1px solid #ddd; background: white; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${(historicoCalculos.reduce((acc, c) => acc + c.resultados.porcentagem, 0) / historicoCalculos.length).toFixed(1)}%</div>
                        <div style="font-size: 12px; color: #666;">Beneficiamento Médio</div>
                    </td>
                </tr>
            </table>
        </div>

        <div style="margin-bottom: 25px;">
            <h3 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">📋 Cálculos Realizados</h3>
            ${historicoCalculos.map((calculo, index) => {
                const data = new Date(calculo.timestamp);
                const dataFormatada = data.toLocaleString('pt-BR');
                return `
                <div style="background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <h4 style="font-size: 18px; font-weight: bold; color: #1f2937; margin: 0;">${calculo.dados.produto}</h4>
                            <span style="background: #2563eb; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-top: 5px; display: inline-block;">${calculo.dados.categoria}</span>
                        </div>
                        <div style="font-size: 12px; color: #666;">${dataFormatada}</div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px; border: 1px solid #ddd; background: white; text-align: center; width: 25%;">
                                <div style="font-size: 16px; font-weight: bold; color: #1f2937;">${calculo.resultados.porcentagem.toFixed(1)}%</div>
                                <div style="font-size: 11px; color: #666; text-transform: uppercase;">Beneficiamento</div>
                            </td>
                            <td style="padding: 8px; border: 1px solid #ddd; background: white; text-align: center; width: 25%;">
                                <div style="font-size: 16px; font-weight: bold; color: #1f2937;">+${arredondar(calculo.resultados.diferenca_pesos)} Kg</div>
                                <div style="font-size: 11px; color: #666; text-transform: uppercase;">Ganho</div>
                            </td>
                            <td style="padding: 8px; border: 1px solid #ddd; background: white; text-align: center; width: 25%;">
                                <div style="font-size: 16px; font-weight: bold; color: #1f2937;">R$ ${calculo.resultados.custo_pos_beneficiamento.toFixed(2)}</div>
                                <div style="font-size: 11px; color: #666; text-transform: uppercase;">Custo/Kg</div>
                            </td>
                            <td style="padding: 8px; border: 1px solid #ddd; background: white; text-align: center; width: 25%;">
                                <div style="font-size: 16px; font-weight: bold; color: #1f2937;">R$ ${calculo.resultados.custo_final.toFixed(2)}</div>
                                <div style="font-size: 11px; color: #666; text-transform: uppercase;">Total</div>
                            </td>
                        </tr>
                    </table>
                </div>
                `;
            }).join('')}
        </div>

        <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 12px;">
            <p><strong>Calculadora de Custos - Beneficiamento de Pescados</strong></p>
            <p>Histórico exportado automaticamente em ${dataAtual}</p>
        </div>
    `;
    
    // Adicionar o conteúdo temporariamente ao body
    document.body.appendChild(pdfContent);
    
    // Aguardar renderização e tentar gerar PDF
    setTimeout(() => {
        try {
            // Verificar se html2pdf está disponível
            if (typeof html2pdf !== 'undefined') {
                console.log('Tentando gerar PDF do histórico com html2pdf...');
                
                // Configurações otimizadas para html2pdf
                const opt = {
                    margin: [10, 10, 10, 10],
                    filename: `historico-beneficiamento-${new Date().toISOString().split('T')[0]}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        logging: false,
                        width: 794,
                        height: 1123,
                        scrollX: 0,
                        scrollY: 0
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait',
                        compress: false
                    }
                };
                
                html2pdf().set(opt).from(pdfContent).save().then(() => {
                    console.log('PDF do histórico gerado com sucesso!');
                    document.body.removeChild(pdfContent);
                    mostrarToast('Histórico PDF exportado com sucesso!', 'success');
                }).catch((error) => {
                    console.error('Erro ao gerar PDF do histórico:', error);
                    document.body.removeChild(pdfContent);
                    // Tentar método alternativo com jsPDF
                    gerarPDFHistoricoAlternativo(historicoCalculos, dataAtual);
                });
            } else {
                console.log('html2pdf não disponível, usando impressão...');
                document.body.removeChild(pdfContent);
                abrirHistoricoParaImpressao(historicoCalculos, dataAtual);
            }
        } catch (error) {
            console.error('Erro geral ao gerar PDF do histórico:', error);
            document.body.removeChild(pdfContent);
            abrirHistoricoParaImpressao(historicoCalculos, dataAtual);
        }
    }, 1000);
}

// Função de fallback para impressão do histórico
function abrirHistoricoParaImpressao(historicoCalculos, dataAtual) {
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Histórico - Cálculos de Beneficiamento</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: black; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px; }
            .section { margin-bottom: 25px; }
            h1 { color: #2563eb; margin: 0; font-size: 28px; }
            h2 { color: #2563eb; margin: 0; font-size: 20px; }
            h3 { color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
            th { background: #2563eb; color: white; font-weight: bold; }
            .calculation-item { background: #f8f9fa; border: 1px solid #e5e7eb; padding: 15px; margin-bottom: 15px; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🐟 Histórico de Cálculos</h1>
            <h2>Beneficiamento de Pescados</h2>
            <p>Relatório gerado em: ${dataAtual}</p>
        </div>
        
        <div class="section">
            <h3>📊 Resumo Geral</h3>
            <table>
                <tr>
                    <th>Total de Cálculos</th>
                    <th>Produtos Diferentes</th>
                    <th>Custo Médio</th>
                    <th>Beneficiamento Médio</th>
                </tr>
                <tr>
                    <td style="text-align: center; font-size: 18px; font-weight: bold;">${historicoCalculos.length}</td>
                    <td style="text-align: center; font-size: 18px; font-weight: bold;">${new Set(historicoCalculos.map(c => c.dados.produto)).size}</td>
                    <td style="text-align: center; font-size: 18px; font-weight: bold;">R$ ${(historicoCalculos.reduce((acc, c) => acc + c.resultados.custo_final, 0) / historicoCalculos.length).toFixed(2)}</td>
                    <td style="text-align: center; font-size: 18px; font-weight: bold;">${(historicoCalculos.reduce((acc, c) => acc + c.resultados.porcentagem, 0) / historicoCalculos.length).toFixed(1)}%</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h3>📋 Cálculos Realizados</h3>
            ${historicoCalculos.map(calculo => {
                const data = new Date(calculo.timestamp);
                const dataFormatada = data.toLocaleString('pt-BR');
                return `
                <div class="calculation-item">
                    <h4 style="margin: 0 0 10px 0; color: #2563eb;">${calculo.dados.produto} - ${calculo.dados.categoria}</h4>
                    <p style="margin: 0 0 10px 0; color: #666; font-size: 12px;">${dataFormatada}</p>
                    <table>
                        <tr>
                            <th>Beneficiamento</th>
                            <th>Ganho de Peso</th>
                            <th>Custo/Kg</th>
                            <th>Custo Total</th>
                        </tr>
                        <tr>
                            <td style="text-align: center;">${calculo.resultados.porcentagem.toFixed(1)}%</td>
                            <td style="text-align: center;">+${arredondar(calculo.resultados.diferenca_pesos)} Kg</td>
                            <td style="text-align: center;">R$ ${calculo.resultados.custo_pos_beneficiamento.toFixed(2)}</td>
                            <td style="text-align: center;">R$ ${calculo.resultados.custo_final.toFixed(2)}</td>
                        </tr>
                    </table>
                </div>
                `;
            }).join('')}
        </div>

        <div class="footer">
            <p><strong>Calculadora de Custos - Beneficiamento de Pescados</strong></p>
            <p>Histórico exportado automaticamente em ${dataAtual}</p>
        </div>
    </body>
    </html>
    `;
    
    const newWindow = window.open('', '_blank');
    newWindow.document.write(htmlContent);
    newWindow.document.close();
    newWindow.focus();
    
    setTimeout(() => {
        newWindow.print();
    }, 500);
    
    mostrarToast('Histórico aberto para impressão!', 'success');
}

// Exportação de resultados em PDF
function exportarResultado() {
    const dados = coletarDados();
    const resultados = calcularCustos(dados);
    
    const dataAtual = new Date().toLocaleString('pt-BR');
    const dataFormatada = new Date().toLocaleDateString('pt-BR');
    
    // Criar um elemento div temporário para o PDF
    const pdfContent = document.createElement('div');
    pdfContent.style.cssText = `
        width: 210mm;
        min-height: 297mm;
        padding: 20mm;
        font-family: Arial, sans-serif;
        background: white;
        color: black;
        box-sizing: border-box;
    `;
    
    pdfContent.innerHTML = `
        <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 28px;">🐟 Calculadora de Custos</h1>
            <h2 style="color: #666; margin: 10px 0; font-size: 20px;">Beneficiamento de Pescados</h2>
            <p style="color: #888; margin: 5px 0; font-size: 14px;">Relatório gerado em: ${dataAtual}</p>
        </div>
        
        <div style="margin-bottom: 25px;">
            <h3 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">📋 Informações da Produção</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold; width: 30%;">Produto:</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${dados.produto}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">Categoria:</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${dados.categoria}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">Data:</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${dataFormatada}</td>
                </tr>
            </table>
        </div>

        <div style="margin-bottom: 25px;">
            <h3 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">📊 Resultados Principais</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr style="background: #e8f4fd;">
                    <td style="padding: 12px; border: 2px solid #2563eb; text-align: center; font-weight: bold; font-size: 18px; color: #2563eb;">
                        Beneficiamento: ${resultados.porcentagem.toFixed(1)}%
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: center; font-size: 16px;">
                        Ganho de peso: +${arredondar(resultados.diferenca_pesos)} Kg (de ${dados.peso_inicial} para ${dados.peso_final} Kg)
                    </td>
                </tr>
            </table>
        </div>

        <div style="margin-bottom: 25px;">
            <h3 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">💰 Detalhamento dos Custos</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background: #2563eb; color: white;">
                        <th style="padding: 12px; border: 1px solid #ddd; text-align: left;">Item</th>
                        <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Quantidade</th>
                        <th style="padding: 12px; border: 1px solid #ddd; text-align: right;">Valor Unitário</th>
                        <th style="padding: 12px; border: 1px solid #ddd; text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;">Peso Inicial</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${dados.peso_inicial} Kg</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${dados.preco.toFixed(2)}</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${(dados.peso_inicial * dados.preco).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;">Sacos de Gelo</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${dados.sacos_de_gelo} un.</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ 8,50</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${resultados.custo_sacos_gelo.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;">Caixas de Papelão</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${dados.caixa_papelao} un.</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ 7,30</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${resultados.custo_papelao.toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;">Fitas Durex</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${dados.caixa_papelao} un.</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ 0,34</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${resultados.custo_fita_papelao.toFixed(2)}</td>
                    </tr>
                    <tr style="background: #f8f9fa; font-weight: bold;">
                        <td style="padding: 10px; border: 1px solid #ddd;" colspan="3">Subtotal Custos Extras</td>
                        <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">R$ ${resultados.custos_totais.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div style="margin-bottom: 25px;">
            <h3 style="color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px;">📈 Análise Financeira</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold; width: 40%;">Peso Final:</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${dados.peso_final} Kg</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">Preço Inicial por Kg:</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">R$ ${dados.preco.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">Custo Pós-Beneficiamento por Kg:</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">R$ ${resultados.custo_pos_beneficiamento.toFixed(2)}</td>
                </tr>
                <tr style="background: #e8f5e8;">
                    <td style="padding: 10px; border: 1px solid #ddd; background: #d4edda; font-weight: bold;">Custo Total Final:</td>
                    <td style="padding: 10px; border: 1px solid #ddd; background: #d4edda; font-weight: bold; font-size: 16px;">R$ ${resultados.custo_final.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">Diferença de Valor por Kg:</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">R$ ${resultados.diferenca_valor.toFixed(2)}</td>
                </tr>
            </table>
        </div>

        <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 12px;">
            <p><strong>Calculadora de Custos - Beneficiamento de Pescados</strong></p>
            <p>Relatório gerado automaticamente em ${dataAtual}</p>
        </div>
    `;
    
    // Adicionar o conteúdo temporariamente ao body
    document.body.appendChild(pdfContent);
    
    // Aguardar renderização e tentar gerar PDF
    setTimeout(() => {
        try {
            // Verificar se html2pdf está disponível
            if (typeof html2pdf !== 'undefined') {
                console.log('Tentando gerar PDF com html2pdf...');
                
                // Configurações otimizadas para html2pdf
                const opt = {
                    margin: [10, 10, 10, 10],
                    filename: `calculo-beneficiamento-${dados.produto.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { 
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        logging: false,
                        width: 794,
                        height: 1123,
                        scrollX: 0,
                        scrollY: 0
                    },
                    jsPDF: { 
                        unit: 'mm', 
                        format: 'a4', 
                        orientation: 'portrait',
                        compress: false
                    }
                };
                
                html2pdf().set(opt).from(pdfContent).save().then(() => {
                    console.log('PDF gerado com sucesso!');
                    document.body.removeChild(pdfContent);
                    mostrarToast('Relatório PDF exportado com sucesso!', 'success');
                }).catch((error) => {
                    console.error('Erro ao gerar PDF com html2pdf:', error);
                    document.body.removeChild(pdfContent);
                    // Tentar método alternativo com jsPDF
                    gerarPDFAlternativo(dados, resultados, dataAtual, dataFormatada);
                });
            } else {
                console.log('html2pdf não disponível, usando impressão...');
                document.body.removeChild(pdfContent);
                abrirParaImpressao(dados, resultados, dataAtual, dataFormatada);
            }
        } catch (error) {
            console.error('Erro geral ao gerar PDF:', error);
            document.body.removeChild(pdfContent);
            abrirParaImpressao(dados, resultados, dataAtual, dataFormatada);
        }
    }, 1000);
}

// Função de fallback para impressão
function abrirParaImpressao(dados, resultados, dataAtual, dataFormatada) {
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>Relatório - Cálculo de Beneficiamento</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: black; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px; }
            .section { margin-bottom: 25px; }
            h1 { color: #2563eb; margin: 0; font-size: 28px; }
            h2 { color: #2563eb; margin: 0; font-size: 20px; }
            h3 { color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
            th { background: #2563eb; color: white; font-weight: bold; }
            .highlight { background: #e8f4fd; padding: 12px; border: 2px solid #2563eb; text-align: center; font-weight: bold; font-size: 18px; color: #2563eb; margin: 20px 0; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; text-align: center; color: #666; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🐟 Calculadora de Custos</h1>
            <h2>Beneficiamento de Pescados</h2>
            <p>Relatório gerado em: ${dataAtual}</p>
        </div>
        
        <div class="section">
            <h3>📋 Informações da Produção</h3>
            <table>
                <tr><td><strong>Produto:</strong></td><td>${dados.produto}</td></tr>
                <tr><td><strong>Categoria:</strong></td><td>${dados.categoria}</td></tr>
                <tr><td><strong>Data:</strong></td><td>${dataFormatada}</td></tr>
            </table>
        </div>

        <div class="section">
            <h3>📊 Resultados Principais</h3>
            <div class="highlight">
                Beneficiamento: ${resultados.porcentagem.toFixed(1)}%<br>
                Ganho de peso: +${arredondar(resultados.diferenca_pesos)} Kg (de ${dados.peso_inicial} para ${dados.peso_final} Kg)
            </div>
        </div>

        <div class="section">
            <h3>💰 Detalhamento dos Custos</h3>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Quantidade</th>
                        <th>Valor Unitário</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Peso Inicial</td><td>${dados.peso_inicial} Kg</td><td>R$ ${dados.preco.toFixed(2)}</td><td>R$ ${(dados.peso_inicial * dados.preco).toFixed(2)}</td></tr>
                    <tr><td>Sacos de Gelo</td><td>${dados.sacos_de_gelo} un.</td><td>R$ 8,50</td><td>R$ ${resultados.custo_sacos_gelo.toFixed(2)}</td></tr>
                    <tr><td>Caixas de Papelão</td><td>${dados.caixa_papelao} un.</td><td>R$ 7,30</td><td>R$ ${resultados.custo_papelao.toFixed(2)}</td></tr>
                    <tr><td>Fitas Durex</td><td>${dados.caixa_papelao} un.</td><td>R$ 0,34</td><td>R$ ${resultados.custo_fita_papelao.toFixed(2)}</td></tr>
                    <tr style="background: #f8f9fa; font-weight: bold;"><td colspan="3">Subtotal Custos Extras</td><td>R$ ${resultados.custos_totais.toFixed(2)}</td></tr>
                </tbody>
            </table>
        </div>

        <div class="section">
            <h3>📈 Análise Financeira</h3>
            <table>
                <tr><td><strong>Peso Final:</strong></td><td>${dados.peso_final} Kg</td></tr>
                <tr><td><strong>Preço Inicial por Kg:</strong></td><td>R$ ${dados.preco.toFixed(2)}</td></tr>
                <tr><td><strong>Custo Pós-Beneficiamento por Kg:</strong></td><td>R$ ${resultados.custo_pos_beneficiamento.toFixed(2)}</td></tr>
                <tr style="background: #e8f5e8; font-weight: bold;"><td><strong>Custo Total Final:</strong></td><td style="font-size: 16px;">R$ ${resultados.custo_final.toFixed(2)}</td></tr>
                <tr><td><strong>Diferença de Valor por Kg:</strong></td><td>R$ ${resultados.diferenca_valor.toFixed(2)}</td></tr>
            </table>
        </div>

        <div class="footer">
            <p><strong>Calculadora de Custos - Beneficiamento de Pescados</strong></p>
            <p>Relatório gerado automaticamente em ${dataAtual}</p>
        </div>
    </body>
    </html>
    `;
    
    const newWindow = window.open('', '_blank');
    newWindow.document.write(htmlContent);
    newWindow.document.close();
    newWindow.focus();
    
    setTimeout(() => {
        newWindow.print();
    }, 500);
    
    mostrarToast('Relatório aberto para impressão!', 'success');
}

// Melhorias de acessibilidade
document.addEventListener('keydown', function(e) {
    // Enter em campos de input
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll('input, select'));
        const currentIndex = inputs.indexOf(e.target);
        const nextInput = inputs[currentIndex + 1];
        
        if (nextInput) {
            nextInput.focus();
        } else {
            form.dispatchEvent(new Event('submit'));
        }
    }
});

// Adicionar estilos CSS dinâmicos para elementos adicionais
const style = document.createElement('style');
style.textContent = `
    .result-info {
        background: linear-gradient(135deg, var(--bg-primary), #f1f5f9);
        border-radius: var(--radius-lg);
        padding: 1.5rem;
        margin-bottom: 2rem;
        border: 1px solid var(--border-light);
    }
    
    .result-header-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
    }
    
    .result-product {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
    }
    
    .result-product i {
        color: var(--primary-color);
    }
    
    .result-category {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border-radius: var(--radius-md);
        font-weight: 500;
        font-size: 0.875rem;
    }
    
    .result-category.success {
        background: rgba(16, 185, 129, 0.1);
        color: var(--success-color);
        border: 1px solid rgba(16, 185, 129, 0.2);
    }
    
    .result-category.warning {
        background: rgba(245, 158, 11, 0.1);
        color: var(--warning-color);
        border: 1px solid rgba(245, 158, 11, 0.2);
    }
    
    .result-actions {
        display: flex;
        gap: 1rem;
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid var(--border-light);
    }
    
    .action-btn {
        flex: 1;
        padding: 0.875rem 1.5rem;
        border-radius: var(--radius-md);
        font-weight: 600;
        cursor: pointer;
        transition: var(--transition);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        border: 2px solid transparent;
    }
    
    .action-btn.primary {
        background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
        color: white;
    }
    
    .action-btn.primary:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-lg);
    }
    
    .action-btn.secondary {
        background: var(--bg-secondary);
        color: var(--text-primary);
        border-color: var(--border-color);
    }
    
    .action-btn.secondary:hover {
        background: var(--bg-primary);
        border-color: var(--primary-color);
    }
    
    @media (max-width: 768px) {
        .result-header-info {
            flex-direction: column;
            align-items: flex-start;
        }
        
        .result-actions {
            flex-direction: column;
        }
    }
`;
document.head.appendChild(style);

// Função alternativa para gerar PDF usando jsPDF diretamente
function gerarPDFAlternativo(dados, resultados, dataAtual, dataFormatada) {
    try {
        if (typeof window.jspdf !== 'undefined') {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Configurar fonte e tamanho
            doc.setFont('helvetica');
            doc.setFontSize(16);
            
            // Título
            doc.text('🐟 Calculadora de Custos', 20, 20);
            doc.setFontSize(12);
            doc.text('Beneficiamento de Pescados', 20, 30);
            doc.text(`Relatório gerado em: ${dataAtual}`, 20, 40);
            
            // Linha separadora
            doc.line(20, 45, 190, 45);
            
            // Informações da produção
            doc.setFontSize(14);
            doc.text('📋 Informações da Produção', 20, 55);
            doc.setFontSize(10);
            doc.text(`Produto: ${dados.produto}`, 20, 65);
            doc.text(`Categoria: ${dados.categoria}`, 20, 72);
            doc.text(`Data: ${dataFormatada}`, 20, 79);
            
            // Resultados principais
            doc.setFontSize(14);
            doc.text('📊 Resultados Principais', 20, 95);
            doc.setFontSize(12);
            doc.text(`Beneficiamento: ${resultados.porcentagem.toFixed(1)}%`, 20, 105);
            doc.text(`Ganho de peso: +${arredondar(resultados.diferenca_pesos)} Kg`, 20, 115);
            doc.text(`(de ${dados.peso_inicial} para ${dados.peso_final} Kg)`, 20, 122);
            
            // Custos
            doc.setFontSize(14);
            doc.text('💰 Detalhamento dos Custos', 20, 135);
            doc.setFontSize(10);
            doc.text(`Peso Inicial: ${dados.peso_inicial} Kg × R$ ${dados.preco.toFixed(2)} = R$ ${(dados.peso_inicial * dados.preco).toFixed(2)}`, 20, 145);
            doc.text(`Sacos de Gelo: ${dados.sacos_de_gelo} un. × R$ 8,50 = R$ ${resultados.custo_sacos_gelo.toFixed(2)}`, 20, 152);
            doc.text(`Caixas de Papelão: ${dados.caixa_papelao} un. × R$ 7,30 = R$ ${resultados.custo_papelao.toFixed(2)}`, 20, 159);
            doc.text(`Fitas Durex: ${dados.caixa_papelao} un. × R$ 0,34 = R$ ${resultados.custo_fita_papelao.toFixed(2)}`, 20, 166);
            
            // Análise financeira
            doc.setFontSize(14);
            doc.text('📈 Análise Financeira', 20, 180);
            doc.setFontSize(12);
            doc.text(`Peso Final: ${dados.peso_final} Kg`, 20, 190);
            doc.text(`Custo Pós-Beneficiamento por Kg: R$ ${resultados.custo_pos_beneficiamento.toFixed(2)}`, 20, 200);
            doc.setFontSize(14);
            doc.text(`Custo Total Final: R$ ${resultados.custo_final.toFixed(2)}`, 20, 210);
            doc.text(`Diferença de Valor por Kg: R$ ${resultados.diferenca_valor.toFixed(2)}`, 20, 220);
            
            // Rodapé
            doc.setFontSize(8);
            doc.text('Calculadora de Custos - Beneficiamento de Pescados', 20, 280);
            doc.text(`Relatório gerado automaticamente em ${dataAtual}`, 20, 287);
            
            // Salvar o PDF
            const filename = `calculo-beneficiamento-${dados.produto.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(filename);
            mostrarToast('Relatório PDF exportado com sucesso!', 'success');
        } else {
            console.log('jsPDF não disponível, usando impressão...');
            abrirParaImpressao(dados, resultados, dataAtual, dataFormatada);
        }
    } catch (error) {
        console.error('Erro ao gerar PDF alternativo:', error);
        abrirParaImpressao(dados, resultados, dataAtual, dataFormatada);
    }
}

// Função alternativa para gerar PDF do histórico usando jsPDF diretamente
function gerarPDFHistoricoAlternativo(historicoCalculos, dataAtual) {
    try {
        if (typeof window.jspdf !== 'undefined') {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Configurar fonte e tamanho
            doc.setFont('helvetica');
            doc.setFontSize(16);
            
            // Título
            doc.text('🐟 Histórico de Cálculos', 20, 20);
            doc.setFontSize(12);
            doc.text('Beneficiamento de Pescados', 20, 30);
            doc.text(`Relatório gerado em: ${dataAtual}`, 20, 40);
            
            // Linha separadora
            doc.line(20, 45, 190, 45);
            
            // Resumo geral
            doc.setFontSize(14);
            doc.text('📊 Resumo Geral', 20, 55);
            doc.setFontSize(10);
            doc.text(`Total de Cálculos: ${historicoCalculos.length}`, 20, 65);
            doc.text(`Produtos Diferentes: ${new Set(historicoCalculos.map(c => c.dados.produto)).size}`, 20, 72);
            doc.text(`Custo Médio: R$ ${(historicoCalculos.reduce((acc, c) => acc + c.resultados.custo_final, 0) / historicoCalculos.length).toFixed(2)}`, 20, 79);
            doc.text(`Beneficiamento Médio: ${(historicoCalculos.reduce((acc, c) => acc + c.resultados.porcentagem, 0) / historicoCalculos.length).toFixed(1)}%`, 20, 86);
            
            // Cálculos realizados
            doc.setFontSize(14);
            doc.text('📋 Cálculos Realizados', 20, 100);
            
            let yPosition = 110;
            historicoCalculos.forEach((calculo, index) => {
                if (yPosition > 270) {
                    doc.addPage();
                    yPosition = 20;
                }
                
                const data = new Date(calculo.timestamp);
                const dataFormatada = data.toLocaleString('pt-BR');
                
                doc.setFontSize(12);
                doc.text(`${index + 1}. ${calculo.dados.produto} (${calculo.dados.categoria})`, 20, yPosition);
                doc.setFontSize(8);
                doc.text(`Data: ${dataFormatada}`, 20, yPosition + 8);
                doc.text(`Beneficiamento: ${calculo.resultados.porcentagem.toFixed(1)}% | Ganho: +${arredondar(calculo.resultados.diferenca_pesos)} Kg`, 20, yPosition + 15);
                doc.text(`Custo/Kg: R$ ${calculo.resultados.custo_pos_beneficiamento.toFixed(2)} | Total: R$ ${calculo.resultados.custo_final.toFixed(2)}`, 20, yPosition + 22);
                
                yPosition += 35;
            });
            
            // Rodapé
            doc.setFontSize(8);
            doc.text('Calculadora de Custos - Beneficiamento de Pescados', 20, 280);
            doc.text(`Histórico exportado automaticamente em ${dataAtual}`, 20, 287);
            
            // Salvar o PDF
            const filename = `historico-beneficiamento-${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(filename);
            mostrarToast('Histórico PDF exportado com sucesso!', 'success');
        } else {
            console.log('jsPDF não disponível, usando impressão...');
            abrirHistoricoParaImpressao(historicoCalculos, dataAtual);
        }
    } catch (error) {
        console.error('Erro ao gerar PDF do histórico alternativo:', error);
        abrirHistoricoParaImpressao(historicoCalculos, dataAtual);
    }
}