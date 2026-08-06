// IIFE: isola o escopo deste arquivo. So a API abaixo (window.*) e publica.
(function () {
// ===========================================================================
// RELATORIOS EM PDF — desenhados DIRETO com jsPDF (texto vetorial)
// ---------------------------------------------------------------------------
// Por que jsPDF direto (e nao html2pdf)?
//   O html2pdf tira uma "foto" (imagem) do HTML e fatia em paginas. Isso deu
//   problema recorrente: conteudo cortado, pagina em branco e cards sumindo na
//   quebra. Aqui a gente DESENHA o PDF: posicionamos cada texto/retangulo em
//   milimetros e controlamos a paginacao na mao. Resultado: nitido, leve,
//   texto selecionavel e sem surpresas na quebra de pagina.
//
// Carregado DEPOIS do script.js: sobrescreve exportarResultado/exportarHistorico.
// ===========================================================================

// Cores da marca em [R, G, B] (jsPDF trabalha com componentes, nao hex).
const COR = {
    brand:  [37, 99, 235],
    texto:  [31, 41, 55],
    muted:  [107, 114, 128],
    borda:  [229, 231, 235],
    leve:   [248, 250, 252],
    sucesso:[16, 185, 129],
    branco: [255, 255, 255],
};

// Medidas da pagina A4 (mm).
const PAG = { w: 210, h: 297, m: 12 };
const LARG = PAG.w - PAG.m * 2;   // largura util = 186mm

// Pega a classe jsPDF do global (jspdf.umd.min.js expoe window.jspdf.jsPDF).
function getJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
}

function pdfAviso(msg, tipo) {
    if (typeof mostrarToast === 'function') mostrarToast(msg, tipo);
}

// "R$ 1.234,56" — moeda BR.
function pdfMoeda(valor) {
    const n = Number(valor) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',');
}


// --- Blocos de desenho reutilizaveis -------------------------------------

