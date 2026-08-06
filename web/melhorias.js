// IIFE: isola o escopo deste arquivo. So a API abaixo (window.*) e publica.
(function () {
// ===========================================================================
// MELHORIAS DE UX DOS FILTROS DO HISTORICO
// ---------------------------------------------------------------------------
// Este arquivo NAO substitui nada do script.js. Ele adiciona comportamentos
// novos (debounce, presets de data, chips de filtro ativo e contador) e
// conversa com o codigo existente por dois pontos combinados:
//
//   - o script.js chama atualizarUIFiltros(qtd) dentro de atualizarHistorico;
//   - os presets/chips escrevem no .value dos inputs e disparam 'input',
//     que e o mesmo evento que os filtros ja escutam (reaproveitamento).
//
// Reaproveita pad2() e lerISO() que ja foram definidos em datepicker.js.
// ===========================================================================


// ---------------------------------------------------------------------------
// debounce(fn, ms): devolve uma NOVA funcao que so executa 'fn' depois que o
// usuario para de chamar por 'ms' milissegundos.
// Conceito: closure. A variavel 'timer' fica "lembrada" entre as chamadas
// porque a funcao interna a captura. A cada tecla, cancelamos o timer anterior
// (clearTimeout) e marcamos um novo. So o ultimo sobrevive -> roda 1 vez.
// ---------------------------------------------------------------------------
function debounce(fn, ms) {
    let timer; // "lembrada" pela closure entre as chamadas
    return function (...args) {
        clearTimeout(timer);                     // cancela o agendamento anterior
        timer = setTimeout(() => fn.apply(this, args), ms); // agenda o novo
    };
}


// ---------------------------------------------------------------------------
// Helpers de data
// ---------------------------------------------------------------------------

// Converte um objeto Date para "YYYY-MM-DD" usando a data LOCAL (nao UTC).
// Importante: NAO usar toISOString() aqui, porque ele converte pra UTC e pode
// "voltar um dia" dependendo do fuso. Montamos a string na mao.
function isoLocal(data) {
    return data.getFullYear() + '-' + pad2(data.getMonth() + 1) + '-' + pad2(data.getDate());
}

// "2034-07-15" -> "15/07/2034" para exibir nos chips (reusa lerISO).
function formatarDataBR(iso) {
    const o = lerISO(iso);
    return o ? pad2(o.dia) + '/' + pad2(o.mes + 1) + '/' + o.ano : '';
}

// Atalho: pega o .value de um input pelo id (ou '' se nao existir).
function valorDe(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

// Escreve um valor num input de filtro e AVISA o resto do sistema.
// O dispatch de 'input' faz o atualizarHistorico rodar, exatamente como
// quando o usuario mexe no campo na mao.
function setFiltro(id, valor) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}


// ---------------------------------------------------------------------------
// PRESETS DE PERIODO: Hoje / 7 dias / Este mes
// Preenche filtroDe e filtroAte de uma vez.
// ---------------------------------------------------------------------------
function aplicarPreset(preset) {
    const hoje = new Date();
    let de, ate = hoje;

    if (preset === 'hoje') {
        de = hoje;
    } else if (preset === '7dias') {
        de = new Date();
        de.setDate(hoje.getDate() - 6); // hoje + 6 dias anteriores = 7 dias no total
    } else if (preset === 'mes') {
        de = new Date(hoje.getFullYear(), hoje.getMonth(), 1); // dia 1 do mes atual
    } else {
        return;
    }

    // Escreve nos dois campos. So o ultimo dispatch precisa re-renderizar, mas
    // disparar os dois e simples e inofensivo.
    setFiltro('filtroDe', isoLocal(de));
    setFiltro('filtroAte', isoLocal(ate));
}


// ---------------------------------------------------------------------------
// atualizarUIFiltros(qtdResultados): chamada pelo script.js a cada filtragem.
// Faz 3 coisas: monta os chips de filtro ativo, escreve o contador de
// resultados e habilita/desabilita o botao "Limpar".
// ---------------------------------------------------------------------------
function atualizarUIFiltros(qtdResultados) {
    // Descreve cada filtro: id do input, rotulo curto e valor de exibicao.
    const definicoes = [
        { id: 'filtroProduto',   rotulo: 'Produto',   exibir: valorDe('filtroProduto') },
        { id: 'filtroCategoria', rotulo: 'Categoria', exibir: valorDe('filtroCategoria') },
        { id: 'filtroDe',        rotulo: 'De',        exibir: formatarDataBR(valorDe('filtroDe')) },
        { id: 'filtroAte',       rotulo: 'Até',       exibir: formatarDataBR(valorDe('filtroAte')) },
    ];
    // "Ativo" = o input tem algum valor. Um filtro vazio nao vira chip.
    const ativos = definicoes.filter(f => valorDe(f.id) !== '');

    // ---- Chips ----
    const container = document.getElementById('filtrosAtivos');
    if (container) {
        // Monta o HTML dos chips. O botao × leva o id do filtro no data-limpa.
        container.innerHTML = ativos.map(f => `
            <span class="chip">
                <span class="chip-texto">${f.rotulo}: ${f.exibir}</span>
                <button type="button" class="chip-x" data-limpa="${f.id}"
                        aria-label="Remover filtro ${f.rotulo}">&times;</button>
            </span>
        `).join('');

        // Liga cada × para limpar SO aquele filtro (e nao todos).
        container.querySelectorAll('.chip-x').forEach(botao => {
            botao.addEventListener('click', () => setFiltro(botao.dataset.limpa, ''));
        });
    }

    // ---- Contador de resultados ----
    // historicoCalculos e uma variavel global do script.js (total salvo).
    const info = document.getElementById('historyResultsInfo');
    if (info) {
        const total = (typeof historicoCalculos !== 'undefined') ? historicoCalculos.length : qtdResultados;
        // So mostra o texto quando ha filtro ativo; sem filtro, fica limpo.
        info.textContent = ativos.length
            ? `${qtdResultados} de ${total} resultado(s)`
            : '';
    }

    // ---- Botao Limpar: so habilitado quando ha filtro ----
    const btnLimpar = document.getElementById('btnLimparFiltros');
    if (btnLimpar) btnLimpar.disabled = ativos.length === 0;
}


// ---------------------------------------------------------------------------
// INICIALIZACAO: liga os botoes de preset e deixa a UI num estado coerente.
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    // Presets de periodo (delegacao simples: um listener por botao).
    document.querySelectorAll('.preset-btn').forEach(botao => {
        botao.addEventListener('click', () => aplicarPreset(botao.dataset.preset));
    });

    // Estado inicial dos chips/contador/botao (nenhum filtro ativo ainda).
    atualizarUIFiltros(0);
});

// --- API publica (usada por script.js) ---
window.debounce = debounce;
window.atualizarUIFiltros = atualizarUIFiltros;
})();
