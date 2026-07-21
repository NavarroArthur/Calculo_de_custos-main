#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
calculos.py - Logica de calculo do beneficiamento (fonte unica da verdade).

Este arquivo NAO faz input(), print() nem Flask. Ele so recebe numeros e
devolve numeros. Assim o terminal (beneficiamento.py) e a API (api.py) usam
exatamente a mesma conta, importando esta funcao. Mudou a formula aqui,
mudou para todo mundo (nao precisa editar em varios lugares).
"""

# Precos PADRAO. Sao apenas valores iniciais/de conveniencia: como os precos
# mudam com o tempo, qualquer chamada pode sobrescreve-los. A API, por exemplo,
# passa os precos vindos do banco de dados.
PRECO_GELO_PADRAO = 8.5
PRECO_PAPELAO_PADRAO = 7.3
PRECO_FITA_PADRAO = 0.34


def calcular_resultados(preco, peso_inicial, peso_final,
                        sacos_de_gelo, caixa_papelao,
                        preco_gelo=PRECO_GELO_PADRAO,
                        preco_papelao=PRECO_PAPELAO_PADRAO,
                        preco_fita=PRECO_FITA_PADRAO,
                        preco_venda=None):
    """
    Calcula todos os custos do beneficiamento e devolve um dicionario.

    Args:
        preco:          preco por Kg do produto.
        peso_inicial:   peso de entrada da producao (Kg).
        peso_final:     peso apos o beneficiamento (Kg).
        sacos_de_gelo:  quantidade de sacos de gelo.
        caixa_papelao:  quantidade de caixas de papelao.
        preco_gelo/preco_papelao/preco_fita: precos dos insumos (opcionais;
            usam o valor padrao se nao forem informados).

    Returns:
        dict com todos os resultados (as mesmas chaves que a API ja usava).

    Raises:
        ValueError: se os dados forem impossiveis (protege contra divisao por zero).
    """
    # A conta nao pode rodar com dados invalidos.
    if peso_inicial <= 0 or peso_final <= 0:
        raise ValueError("Os pesos precisam ser maiores que zero.")
    if peso_final <= peso_inicial:
        raise ValueError("O peso final deve ser maior que o peso inicial.")
    if preco <= 0:
        raise ValueError("O preco deve ser maior que zero.")

    # Custos dos insumos
    custo_sacos_gelo = sacos_de_gelo * preco_gelo
    custo_papelao = caixa_papelao * preco_papelao
    custo_fita_papelao = caixa_papelao * preco_fita
    custos_totais = custo_sacos_gelo + custo_papelao + custo_fita_papelao

    # Custos da producao
    diferenca_pesos = peso_final - peso_inicial
    custo_producao = peso_inicial * preco
    custo_pos_beneficiamento = custo_producao / peso_final
    porcentagem = ((peso_final / peso_inicial) * 100) - 100
    diferenca_valor = preco - custo_pos_beneficiamento
    custo_final = custos_totais + (custo_pos_beneficiamento * peso_final)

    resultado = {
        "custo_sacos_gelo": custo_sacos_gelo,
        "custo_papelao": custo_papelao,
        "custo_fita_papelao": custo_fita_papelao,
        "diferenca_pesos": diferenca_pesos,
        "custo_producao": custo_producao,
        "custo_pos_beneficiamento": custo_pos_beneficiamento,
        "porcentagem": porcentagem,
        "diferenca_valor": diferenca_valor,
        "custos_totais": custos_totais,
        "custo_final": custo_final,
    }

    # Margem de lucro (opcional): so calcula se o preco de venda foi informado.
    # lucro por Kg = quanto voce vende menos quanto custa o Kg apos o beneficiamento.
    if preco_venda is not None and preco_venda > 0:
        lucro_por_kg = preco_venda - custo_pos_beneficiamento
        resultado["preco_venda"] = preco_venda
        resultado["lucro_por_kg"] = lucro_por_kg
        resultado["margem_percentual"] = (lucro_por_kg / preco_venda) * 100

    return resultado
