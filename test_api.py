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
    """Faz o login COMPLETO (senha + 2FA) e devolve (status_code, json) do passo final.

    Como o 2FA é obrigatório, o login tem dois passos. Aqui, para o teste, lemos o
    segredo TOTP direto do banco (temos acesso ao api.db) e geramos o código com
    pyotp — exatamente o que o app autenticador do usuário faria. Serve tanto para o
    primeiro login (setup) quanto para os seguintes (2FA já confirmado)."""
    import pyotp
    r = client.post('/api/login', json={'email': email, 'senha': senha})
    j = r.get_json() or {}
    # Falha no 1º passo (senha errada, rate limit, etc.): devolve como está.
    if r.status_code != 200 or 'pre_token' not in j:
        return r.status_code, j
    u = api.db.obter_usuario_por_email(email)
    codigo = pyotp.TOTP(u['totp_secret']).now()
    r2 = client.post('/api/login/2fa', json={'pre_token': j['pre_token'], 'codigo': codigo})
    return r2.status_code, r2.get_json()


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


# --- 2FA (TOTP) obrigatório ------------------------------------------------

def test_login_primeiro_passo_nao_entrega_sessao(client):
    """Com a senha certa, o 1º passo NÃO devolve token de sessão: exige o 2FA."""
    r = client.post('/api/login', json={'email': ADMIN_EMAIL, 'senha': ADMIN_SENHA})
    j = r.get_json()
    assert r.status_code == 200
    assert 'token' not in j                       # sessão ainda não
    assert 'pre_token' in j                        # só o token de pré-autenticação
    assert j.get('needs_2fa_setup') or j.get('needs_2fa')


def test_pre_token_nao_vale_como_sessao(client):
    """O token do 1º passo não pode acessar rota protegida (senão pularia o 2FA)."""
    j = client.post('/api/login', json={'email': ADMIN_EMAIL, 'senha': ADMIN_SENHA}).get_json()
    assert client.get('/api/usuarios', headers=auth(j['pre_token'])).status_code == 401


def test_2fa_codigo_errado_falha(client):
    j = client.post('/api/login', json={'email': ADMIN_EMAIL, 'senha': ADMIN_SENHA}).get_json()
    r = client.post('/api/login/2fa', json={'pre_token': j['pre_token'], 'codigo': '000000'})
    assert r.status_code == 401


def test_backup_code_uso_unico(client):
    """No setup, o usuário recebe códigos de backup; cada um funciona só uma vez."""
    import pyotp
    A = auth(token_admin(client))
    client.post('/api/usuarios', json={'nome': 'Bkp', 'email': 'bkp@x.com',
                'senha': 'segredo123', 'papel': 'leitura'}, headers=A)
    # setup do 2FA desse usuário -> recebe os códigos de backup
    j = client.post('/api/login', json={'email': 'bkp@x.com', 'senha': 'segredo123'}).get_json()
    seg = api.db.obter_usuario_por_email('bkp@x.com')['totp_secret']
    r = client.post('/api/login/2fa', json={'pre_token': j['pre_token'],
                    'codigo': pyotp.TOTP(seg).now()}).get_json()
    codigo_backup = r['backup_codes'][0]
    # 1º uso do código de backup: funciona
    api.db.limpar_tentativas_login('127.0.0.1')
    j2 = client.post('/api/login', json={'email': 'bkp@x.com', 'senha': 'segredo123'}).get_json()
    assert client.post('/api/login/2fa',
                       json={'pre_token': j2['pre_token'], 'codigo': codigo_backup}).status_code == 200
    # 2º uso do MESMO código: rejeitado
    api.db.limpar_tentativas_login('127.0.0.1')
    j3 = client.post('/api/login', json={'email': 'bkp@x.com', 'senha': 'segredo123'}).get_json()
    assert client.post('/api/login/2fa',
                       json={'pre_token': j3['pre_token'], 'codigo': codigo_backup}).status_code == 401


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


# --- Permissões granulares por aba ----------------------------------------

def test_permissao_produtos_libera_escrita(client):
    A = auth(token_admin(client))
    # usuário COM permissão de produtos
    client.post('/api/usuarios', json={'nome': 'Prod', 'email': 'p1@x.com',
                'senha': 'segredo1', 'papel': 'leitura', 'permissoes': ['produtos']}, headers=A)
    tk = login(client, 'p1@x.com', 'segredo1')[1]
    assert 'produtos' in tk['permissoes']
    H = auth(tk['token'])
    assert client.post('/api/produtos', json={'nome': 'Peixe', 'preco_kg': 5}, headers=H).status_code == 201


def test_sem_permissao_produtos_bloqueia_escrita(client):
    A = auth(token_admin(client))
    client.post('/api/usuarios', json={'nome': 'SoCalc', 'email': 'p2@x.com',
                'senha': 'segredo1', 'papel': 'leitura', 'permissoes': []}, headers=A)
    tk = login(client, 'p2@x.com', 'segredo1')[1]
    H = auth(tk['token'])
    # não tem 'produtos' -> não pode criar
    assert client.post('/api/produtos', json={'nome': 'X', 'preco_kg': 5}, headers=H).status_code == 403
    # mas continua conseguindo LER produtos (base da calculadora)
    assert client.get('/api/produtos', headers=H).status_code == 200


