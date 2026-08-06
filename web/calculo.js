// ===========================================================================
// CALCULO DE CUSTOS — logica de negocio pura (extraida do script.js)
// ---------------------------------------------------------------------------
// Continua sendo um script global classico (os nomes arredondar, coletarDados
// e calcularCustos seguem globais, exatamente como antes) — a mudanca e so de
// ORGANIZACAO: a conta fica separada da UI, da API e do resto.
//
// Depende de globais do script.js (campos, PRECOS), lidos no momento da chamada
// (nunca no carregamento), por isso a ordem de carga nao quebra nada.
// Carregado ANTES do script.js no index.html.
// ===========================================================================

// Arredonda para ate 'casas' decimais, SEM zeros a direita.
// Ex.: 7.439999999999998 -> 7.44 (resolve o "lixo" de ponto flutuante na tela).
// O toFixed arredonda e vira texto ("7.440"); o Number() tira os zeros a direita.
function arredondar(valor, casas = 3) {
    return Number(Number(valor).toFixed(casas));
}

// Le os campos do formulario e devolve um objeto com os dados da producao.
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
            : null,
        // Tipo escolhido de cada insumo fixo. Online, o servidor busca o valor pelo id
        // (fonte confiavel). Os preco_* abaixo sao so para o calculo OFFLINE (fallback).
        gelo_insumo_id: document.getElementById('gelo_insumo_id').value || null,
        papelao_insumo_id: document.getElementById('papelao_insumo_id').value || null,
        fita_insumo_id: document.getElementById('fita_insumo_id').value || null,
        preco_gelo: valorInsumoCalc('gelo_insumo_id', 'gelo', PRECOS.GELO),
        preco_papelao: valorInsumoCalc('papelao_insumo_id', 'papelao', PRECOS.PAPELAO),
        preco_fita: valorInsumoCalc('fita_insumo_id', 'fita', PRECOS.FITA),
        // Embalagem opcional: manda id + quantidade (o servidor busca o valor no banco).
        // embalagem_valor so e usado no calculo OFFLINE (fallback), lido da lista local.
        embalagem_id: document.getElementById('calc_embalagem').value || null,
        embalagem_qtd: parseInt(document.getElementById('calc_embalagem_qtd').value) || 0,
        embalagem_valor: valorEmbalagemSelecionada()
    };
}

// Busca o VALOR do tipo de insumo escolhido no select (do catalogo INSUMOS, do
// script.js). Usado so no fallback offline; se nada valido estiver escolhido,
// devolve o preco padrao (PRECOS).
function valorInsumoCalc(selectId, categoria, padrao) {
    const el = document.getElementById(selectId);
    const id = el ? el.value : '';
    if (id && typeof INSUMOS !== 'undefined') {
        const ins = INSUMOS.find(i => String(i.id) === String(id) && i.categoria === categoria);
        if (ins) return Number(ins.valor);
    }
    return padrao;
}

// Busca, na lista local de embalagens (EMBALAGENS, do script.js), o VALOR da
// embalagem escolhida na calculadora. Usado so no fallback offline.
function valorEmbalagemSelecionada() {
    const id = document.getElementById('calc_embalagem').value;
    if (!id || typeof EMBALAGENS === 'undefined') return 0;
    const emb = EMBALAGENS.find(e => String(e.id) === String(id));
    return emb ? Number(emb.valor) : 0;
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
        preco_venda,
        embalagem_qtd = 0,
        embalagem_valor = 0,
        // Preços dos insumos escolhidos. Caem no padrão (PRECOS) quando ausentes —
        // ex.: ao reabrir um cálculo antigo do histórico, salvo antes desta mudança.
        preco_gelo = PRECOS.GELO,
        preco_papelao = PRECOS.PAPELAO,
        preco_fita = PRECOS.FITA
    } = dados;

    // Cálculos básicos (a fita acompanha o número de caixas)
    const custo_sacos_gelo = sacos_de_gelo * preco_gelo;
    const custo_papelao = caixa_papelao * preco_papelao;
    const custo_fita_papelao = caixa_papelao * preco_fita;
    // Embalagem opcional: quantidade x valor (0 quando nao ha embalagem escolhida)
    const custo_embalagem = embalagem_qtd * embalagem_valor;
    const diferenca_pesos = peso_final - peso_inicial;
    const custo_producao = peso_inicial * preco;
    const custo_pos_beneficiamento = custo_producao / peso_final;
    const porcentagem = ((peso_final / peso_inicial) * 100) - 100;
    const diferenca_valor = preco - custo_pos_beneficiamento;
    const custos_totais = custo_sacos_gelo + custo_papelao + custo_fita_papelao + custo_embalagem;
    const custo_final = custos_totais + (custo_pos_beneficiamento * peso_final);

    const resultado = {
        custo_sacos_gelo,
        custo_papelao,
        custo_fita_papelao,
        custo_embalagem,
        diferenca_pesos,
        custo_producao,
        custo_pos_beneficiamento,
        porcentagem,
        diferenca_valor,
        custos_totais,
        custo_final
    };

    // Margem de lucro (opcional), espelhando calculos.py.
    // Lucro medido contra o custo CHEIO por kg (materia + insumos), = custo_final/peso_final.
    if (preco_venda && preco_venda > 0) {
        const custo_total_por_kg = custo_final / peso_final;
        const lucro_por_kg = preco_venda - custo_total_por_kg;
        resultado.preco_venda = preco_venda;
        resultado.custo_total_por_kg = custo_total_por_kg;
        resultado.lucro_por_kg = lucro_por_kg;
        resultado.margem_percentual = (lucro_por_kg / preco_venda) * 100;
    }

    return resultado;
}
