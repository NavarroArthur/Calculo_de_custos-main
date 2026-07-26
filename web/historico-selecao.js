// IIFE: isola o escopo deste arquivo. So a API abaixo (window.*) e publica.
(function () {
// ===========================================================================
// SELECAO DE ITENS DO HISTORICO -> PDF UNICO
// ---------------------------------------------------------------------------
// Cada item do historico ganhou um checkbox. Guardamos os IDs marcados num
// Set. Como a lista e re-renderizada a cada filtro, o Set e a "memoria" da
// selecao: depois de renderizar, reaplicamos os checks (aplicarSelecaoNaLista,
// chamada pelo script.js no fim do atualizarHistorico).
//
// Por que um Set? Porque garante IDs unicos e tem add/delete/has O(1) — ideal
// para "esta marcado?" e para nao duplicar.
// ===========================================================================

const selecionadosHistorico = new Set();

// Reaplica o estado dos checkboxes apos a lista ser redesenhada e atualiza a
// barra. Chamada pelo script.js ao final de atualizarHistorico().
function aplicarSelecaoNaLista() {
    document.querySelectorAll('#historyList .history-check').forEach(function (cb) {
        cb.checked = selecionadosHistorico.has(Number(cb.dataset.id));
    });
    atualizarBarraSelecao();
}

// Atualiza o contador, o estado do botao e o "selecionar todos".
function atualizarBarraSelecao() {
    const n = selecionadosHistorico.size;

    const contador = document.getElementById('selCount');
    if (contador) contador.textContent = n + (n === 1 ? ' selecionado' : ' selecionados');

    const botao = document.getElementById('btnExportarSelecionados');
    if (botao) botao.disabled = (n === 0);

    // "Selecionar todos" reflete os itens VISIVEIS (apos filtro):
    // marcado se todos visiveis estao marcados; parcial (indeterminate) se alguns.
    const todos = document.getElementById('selecionarTodos');
    if (todos) {
        const visiveis = Array.from(document.querySelectorAll('#historyList .history-check'));
        const marcados = visiveis.filter(cb => cb.checked).length;
        todos.checked = visiveis.length > 0 && marcados === visiveis.length;
        todos.indeterminate = marcados > 0 && marcados < visiveis.length;
    }
}

// Gera um unico PDF com os calculos selecionados (usa o pdf-relatorio.js).
function exportarSelecionados() {
    const ids = Array.from(selecionadosHistorico);
    if (ids.length === 0) {
        if (typeof mostrarToast === 'function') mostrarToast('Selecione ao menos um cálculo.', 'warning');
        return;
    }
    // Filtra os calculos pelos IDs marcados e ordena do mais recente ao mais antigo.
    const lista = historicoCalculos
        .filter(c => ids.includes(c.id))
        .sort((a, b) => b.timestamp - a.timestamp);

    const nome = `relatorio-selecionados-${new Date().toISOString().split('T')[0]}.pdf`;
    pdfDeLista(lista, 'Relatório de Cálculos Selecionados', nome);
}

document.addEventListener('DOMContentLoaded', function () {
    // Delegacao de evento: um unico listener no container ouve os checkboxes,
    // mesmo os que ainda nem existem (a lista e recriada a cada filtro).
    const lista = document.getElementById('historyList');
    if (lista) {
        lista.addEventListener('change', function (evento) {
            const cb = evento.target.closest('.history-check');
            if (!cb) return;
            const id = Number(cb.dataset.id);
            if (cb.checked) selecionadosHistorico.add(id);
            else selecionadosHistorico.delete(id);
            atualizarBarraSelecao();
        });
    }

    // "Selecionar todos": marca/desmarca todos os itens VISIVEIS.
    const todos = document.getElementById('selecionarTodos');
    if (todos) {
        todos.addEventListener('change', function () {
            document.querySelectorAll('#historyList .history-check').forEach(function (cb) {
                cb.checked = todos.checked;
                const id = Number(cb.dataset.id);
                if (todos.checked) selecionadosHistorico.add(id);
                else selecionadosHistorico.delete(id);
            });
            atualizarBarraSelecao();
        });
    }

    const botao = document.getElementById('btnExportarSelecionados');
    if (botao) botao.addEventListener('click', exportarSelecionados);
});

// --- API publica (usada por script.js) ---
window.aplicarSelecaoNaLista = aplicarSelecaoNaLista;
})();