def test_permissao_invalida_e_ignorada(client):
    A = auth(token_admin(client))
    client.post('/api/usuarios', json={'nome': 'Hacker', 'email': 'p3@x.com',
                'senha': 'segredo1', 'papel': 'leitura', 'permissoes': ['produtos', 'config', 'logs']}, headers=A)
    tk = login(client, 'p3@x.com', 'segredo1')[1]
    # 'config' e 'logs' não são permissões válidas -> foram descartadas
    assert set(tk['permissoes']) == {'produtos'}


def test_editar_permissoes_e_anti_lockout(client):
    A = auth(token_admin(client))
    r = client.post('/api/usuarios', json={'nome': 'Edit', 'email': 'p4@x.com',
                    'senha': 'segredo1', 'papel': 'leitura', 'permissoes': []}, headers=A)
    uid = r.get_json()['usuario_id']
    # admin dá a aba produtos a esse usuário
    assert client.put(f'/api/usuarios/{uid}', json={'permissoes': ['produtos']}, headers=A).status_code == 200
    # admin NÃO pode remover o próprio acesso admin
    uid_admin = api.serializer.loads(token_admin(client))['uid']
    assert client.put(f'/api/usuarios/{uid_admin}', json={'papel': 'leitura'}, headers=A).status_code == 400


# --- Insumos (catálogo: gelo, papelão, fita, embalagem) --------------------

def test_insumo_crud_e_vinculo_embalagem(client):
    A = auth(token_admin(client))
    # criar um insumo de embalagem
    r = client.post('/api/insumos', json={'nome': 'Caixa 5kg', 'valor': 2.5, 'categoria': 'embalagem'}, headers=A)
    assert r.status_code == 201
    eid = r.get_json()['insumo_id']
    # nome duplicado na MESMA categoria -> 400
    assert client.post('/api/insumos', json={'nome': 'Caixa 5kg', 'valor': 9, 'categoria': 'embalagem'}, headers=A).status_code == 400
    # mesmo nome em OUTRA categoria -> permitido
    assert client.post('/api/insumos', json={'nome': 'Caixa 5kg', 'valor': 9, 'categoria': 'papelao'}, headers=A).status_code == 201
    # categoria inválida -> 400
    assert client.post('/api/insumos', json={'nome': 'Y', 'valor': 1, 'categoria': 'foo'}, headers=A).status_code == 400
    # vincular a um produto e conferir que o nome/valor voltam no JOIN (com insumos!)
    client.post('/api/produtos', json={'nome': 'Tilapia', 'preco_kg': 20}, headers=A)
    pid = [p for p in client.get('/api/produtos', headers=A).get_json()['produtos']
           if p['nome'] == 'Tilapia'][0]['id']
    assert client.put(f'/api/produtos/{pid}', json={'embalagem_id': eid}, headers=A).status_code == 200
    prod = [p for p in client.get('/api/produtos', headers=A).get_json()['produtos'] if p['id'] == pid][0]
    assert prod['embalagem_nome'] == 'Caixa 5kg'
    assert prod['embalagem_valor'] == 2.5
    # remover o insumo -> o produto fica sem embalagem (NULL)
    assert client.delete(f'/api/insumos/{eid}', headers=A).status_code == 200
    prod = [p for p in client.get('/api/produtos', headers=A).get_json()['produtos'] if p['id'] == pid][0]
    assert prod['embalagem_nome'] is None


def test_insumo_exige_permissao_produtos(client):
    tok = api.serializer.dumps({'uid': 2, 'papel': 'leitura', 'permissoes': []})
    H = auth(tok)
    # sem permissão de produtos -> não cria insumo, mas pode LER
    assert client.post('/api/insumos', json={'nome': 'X', 'valor': 1, 'categoria': 'gelo'}, headers=H).status_code == 403
    assert client.get('/api/insumos', headers=H).status_code == 200


def test_tipo_insumo_afeta_custo_salvo(client):
    """Regressão do fix nº 1: escolher um tipo muda o custo salvo (caminho online)."""
    A = auth(token_admin(client))
    # Fixa o preço-padrão de gelo, para o teste não depender da ordem (outro teste
    # altera essa config no mesmo banco compartilhado).
    client.put('/api/configuracoes', json={'preco_gelo': 8.5}, headers=A)
    gid = client.post('/api/insumos', json={'nome': 'Gelo caro', 'valor': 20, 'categoria': 'gelo'},
                      headers=A).get_json()['insumo_id']
    base = {'produto': 'P', 'categoria': 'Mercado', 'preco': 10, 'peso_inicial': 100,
            'peso_final': 115, 'sacos_de_gelo': 2, 'caixa_papelao': 1}
    # sem tipo -> preço padrão (8,5) -> 2*8,5 = 17
    r = client.post('/api/calculos', json=base, headers=A).get_json()
    assert r['resultados']['custo_sacos_gelo'] == 17.0
    # com o tipo caro -> 2*20 = 40
    r = client.post('/api/calculos', json={**base, 'gelo_insumo_id': gid}, headers=A).get_json()
    assert r['resultados']['custo_sacos_gelo'] == 40.0


