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
