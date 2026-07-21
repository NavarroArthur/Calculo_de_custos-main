#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes da fonte unica de calculo (calculos.py).
Rode com:  pytest        (na pasta do projeto)

Cada funcao 'test_...' e um caso. 'assert' verifica se o resultado bate;
pytest.approx compara numeros float sem sofrer com arredondamento binario.
"""
import pytest
from calculos import calcular_resultados


def test_valores_conhecidos():
    # merluza: R$10/Kg, 100 -> 115 Kg, 3 sacos de gelo, 2 caixas
    r = calcular_resultados(10, 100, 115, 3, 2)
    assert r["custos_totais"] == pytest.approx(40.78)     # 3*8.5 + 2*7.3 + 2*0.34
    assert r["porcentagem"] == pytest.approx(15.0)
    assert r["custo_pos_beneficiamento"] == pytest.approx(1000 / 115)
    assert r["custo_final"] == pytest.approx(1040.78)


def test_precos_personalizados_sobrescrevem_padrao():
    r = calcular_resultados(10, 100, 115, 1, 1, preco_gelo=10, preco_papelao=10, preco_fita=1)
    assert r["custo_sacos_gelo"] == 10
    assert r["custo_papelao"] == 10
    assert r["custo_fita_papelao"] == 1
    assert r["custos_totais"] == 21


def test_peso_final_menor_ou_igual_levanta_erro():
    with pytest.raises(ValueError):
        calcular_resultados(10, 100, 100, 1, 1)   # igual
    with pytest.raises(ValueError):
        calcular_resultados(10, 100, 90, 1, 1)    # menor


def test_peso_zero_levanta_erro():
    with pytest.raises(ValueError):
        calcular_resultados(10, 0, 50, 1, 1)


def test_preco_invalido_levanta_erro():
    with pytest.raises(ValueError):
        calcular_resultados(0, 100, 115, 1, 1)


def test_todas_as_chaves_presentes():
    r = calcular_resultados(10, 100, 115, 3, 2)
    esperadas = {"custo_sacos_gelo", "custo_papelao", "custo_fita_papelao", "diferenca_pesos",
                 "custo_producao", "custo_pos_beneficiamento", "porcentagem", "diferenca_valor",
                 "custos_totais", "custo_final"}
    assert set(r.keys()) == esperadas


def test_margem_de_lucro():
    # preco de venda R$12/Kg; custo pos-beneficiamento = 1000/115
    r = calcular_resultados(10, 100, 115, 3, 2, preco_venda=12)
    custo_kg = 1000 / 115
    assert r["preco_venda"] == 12
    assert r["lucro_por_kg"] == pytest.approx(12 - custo_kg)
    assert r["margem_percentual"] == pytest.approx((12 - custo_kg) / 12 * 100)


def test_sem_preco_venda_nao_gera_margem():
    # sem preco de venda, as chaves de margem nao existem
    r = calcular_resultados(10, 100, 115, 3, 2)
    assert "preco_venda" not in r
    assert "margem_percentual" not in r
