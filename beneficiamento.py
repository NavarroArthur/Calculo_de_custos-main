#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Calculadora de Custos - Beneficiamento de Pescados (versao de terminal)

Esta versao cuida SO da interface de terminal: menu, perguntas (input) e
exibicao (print). A CONTA em si mora em calculos.py e e importada abaixo,
para nao ficar duplicada entre o terminal e a API.
"""

# Importa a funcao de calculo da fonte unica. Isso so funciona porque
# calculos.py tem seu codigo em funcoes (nao dispara nada ao ser importado).
from calculos import calcular_resultados


# ---------------------------------------------------------------------------
# LEITURA COM VALIDACAO (reaproveitada em todas as perguntas de numero)
# ---------------------------------------------------------------------------
def ler_numero(mensagem, tipo=float, minimo=None):
    """
    Le um numero do usuario e so retorna quando o valor e valido.

    Args:
        mensagem: texto da pergunta.
        tipo:     funcao usada para converter (float ou int).
        minimo:   menor valor ACEITO (inclusive). None = sem limite inferior.
    """
    while True:                       # repete ate receber algo valido
        entrada = input(mensagem)
        try:
            valor = tipo(entrada)     # tenta converter, ex.: "10" -> 10.0
        except ValueError:
            print("Entrada invalida. Digite um numero.")
            continue
        if minimo is not None and valor < minimo:
            print(f"O valor precisa ser no minimo {minimo}.")
            continue
        return valor


# ---------------------------------------------------------------------------
# MENU DE PRODUTOS
# ---------------------------------------------------------------------------
def menu():
    """Mostra o menu e retorna o NOME do produto escolhido."""
    produtos = [
        "File de merluza",
        "File de Panga Com",
        "File de Panga Premium",
        "File de Saithe",
        "File de Polaca",
        "Posta de Cacao",
        "Posta de Salmao",
        "File de Tilapia",
        "Tentaculos de Lula",
        "Aneis de Lula",
        "Camarao sete barbas",
    ]

    while True:
        print("\n===== MENU DE PRODUTOS =====")
        for numero, nome in enumerate(produtos, start=1):
            print(f"{numero} - {nome}")
        print("\n0 - Fechar o programa")
        print("==============================")

        escolha = input("Escolha uma opcao: ")

        if not escolha.isdigit():
            print("Por favor, insira um numero valido.")
            continue

        escolha = int(escolha)

        if escolha == 0:
            print("Fechando o programa...")
            exit()
        elif 1 <= escolha <= len(produtos):
            produto = produtos[escolha - 1]
            print(f"Produto escolhido: {produto}!")
            return produto
        else:
            print("Opcao invalida! Tente novamente.")


# ---------------------------------------------------------------------------
# CATEGORIA DA PRODUCAO
# ---------------------------------------------------------------------------
def escolher_categoria(produto):
    """Pergunta se a producao e de Mercado ou Restaurante e retorna o texto."""
    while True:
        print(f"\nQual a categoria dessa producao de {produto}?")
        print("1 - Produtos de Mercado")
        print("2 - Produtos de Restaurante")
        escolha = input("Escolha uma opcao: ")

        if escolha == "1":
            print("Essa producao e de Mercado.")
            return "Mercado"
        elif escolha == "2":
            print("Essa producao e de Restaurante.")
            return "Restaurante"
        else:
            print("Digite um numero valido, por favor.")


# ---------------------------------------------------------------------------
# PERGUNTA SIM/NAO
# ---------------------------------------------------------------------------
def perguntar_sim_nao(mensagem):
    """Retorna True para sim, False para nao. Repete ate a resposta ser valida."""
    while True:
        resposta = input(mensagem).strip().lower()   # ignora espacos e maiusculas
        if resposta in ("s", "sim"):
            return True
        if resposta in ("n", "nao", "não"):
            return False
        print("Responda com 's' (sim) ou 'n' (nao).")


# ---------------------------------------------------------------------------
# UM CALCULO COMPLETO
# Coleta os dados, chama a conta (calculos.py) e exibe. A matematica nao esta
# aqui: esta funcao so pergunta e mostra.
# ---------------------------------------------------------------------------
def executar_calculo():
    produto = menu()
    categoria = escolher_categoria(produto)

    # --- Perguntas ao usuario, todas com validacao ---
    preco = ler_numero(f"Digite o valor do Kg de {produto}: ", float, minimo=0.01)
    # pesos aceitam decimais (ex.: 127.78 kg) -> float, nao int
    peso_inicial = ler_numero("Digite a entrada em Kgs dessa producao: ", float, minimo=0.01)

    # peso_final precisa ser maior que o inicial.
    while True:
        peso_final = ler_numero("Digite o final em Kgs dessa producao: ", float, minimo=0.01)
        if peso_final > peso_inicial:
            break
        print("O peso final deve ser maior que o peso inicial.")

    sacos_de_gelo = ler_numero("Quantidade de sacos de gelo: ", int, minimo=0)
    caixa_papelao = ler_numero("Quantidade de caixas de papelao: ", int, minimo=0)

    # --- A conta e feita pela fonte unica; recebemos um dicionario 'r' ---
    r = calcular_resultados(preco, peso_inicial, peso_final, sacos_de_gelo, caixa_papelao)

    # --- Exibicao (dinheiro sempre com :.2f = duas casas decimais fixas) ---
    linha = "=" * 80
    print("\nINFORMACOES SOBRE A PRODUCAO:\n")
    print(linha)
    print(f"Produto:   {produto}")
    print(f"Categoria: {categoria}")
    print(f"Custo somado de papelao, gelo e fita: R${r['custos_totais']:.2f}")
    print("\nDETALHES DOS CUSTOS:")
    print(f"R${r['custo_sacos_gelo']:.2f} em sacos de gelo")
    print(f"R${r['custo_papelao']:.2f} em caixas de papelao")
    print(f"R${r['custo_fita_papelao']:.2f} em fitas durex")
    print(linha)
    print(f"\nBeneficiamento de {r['porcentagem']:.2f}%, aumento de {r['diferenca_pesos']} Kg "
          f"(de {peso_inicial} para {peso_final}).")
    print(linha)
    print(f"\nPreco inicial: R${preco:.2f} por Kg.")
    print(f"Preco por Kg apos beneficiamento (sem custos extras): R${r['custo_pos_beneficiamento']:.2f}")
    print(f"Diferenca de valor por Kg: R${r['diferenca_valor']:.2f}")
    print(linha)
    print(f"\nPreco real da producao com custos extras: R${r['custo_final']:.2f}")
    print(linha)


# ---------------------------------------------------------------------------
# FLUXO PRINCIPAL
# main() repete o calculo enquanto o usuario quiser (o "deseja calcular de novo?").
# ---------------------------------------------------------------------------
def main():
    while True:
        executar_calculo()
        if not perguntar_sim_nao("\nDeseja calcular de novo? (s/n): "):
            print("Encerrando. Ate mais!")
            break


# UNICO ponto de entrada, no fim do arquivo.
if __name__ == "__main__":
    main()
