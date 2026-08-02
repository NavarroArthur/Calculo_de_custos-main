#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes automatizados da API (pytest).

Rodam contra um banco TEMPORÁRIO, sem tocar no banco real. Cada teste sobe o
Flask em modo de teste (test_client) e verifica o comportamento das rotas:
segurança (login, RBAC, IDOR), identidade pelo token, e as regras de negócio.

Como rodar:  python -m pytest test_api.py -q
"""

import os
import tempfile
import pytest

# IMPORTANTE: definir o banco ANTES de importar 'api', pois o app cria o
# DatabaseManager no momento do import. Assim os testes usam um arquivo isolado.
_TMP_DB = os.path.join(tempfile.gettempdir(), 'teste_api_calculos.db')
if os.path.exists(_TMP_DB):
    os.remove(_TMP_DB)
os.environ['DATABASE_URL'] = _TMP_DB
os.environ.pop('FLASK_ENV', None)          # modo dev: cria admin padrão (admin123)
os.environ.pop('SECRET_KEY', None)         # dev usa chave fixa

import api  # noqa: E402

ADMIN_EMAIL = 'admin@calculadora.local'
ADMIN_SENHA = 'admin123'


@pytest.fixture
def client():
    api.app.config['TESTING'] = True
    return api.app.test_client()


@pytest.fixture(autouse=True)
def _limpar_rate_limit():
    """Zera as tentativas de login do IP de teste antes de cada teste, para o
    rate limit de um teste não vazar para o outro."""
    api.db.limpar_tentativas_login('127.0.0.1')
    yield


def login(client, email=ADMIN_EMAIL, senha=ADMIN_SENHA):
    """Faz login e devolve (status_code, json)."""
    r = client.post('/api/login', json={'email': email, 'senha': senha})
    return r.status_code, r.get_json()


def auth(token):
    return {'Authorization': 'Bearer ' + token}


def token_admin(client):
    _, data = login(client)
    return data['token']


# --- Saúde / login ---------------------------------------------------------

def test_health_ok(client):
    r = client.get('/api/health')
    assert r.status_code == 200
    assert r.get_json()['status'] == 'ok'


def test_login_sucesso_devolve_papel_admin(client):
    status, data = login(client)
    assert status == 200
    assert data['papel'] == 'admin'
    assert 'token' in data


def test_login_falha_generica(client):
    r = client.post('/api/login', json={'email': ADMIN_EMAIL, 'senha': 'errada'})
    assert r.status_code == 401
    # mensagem genérica (não revela se o e-mail existe)
    assert 'inválidos' in r.get_json()['error'].lower()


def test_rate_limit_bloqueia_apos_5(client):
    for _ in range(5):
        client.post('/api/login', json={'email': 'x@x.com', 'senha': 'errada'})
    r = client.post('/api/login', json={'email': 'x@x.com', 'senha': 'errada'})
    assert r.status_code == 429


# --- Autenticação / autorização (RBAC) ------------------------------------

def test_rota_protegida_sem_token(client):
    assert client.get('/api/produtos').status_code == 401


def test_leitura_nao_altera_config(client):
    tok = api.serializer.dumps({'uid': 999, 'papel': 'leitura'})
    r = client.put('/api/configuracoes', json={'preco_gelo': 1}, headers=auth(tok))
    assert r.status_code == 403


def test_admin_altera_config_gera_log(client):
    A = auth(token_admin(client))
    assert client.put('/api/configuracoes', json={'preco_gelo': 9.99}, headers=A).status_code == 200
    logs = client.get('/api/logs?acao=config_alterada', headers=A).get_json()['logs']
    assert any('preco_gelo' in (l['detalhes'] or '') for l in logs)


# --- Identidade pelo token / IDOR -----------------------------------------

def test_salvar_calculo_usa_dono_do_token(client):
    _, data = login(client)
    A = auth(data['token'])
    uid = api.serializer.loads(data['token'])['uid']
    calc = {'produto': 'M', 'categoria': 'p', 'preco': 10, 'peso_inicial': 90,
            'peso_final': 100, 'sacos_de_gelo': 2, 'caixa_papelao': 3}
    r = client.post('/api/calculos', json=calc, headers=A)
    assert r.status_code == 201
    meus = client.get('/api/calculos/meus', headers=A).get_json()
    assert meus['total'] >= 1


def test_idor_leitura_nao_ve_calculos_de_outro(client):
    tok = api.serializer.dumps({'uid': 2, 'papel': 'leitura'})
    # tentando ver os cálculos do usuário 1 (não é dela) -> 403
    r = client.get('/api/calculos/usuario/1', headers=auth(tok))
    assert r.status_code == 403


def test_apagar_meu_historico(client):
    A = auth(token_admin(client))
    calc = {'produto': 'M', 'categoria': 'p', 'preco': 10, 'peso_inicial': 90,
            'peso_final': 100, 'sacos_de_gelo': 2, 'caixa_papelao': 3}
    client.post('/api/calculos', json=calc, headers=A)
    r = client.delete('/api/calculos/meus', headers=A)
    assert r.status_code == 200
    assert client.get('/api/calculos/meus', headers=A).get_json()['total'] == 0


# --- Usuários (criação com senha + papel) ---------------------------------

def test_criar_usuario_com_senha_consegue_logar(client):
    A = auth(token_admin(client))
    novo = {'nome': 'Funcionario', 'email': 'func@empresa.com',
            'senha': 'segredo123', 'papel': 'leitura'}
    r = client.post('/api/usuarios', json=novo, headers=A)
    assert r.status_code == 201
    # o novo usuário consegue logar e vem como 'leitura'
    status, data = login(client, 'func@empresa.com', 'segredo123')
    assert status == 200
    assert data['papel'] == 'leitura'


def test_criar_usuario_papel_invalido(client):
    A = auth(token_admin(client))
    r = client.post('/api/usuarios',
                    json={'nome': 'X', 'email': 'x2@x.com', 'senha': 'abcdef', 'papel': 'chefe'},
                    headers=A)
    assert r.status_code == 400


def test_listar_usuarios_so_admin(client):
    tok = api.serializer.dumps({'uid': 2, 'papel': 'leitura'})
    assert client.get('/api/usuarios', headers=auth(tok)).status_code == 403
    A = auth(token_admin(client))
    assert client.get('/api/usuarios', headers=A).status_code == 200
