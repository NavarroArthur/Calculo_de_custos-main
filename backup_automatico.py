#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backup automático + limpeza (retenção).

Feito para rodar sozinho por uma TAREFA AGENDADA (ex.: Scheduled Task do
PythonAnywhere, uma vez por dia). Assim o backup não depende de alguém lembrar
de clicar no botão.

O que ele faz, em ordem:
  1) Gera um backup do banco (com checkpoint do WAL, via DatabaseManager.criar_backup).
  2) Apaga backups mais antigos que DIAS_MANTER_BACKUP (a pasta não cresce pra sempre).
  3) Apaga logs mais antigos que DIAS_MANTER_LOGS.

IMPORTANTE sobre backup "de verdade": o arquivo gerado fica NO PRÓPRIO SERVIDOR.
Se o servidor morrer, essa cópia morre junto. O backup que realmente protege é o
que SAI do servidor — então baixe periodicamente o .db para o seu computador, ou
adicione aqui um envio para um armazenamento externo (Google Drive, S3, etc.).
"""

import os
import glob
import time
from datetime import datetime

from database import DatabaseManager

# --- Configurações de retenção (ajuste à vontade) --------------------------
PASTA_BACKUPS = 'backups'
DIAS_MANTER_BACKUP = 14   # mantém as cópias dos últimos 14 dias
DIAS_MANTER_LOGS = 90     # apaga logs com mais de 90 dias


def limpar_backups_antigos(pasta: str, dias: int) -> int:
    """Apaga arquivos backup_*.db com data de modificação mais antiga que N dias.
    Retorna quantos foram apagados."""
    if not os.path.isdir(pasta):
        return 0
    limite = time.time() - dias * 86400   # 86400 segundos = 1 dia
    apagados = 0
    for arquivo in glob.glob(os.path.join(pasta, 'backup_*.db')):
        if os.path.getmtime(arquivo) < limite:
            try:
                os.remove(arquivo)
                apagados += 1
            except OSError as e:
                print(f'  aviso: não consegui apagar {arquivo}: {e}')
    return apagados


def main():
    db = DatabaseManager()

    # 1) Gera o backup (criar_backup já faz o checkpoint do WAL antes de copiar)
    destino = db.criar_backup(PASTA_BACKUPS)

    # 2) e 3) Retenção: backups e logs antigos
    backups_apagados = limpar_backups_antigos(PASTA_BACKUPS, DIAS_MANTER_BACKUP)
    logs_apagados = db.limpar_logs_antigos(DIAS_MANTER_LOGS)

    quando = datetime.now().strftime('%Y-%m-%d %H:%M')
    print(f'[{quando}] backup criado: {os.path.basename(destino)} | '
          f'backups antigos apagados: {backups_apagados} | '
          f'logs antigos apagados: {logs_apagados}')


if __name__ == '__main__':
    main()