def test_admin_reseta_2fa(client):
    """Regressão do fix nº 3: o admin consegue resetar o 2FA de um usuário."""
    import pyotp
    A = auth(token_admin(client))
    client.post('/api/usuarios', json={'nome': 'R', 'email': 'r@x.com',
                'senha': 'segredo123', 'papel': 'leitura'}, headers=A)
    j = client.post('/api/login', json={'email': 'r@x.com', 'senha': 'segredo123'}).get_json()
    seg = api.db.obter_usuario_por_email('r@x.com')['totp_secret']
    client.post('/api/login/2fa', json={'pre_token': j['pre_token'], 'codigo': pyotp.TOTP(seg).now()})
    assert api.db.obter_usuario_por_email('r@x.com')['totp_confirmado'] == 1
    uid = api.db.obter_usuario_por_email('r@x.com')['id']
    # admin reseta
    assert client.post(f'/api/usuarios/{uid}/reset-2fa', headers=A).status_code == 200
    u = api.db.obter_usuario_por_email('r@x.com')
    assert u['totp_confirmado'] == 0 and u['totp_secret'] is None
    # próximo login volta a ser setup
    j2 = client.post('/api/login', json={'email': 'r@x.com', 'senha': 'segredo123'}).get_json()
    assert j2.get('needs_2fa_setup') is True


# --- Lotes -----------------------------------------------------------------

def _novo_produto(client, A, nome):
    client.post('/api/produtos', json={'nome': nome, 'preco_kg': 10}, headers=A)
    return [p for p in client.get('/api/produtos', headers=A).get_json()['produtos']
            if p['nome'] == nome][0]

def test_lote_crud_e_ordem_e_historico(client):
    A = auth(token_admin(client))
    pid = _novo_produto(client, A, 'Merluza Lote')['id']
    # dois lotes com validades diferentes
    assert client.post(f'/api/produtos/{pid}/lotes',
                       json={'codigo': 'L-B', 'validade': '2026-12-01', 'quantidade': 25}, headers=A).status_code == 201
    assert client.post(f'/api/produtos/{pid}/lotes',
                       json={'codigo': 'L-A', 'validade': '2026-10-01', 'quantidade': 40}, headers=A).status_code == 201
    lotes = client.get(f'/api/produtos/{pid}/lotes', headers=A).get_json()['lotes']
    # ordenado pela validade mais próxima primeiro
    assert [l['codigo'] for l in lotes] == ['L-A', 'L-B']
    # o evento de criação do lote entra no histórico do produto
    hist = client.get(f'/api/produtos/{pid}/historico', headers=A).get_json()['historico']
    assert any(h['campo'] == 'lote' for h in hist)
    # editar e remover
    lid = lotes[0]['id']
    assert client.put(f'/api/lotes/{lid}', json={'codigo': 'L-A2', 'validade': '2026-10-05', 'quantidade': 30}, headers=A).status_code == 200
    assert client.delete(f'/api/lotes/{lid}', headers=A).status_code == 200
    assert len(client.get(f'/api/produtos/{pid}/lotes', headers=A).get_json()['lotes']) == 1

def test_produto_traz_proxima_validade(client):
    A = auth(token_admin(client))
    pid = _novo_produto(client, A, 'Salmao Val')['id']
    client.post(f'/api/produtos/{pid}/lotes', json={'codigo': 'S1', 'validade': '2027-01-01'}, headers=A)
    prod = [p for p in client.get('/api/produtos', headers=A).get_json()['produtos'] if p['id'] == pid][0]
    assert prod['proxima_validade'] == '2027-01-01'
    assert prod['num_lotes'] == 1

def test_lote_exige_permissao_produtos(client):
    A = auth(token_admin(client))
    pid = _novo_produto(client, A, 'Panga Perm')['id']
    tok = api.serializer.dumps({'uid': 2, 'papel': 'leitura', 'permissoes': []})
    H = auth(tok)
    assert client.post(f'/api/produtos/{pid}/lotes', json={'codigo': 'X', 'validade': '2026-01-01'}, headers=H).status_code == 403
    assert client.get(f'/api/produtos/{pid}/lotes', headers=H).status_code == 200

def test_tabelas_mortas_removidas(client):
    import sqlite3
    con = sqlite3.connect(api.db.db_path)
    tabs = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    con.close()
    assert 'historico_precos' not in tabs
    assert 'historico_validades' not in tabs
    assert 'lotes' in tabs
