#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Restaura o banco de dados a partir de um arquivo de backup .db.

Por que este script existe: um backup que você NUNCA restaurou é só esperança.
Aqui o processo de volta é explícito, seguro e testável, para você ter certeza
de que o backup presta ANTES de precisar dele de verdade.

USO:
    python restaurar_backup.py <arquivo_backup.db>

O que ele faz, em ordem (falha cedo se algo estiver errado):
  1) Confere que o arquivo de backup existe e passa no PRAGMA integrity_check
     do SQLite (ou seja: é um banco válido e não corrompido).
  2) Salva o banco ATUAL como pre_restauracao_<data>.db — rede de segurança,
     caso você precise voltar atrás.
  3) Copia o backup por cima do banco de produção e remove arquivos -wal/-shm
     antigos (do modo WAL), para o banco restaurado não se misturar com um
     journal velho.
  4) Confere de novo a integridade do destino já restaurado.

IMPORTANTE: PARE a API (o app) antes de restaurar. Restaurar com o servidor no ar
pode deixar o arquivo inconsistente, porque ele pode estar escrevendo ao mesmo tempo.
"""

import os
import shutil
import sqlite3
import sys
from datetime import datetime

from database import DatabaseManager


def verificar_integridade(caminho: str):
    """Roda 'PRAGMA integrity_check' no arquivo. Devolve (ok: bool, detalhe: str).
    Este PRAGMA percorre o banco inteiro e responde 'ok' se estiver íntegro."""
    if not os.path.isfile(caminho):
        return False, 'arquivo não encontrado'
    try:
        con = sqlite3.connect(caminho)
        try:
            linha = con.execute('PRAGMA integrity_check').fetchone()
        finally:
            con.close()
    except sqlite3.DatabaseError as e:
        return False, f'não é um banco SQLite válido: {e}'
    resposta = linha[0] if linha else 'sem resposta'
    return (resposta == 'ok'), resposta


def restaurar(origem: str, destino: str = None) -> str:
    """Restaura 'origem' (backup) sobre 'destino' (banco em uso). Se destino não
    for informado, usa o caminho oficial do DatabaseManager. Devolve o caminho da
    cópia de segurança feita do banco anterior (ou '' se não havia banco)."""
    destino = destino or DatabaseManager().db_path

    # 1) O backup precisa ser válido ANTES de qualquer coisa.
    ok, detalhe = verificar_integridade(origem)
    if not ok:
        raise SystemExit(f'❌ Backup inválido ({detalhe}). Restauração abortada.')

    # 2) Rede de segurança: guarda o banco atual antes de sobrescrever.
    salvo = ''
    if os.path.isfile(destino):
        salvo = f'pre_restauracao_{datetime.now():%Y%m%d_%H%M%S}.db'
        shutil.copy2(destino, salvo)
        print(f'🛟  Banco atual salvo como: {salvo}')

    # 3) Copia o backup por cima e limpa journals antigos do destino (modo WAL).
    shutil.copy2(origem, destino)
    for sufixo in ('-wal', '-shm'):
        antigo = destino + sufixo
        if os.path.isfile(antigo):
            os.remove(antigo)

    # 4) Confere que o destino restaurado está íntegro.
    ok2, detalhe2 = verificar_integridade(destino)
    if not ok2:
        raise SystemExit(f'❌ Após copiar, o destino não passou no integrity_check ({detalhe2}).')

    print(f'✅ Restaurado: {origem}  ->  {destino}  (integrity_check: ok)')
    return salvo


def main():
    if len(sys.argv) != 2:
        print('USO: python restaurar_backup.py <arquivo_backup.db>')
        raise SystemExit(1)
    print('⚠️  Pare a API antes de continuar (o app não pode estar escrevendo no banco).')
    restaurar(sys.argv[1])


if __name__ == '__main__':
    main()