// Faixa de cabecalho (retangulo azul + textos). Devolve o Y logo abaixo.
function desenharCabecalho(doc, titulo, subtitulo, dataAtual) {
    const x = PAG.m, y = PAG.m, w = LARG, h = 28;
    doc.setFillColor.apply(doc, COR.brand);
    doc.roundedRect(x, y, w, h, 3, 3, 'F');

    doc.setTextColor.apply(doc, COR.branco);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text('CALCULADORA DE CUSTOS', x + 8, y + 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
    doc.text(titulo, x + 8, y + 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(subtitulo, x + 8, y + 22);

    doc.setFontSize(8);
    doc.text('Gerado em', x + w - 8, y + 15, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(dataAtual, x + w - 8, y + 20, { align: 'right' });

    return y + h + 8;
}

// Titulo de secao (barrinha azul + texto). Devolve o Y abaixo.
function desenharSecao(doc, y, texto) {
    doc.setFillColor.apply(doc, COR.brand);
    doc.rect(PAG.m, y - 3.3, 1.5, 4.6, 'F');
    doc.setTextColor.apply(doc, COR.texto);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(String(texto).toUpperCase(), PAG.m + 5, y);
    return y + 6;
}

// Linha de cards de metrica (numero grande + rotulo). cells = [{valor, rotulo}].
function desenharMetricas(doc, y, cells, x0, w) {
    const gap = 3, n = cells.length;
    const cw = (w - gap * (n - 1)) / n, ch = 18;
    cells.forEach(function (c, i) {
        const x = x0 + i * (cw + gap);
        doc.setFillColor.apply(doc, COR.leve);
        doc.setDrawColor.apply(doc, COR.borda);
        doc.roundedRect(x, y, cw, ch, 2, 2, 'FD');
        doc.setTextColor.apply(doc, COR.brand);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(String(c.valor), x + cw / 2, y + 8, { align: 'center' });
        doc.setTextColor.apply(doc, COR.muted);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(String(c.rotulo).toUpperCase(), x + cw / 2, y + 13.5, { align: 'center' });
    });
    return y + ch;
}

// Linha rotulo/valor (para as tabelas de informacao).
function linhaKV(doc, y, rotulo, valor) {
    const x = PAG.m, w = LARG, h = 8, wr = w * 0.45;
    doc.setDrawColor.apply(doc, COR.borda);
    doc.setFillColor.apply(doc, COR.leve);
    doc.rect(x, y, wr, h, 'FD');
    doc.rect(x + wr, y, w - wr, h, 'S');
    doc.setTextColor.apply(doc, COR.texto);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(String(rotulo), x + 3, y + 5.4);
    doc.setFont('helvetica', 'normal');
    doc.text(String(valor), x + wr + 3, y + 5.4);
    return y + h;
}

// Rodape (linha + creditos). Desenhado no fim de cada pagina.
function desenharRodape(doc) {
    const y = PAG.h - 12;
    doc.setDrawColor.apply(doc, COR.borda);
    doc.line(PAG.m, y, PAG.w - PAG.m, y);
    doc.setTextColor.apply(doc, COR.muted);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text('Calculadora de Custos - Beneficiamento de Pescados', PAG.m, y + 5);
    doc.text('Desenvolvido por Arthur', PAG.w - PAG.m, y + 5, { align: 'right' });
}

// Card de um calculo (nome + categoria + data + 4 metricas). Devolve Y abaixo.
function desenharCard(doc, y, calculo) {
    const x = PAG.m, w = LARG, p = 5, h = 38;
    doc.setDrawColor.apply(doc, COR.borda);
    doc.roundedRect(x, y, w, h, 2.5, 2.5, 'S');

    // Nome do produto
    doc.setTextColor.apply(doc, COR.texto);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(String(calculo.dados.produto), x + p, y + 9);

    // Etiqueta da categoria (pill azul)
    const cat = String(calculo.dados.categoria || '');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const tw = doc.getTextWidth(cat) + 6;
    doc.setFillColor.apply(doc, COR.brand);
    doc.roundedRect(x + p, y + 12, tw, 5, 2.5, 2.5, 'F');
    doc.setTextColor.apply(doc, COR.branco);
    doc.text(cat, x + p + 3, y + 15.4);

    // Data (direita)
    doc.setTextColor.apply(doc, COR.muted);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(new Date(calculo.timestamp).toLocaleString('pt-BR'), x + w - p, y + 9, { align: 'right' });

    // 4 metricas
    const r = calculo.resultados;
    desenharMetricas(doc, y + 20, [
        { valor: (r.porcentagem || 0).toFixed(1) + '%', rotulo: 'Beneficiamento' },
        { valor: '+' + arredondar(r.diferenca_pesos || 0) + ' kg', rotulo: 'Ganho' },
        { valor: pdfMoeda(r.custo_pos_beneficiamento), rotulo: 'Custo/kg' },
        { valor: pdfMoeda(r.custo_final), rotulo: 'Total' },
    ], x + p, w - 2 * p);

    return y + h + 6;
}

// Tabela de custos (4 colunas). rows = [{item, qtd, unit, total, bold}].
function desenharTabelaCustos(doc, y, rows) {
    const x = PAG.m, w = LARG, rh = 8;
    const fr = [0.40, 0.20, 0.20, 0.20];
    const cx = []; let acc = x;
    fr.forEach(function (f) { cx.push(acc); acc += w * f; });

    // Cabecalho
    doc.setFillColor.apply(doc, COR.brand);
    doc.rect(x, y, w, rh, 'F');
    doc.setTextColor.apply(doc, COR.branco);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('Item', cx[0] + 3, y + 5.4);
    doc.text('Quantidade', cx[1] + (w * fr[1]) / 2, y + 5.4, { align: 'center' });
    doc.text('Unitário', cx[2] + w * fr[2] - 3, y + 5.4, { align: 'right' });
    doc.text('Total', cx[3] + w * fr[3] - 3, y + 5.4, { align: 'right' });
    y += rh;

    rows.forEach(function (r, i) {
        if (r.bold) { doc.setFillColor.apply(doc, COR.leve); doc.rect(x, y, w, rh, 'F'); }
        else if (i % 2 === 1) { doc.setFillColor.apply(doc, COR.leve); doc.rect(x, y, w, rh, 'F'); }
        doc.setDrawColor.apply(doc, COR.borda);
        doc.rect(x, y, w, rh, 'S');
        doc.setTextColor.apply(doc, COR.texto);
        doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); doc.setFontSize(8.5);
        doc.text(String(r.item), cx[0] + 3, y + 5.4);
        if (r.qtd !== undefined) doc.text(String(r.qtd), cx[1] + (w * fr[1]) / 2, y + 5.4, { align: 'center' });
        if (r.unit !== undefined) doc.text(String(r.unit), cx[2] + w * fr[2] - 3, y + 5.4, { align: 'right' });
        doc.text(String(r.total), cx[3] + w * fr[3] - 3, y + 5.4, { align: 'right' });
        y += rh;
    });
    return y;
}


// --- Relatorios completos -------------------------------------------------

// PDF de UM calculo (detalhado).
function pdfDeCalculo(dados, resultados, nome) {
    const JsPDF = getJsPDF();
    if (!JsPDF) { pdfAviso('Biblioteca de PDF não carregou.', 'error'); return; }
    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const dataAtual = new Date().toLocaleString('pt-BR');

    let y = desenharCabecalho(doc, 'Relatório de Cálculo', 'Beneficiamento de Pescados', dataAtual);

    y = desenharSecao(doc, y, 'Informações da Produção');
    y = linhaKV(doc, y, 'Produto', dados.produto);
    y = linhaKV(doc, y, 'Categoria', dados.categoria);
    y = linhaKV(doc, y, 'Data', new Date().toLocaleDateString('pt-BR'));
    y += 4;

    y = desenharSecao(doc, y, 'Resultados Principais');
    y = desenharMetricas(doc, y, [
        { valor: resultados.porcentagem.toFixed(1) + '%', rotulo: 'Beneficiamento' },
        { valor: '+' + arredondar(resultados.diferenca_pesos) + ' kg', rotulo: 'Ganho de peso' },
        { valor: pdfMoeda(resultados.custo_pos_beneficiamento), rotulo: 'Custo por kg' },
    ], PAG.m, LARG);
    y += 6;

    y = desenharSecao(doc, y, 'Detalhamento dos Custos');
    y = desenharTabelaCustos(doc, y, [
        { item: 'Peso inicial', qtd: dados.peso_inicial + ' kg', unit: pdfMoeda(dados.preco), total: pdfMoeda(dados.peso_inicial * dados.preco) },
        { item: 'Sacos de gelo', qtd: dados.sacos_de_gelo + ' un.', unit: pdfMoeda(8.5), total: pdfMoeda(resultados.custo_sacos_gelo) },
        { item: 'Caixas de papelão', qtd: dados.caixa_papelao + ' un.', unit: pdfMoeda(7.3), total: pdfMoeda(resultados.custo_papelao) },
        { item: 'Fitas', qtd: dados.caixa_papelao + ' un.', unit: pdfMoeda(0.34), total: pdfMoeda(resultados.custo_fita_papelao) },
        { item: 'Subtotal de custos extras', total: pdfMoeda(resultados.custos_totais), bold: true },
    ]);
    y += 6;

    y = desenharSecao(doc, y, 'Análise Financeira');
    y = linhaKV(doc, y, 'Peso final', dados.peso_final + ' kg');
    y = linhaKV(doc, y, 'Preço inicial por kg', pdfMoeda(dados.preco));
    y = linhaKV(doc, y, 'Custo pós-beneficiamento por kg', pdfMoeda(resultados.custo_pos_beneficiamento));
    y = linhaKV(doc, y, 'Diferença de valor por kg', pdfMoeda(resultados.diferenca_valor));
    // Total final destacado (verde)
    const h = 9;
    doc.setFillColor(231, 247, 239); doc.rect(PAG.m, y, LARG, h, 'F');
    doc.setDrawColor.apply(doc, COR.borda); doc.rect(PAG.m, y, LARG, h, 'S');
    doc.setTextColor.apply(doc, COR.sucesso); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Custo total final', PAG.m + 3, y + 6);
    doc.text(pdfMoeda(resultados.custo_final), PAG.m + LARG - 3, y + 6, { align: 'right' });

    desenharRodape(doc);
    doc.save(nome);
    pdfAviso('PDF gerado com sucesso!', 'success');
}

// PDF de VARIOS calculos (historico ou selecionados), com paginacao correta.
function pdfDeLista(lista, titulo, nome) {
    const JsPDF = getJsPDF();
    if (!JsPDF) { pdfAviso('Biblioteca de PDF não carregou.', 'error'); return; }
    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const dataAtual = new Date().toLocaleString('pt-BR');

    let y = desenharCabecalho(doc, titulo, 'Beneficiamento de Pescados', dataAtual);

    // Resumo geral
    const qtd = lista.length;
    const prod = new Set(lista.map(c => c.dados.produto)).size;
    const custoMedio = qtd ? lista.reduce((s, c) => s + (c.resultados.custo_final || 0), 0) / qtd : 0;
    const benefMedio = qtd ? lista.reduce((s, c) => s + (c.resultados.porcentagem || 0), 0) / qtd : 0;

    y = desenharSecao(doc, y, 'Resumo Geral');
    y = desenharMetricas(doc, y, [
        { valor: qtd, rotulo: 'Cálculos' },
        { valor: prod, rotulo: 'Produtos diferentes' },
        { valor: pdfMoeda(custoMedio), rotulo: 'Custo médio' },
        { valor: benefMedio.toFixed(1) + '%', rotulo: 'Beneficiamento médio' },
    ], PAG.m, LARG);
    y += 6;

    y = desenharSecao(doc, y, 'Cálculos (' + qtd + ')');

    // Um card por calculo, criando nova pagina quando nao couber.
    const alturaCard = 44;               // card (38) + respiro (6)
    const limiteY = PAG.h - 18;          // deixa espaco pro rodape
    lista.forEach(function (c) {
        if (y + alturaCard > limiteY) {
            desenharRodape(doc);
            doc.addPage();
            y = PAG.m;
        }
        y = desenharCard(doc, y, c);
    });

    desenharRodape(doc);
    doc.save(nome);
    pdfAviso('PDF gerado com sucesso!', 'success');
}


// --- Sobrescreve as exportacoes -------------------------------------------
function exportarResultado() {
    const dados = coletarDados();
    const resultados = calcularCustos(dados);
    const nome = `calculo-${(dados.produto || 'produto').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.pdf`;
    pdfDeCalculo(dados, resultados, nome);
}

function exportarHistorico() {
    if (!historicoCalculos || historicoCalculos.length === 0) {
        pdfAviso('Não há cálculos para exportar!', 'warning');
        return;
    }
    pdfDeLista(historicoCalculos, 'Histórico de Cálculos', `historico-${new Date().toISOString().split('T')[0]}.pdf`);
}

// --- API publica (onclick do HTML + historico-selecao.js) ---
window.exportarResultado = exportarResultado;
window.exportarHistorico = exportarHistorico;
window.pdfDeLista = pdfDeLista;
})();
