// IIFE: isola o escopo deste arquivo. So a API abaixo (window.*) e publica.
(function () {
// ===========================================================================
// MENU HUD DE NAVEGACAO
// ---------------------------------------------------------------------------
// O header tinha uma barra fixa com todas as abas, e o rodape repetia parte
// dela. Trocamos por um HUD: um botao mostra a aba ATUAL e, ao clicar, abre a
// lista de abas. A troca de aba em si continua a cargo do script.js
// (switchTab, disparado pelos .nav-btn[data-tab]); aqui so cuidamos de abrir,
// fechar e manter o rotulo do botao sincronizado.
// ===========================================================================

function initMenuHud() {
    const toggle = document.getElementById('hudToggle');
    const menu = document.getElementById('hudMenu');
    if (!toggle || !menu) return; // pagina sem HUD -> nao faz nada

    // Mapa: id da aba -> como exibir no botao (rotulo + icone Font Awesome).
    const MAPA = {
        calculator: { rotulo: 'Calculadora',   icone: 'fa-calculator' },
        history:    { rotulo: 'Histórico',      icone: 'fa-history' },
        produtos:   { rotulo: 'Produtos',       icone: 'fa-fish' },
        config:     { rotulo: 'Configurações',  icone: 'fa-gear' },
    };

    function abrir() {
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.classList.add('aberto'); // gira a setinha via CSS
    }
    function fechar() {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.classList.remove('aberto');
    }
    function alternar() {
        if (menu.hidden) abrir(); else fechar();
    }

    // Le qual aba esta ativa AGORA e escreve o rotulo no botao.
    // Fonte da verdade: a .tab-content.active (id tipo "history-tab").
    function sincronizarRotulo() {
        const ativa = document.querySelector('.tab-content.active');
        const alvo = document.getElementById('hudCurrent');
        if (!ativa || !alvo) return;
        const tabId = ativa.id.replace('-tab', ''); // "history-tab" -> "history"
        const info = MAPA[tabId];
        if (info) {
            alvo.innerHTML = `<i class="fas ${info.icone}" aria-hidden="true"></i> ${info.rotulo}`;
        }
    }

    // Clique no botao: garante o rotulo certo e abre/fecha.
    // stopPropagation e ESSENCIAL: sem ele, este mesmo clique subiria ate o
    // listener de "clique fora" (no document) e fecharia o menu logo apos abrir.
    toggle.addEventListener('click', function (evento) {
        evento.stopPropagation();
        sincronizarRotulo();
        alternar();
    });

    // Clique numa aba: o switchTab (script.js) ja troca o conteudo; aqui so
    // atualizamos o rotulo (no proximo tick, depois do switchTab rodar) e
    // fechamos o menu.
    menu.querySelectorAll('.nav-btn[data-tab]').forEach(function (botao) {
        botao.addEventListener('click', function () {
            setTimeout(sincronizarRotulo, 0);
            fechar();
        });
    });

    // "Sair" nao troca de aba, mas tambem deve fechar o menu.
    const btnSair = document.getElementById('btnLogout');
    if (btnSair) btnSair.addEventListener('click', fechar);

    // Fecha ao clicar FORA do HUD.
    document.addEventListener('click', function (evento) {
        if (!evento.target.closest('.nav-hud')) fechar();
    });
    // Fecha com a tecla Esc.
    document.addEventListener('keydown', function (evento) {
        if (evento.key === 'Escape') fechar();
    });

    // Logo clicavel: volta para a aba Calculadora. Como o switchTab (script.js)
    // nao avisa o HUD, sincronizamos o rotulo aqui tambem.
    const logo = document.getElementById('logoHome');
    if (logo) {
        function irParaCalculadora() {
            if (typeof switchTab === 'function') switchTab('calculator');
            sincronizarRotulo();
            fechar();
        }
        logo.addEventListener('click', irParaCalculadora);
        // Acessibilidade: Enter ou Espaco tambem ativam (o logo e role="button").
        logo.addEventListener('keydown', function (evento) {
            if (evento.key === 'Enter' || evento.key === ' ') {
                evento.preventDefault();
                irParaCalculadora();
            }
        });
    }

    sincronizarRotulo(); // estado inicial (aba Calculadora)
}

document.addEventListener('DOMContentLoaded', initMenuHud);

// (sem API publica: tudo interno)
})();
