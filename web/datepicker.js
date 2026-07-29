// IIFE: isola o escopo deste arquivo. So a API abaixo (window.*) e publica.
(function () {
// ===========================================================================
// DATEPICKER CUSTOMIZADO
// ---------------------------------------------------------------------------
// Ideia central (leia isto antes do codigo):
//
//   O <input type="date"> continua existindo e continua sendo a FONTE DA
//   VERDADE do dado. O .value dele fica SEMPRE no formato ISO "YYYY-MM-DD",
//   que e exatamente o que o resto do sistema (salvarPerfil, filtros, etc.)
//   le e grava. Nos NAO trocamos o dado; nos trocamos apenas o CALENDARIO
//   que aparece na tela.
//
//   Fluxo:
//     input (dado ISO)  <-- fonte da verdade, nunca some do DOM
//        |  o usuario clica
//        v
//     popup customizado (so visual) -- desenhado por nos
//        |  usuario escolhe um dia
//        v
//     escrevemos input.value = "YYYY-MM-DD" e disparamos o evento 'input'
//     (pra quem escuta, como os filtros, reagir igualzinho ao nativo)
// ===========================================================================


// ---------------------------------------------------------------------------
// HELPERS (funcoes puras pequenas: entram numeros, saem strings/objetos)
// ---------------------------------------------------------------------------

// Garante 2 digitos: 7 -> "07". O picker mostra 07/34, o ISO precisa de "07".
function pad2(numero) {
    return String(numero).padStart(2, '0'); // padStart preenche a esquerda com '0'
}

// Monta a string ISO a partir de ano, mes (0-11) e dia.
// ATENCAO ao mes: no JavaScript o mes do objeto Date e 0-based (janeiro = 0),
// mas no texto ISO janeiro = "01". Por isso somamos +1 aqui.
function paraISO(ano, mesIndice, dia) {
    return `${ano}-${pad2(mesIndice + 1)}-${pad2(dia)}`;
}

// Le uma string ISO "YYYY-MM-DD" e devolve um objeto {ano, mes, dia}
// com mes ja convertido pra 0-based (pronto pra usar com new Date()).
// Se a string for vazia ou invalida, devolve null (tratamento de erro).
function lerISO(texto) {
    if (!texto) return null;                       // '' ou undefined -> sem data
    const partes = texto.split('-');               // "2034-07-15" -> ["2034","07","15"]
    if (partes.length !== 3) return null;          // formato inesperado -> ignora
    const ano = Number(partes[0]);
    const mes = Number(partes[1]) - 1;             // "07" -> 6 (0-based)
    const dia = Number(partes[2]);
    if (Number.isNaN(ano) || Number.isNaN(mes) || Number.isNaN(dia)) return null;
    return { ano, mes, dia };
}

// Nomes fixos pra UI (sem acento nas variaveis, com acento so no texto exibido).
const NOMES_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                     'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const NOMES_MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
                            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const NOMES_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];


// ---------------------------------------------------------------------------
// COMPONENTE: initDatePicker(input)
// Recebe UM <input type="date"> e o transforma num campo com calendario proprio.
// E "reutilizavel": chamamos uma vez pra cada campo que a gente quer.
// ---------------------------------------------------------------------------
function initDatePicker(input) {
    // Guarda de seguranca: se o elemento nao existe (getElementById deu null)
    // ou ja foi inicializado, nao faz nada. Evita erro e duplicacao.
    if (!input || input.dataset.dpInit === '1') return;
    input.dataset.dpInit = '1'; // marca como "ja inicializado"

    // 1) DIGITACAO LIBERADA: o input continua sendo type="date" nativo, entao o
    //    usuario pode DIGITAR a data direto no campo — o navegador ja valida e
    //    escreve o ISO no .value, disparando 'input'/'change' sozinho. Por isso
    //    NAO usamos mais readOnly. O calendario customizado abre pelo ICONE (e
    //    nao ao clicar no campo), pra nao atrapalhar quem quer digitar.

    // 2) WRAPPER: embrulha o input numa div com position:relative, pra que o
    //    popup (position:absolute) apareca colado embaixo do campo certo.
    const wrapper = document.createElement('div');
    wrapper.className = 'dp-wrapper';
    input.parentNode.insertBefore(wrapper, input); // coloca a div no lugar do input
    wrapper.appendChild(input);                    // e move o input pra dentro dela

    // 3) ICONE de calendario (so enfeite visual, dentro do wrapper).
    const icone = document.createElement('i');
    icone.className = 'fas fa-calendar-days dp-icone';
    icone.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(icone);

    // 4) POPUP: a div que vai conter o calendario. Comeca escondida.
    const popup = document.createElement('div');
    popup.className = 'dp-popup';
    popup.hidden = true; // 'hidden' = nao aparece e nem ocupa espaco
    wrapper.appendChild(popup);

    // --- ESTADO INTERNO do calendario -------------------------------------
    // Qual mes/ano estamos VISUALIZANDO agora (nao e o dia escolhido, e so a
    // "pagina" atual do calendario). Comeca no valor do input, ou em hoje.
    let visto = lerISO(input.value) || (function () {
        const hoje = new Date();
        return { ano: hoje.getFullYear(), mes: hoje.getMonth(), dia: hoje.getDate() };
    })();
    let modo = 'dias'; // 'dias' = grade de dias; 'meses' = grade de meses (igual a imagem)

    // -----------------------------------------------------------------------
    // desenhar(): (re)constroi o conteudo do popup conforme o 'modo' e 'visto'.
    // Chamamos toda vez que muda mes, muda ano ou troca de modo.
    // -----------------------------------------------------------------------
    function desenhar() {
        popup.innerHTML = ''; // limpa o que estava antes (jeito simples e claro)

        if (modo === 'dias') {
            desenharCabecalho(NOMES_MESES_LONGOS[visto.mes] + ' ' + visto.ano);
            desenharGradeDias();
        } else {
            desenharCabecalho(String(visto.ano)); // no modo meses o titulo e so o ANO
            desenharGradeMeses();
        }
    }

    // Cabecalho com as setas ‹ › e o titulo clicavel (dia<->mes).
    function desenharCabecalho(titulo) {
        const cab = document.createElement('div');
        cab.className = 'dp-cabecalho';

        const btnPrev = document.createElement('button');
        btnPrev.type = 'button';         // type=button pra NAO dar submit no form!
        btnPrev.className = 'dp-nav';
        btnPrev.innerHTML = '&lsaquo;';  // seta ‹
        btnPrev.addEventListener('click', () => passo(-1));

        const btnTitulo = document.createElement('button');
        btnTitulo.type = 'button';
        btnTitulo.className = 'dp-titulo';
        btnTitulo.textContent = titulo;
        // Clicar no titulo alterna entre ver dias e ver a grade de meses.
        btnTitulo.addEventListener('click', () => {
            modo = (modo === 'dias') ? 'meses' : 'dias';
            desenhar();
        });

        const btnNext = document.createElement('button');
        btnNext.type = 'button';
        btnNext.className = 'dp-nav';
        btnNext.innerHTML = '&rsaquo;';  // seta ›
        btnNext.addEventListener('click', () => passo(1));

        cab.append(btnPrev, btnTitulo, btnNext);
        popup.appendChild(cab);
    }

    // passo(direcao): avanca/volta. No modo 'dias' mexe no MES; no 'meses', no ANO.
    function passo(direcao) {
        if (modo === 'dias') {
            visto.mes += direcao;          // ex.: julho -> agosto
            if (visto.mes < 0) { visto.mes = 11; visto.ano--; }   // passou de janeiro
            if (visto.mes > 11) { visto.mes = 0; visto.ano++; }   // passou de dezembro
        } else {
            visto.ano += direcao;          // no modo meses a seta muda o ano
        }
        desenhar();
    }

    // Grade dos DIAS (o calendario de verdade).
    function desenharGradeDias() {
        const grade = document.createElement('div');
        grade.className = 'dp-grade dp-grade-dias';

        // Cabecalho dos dias da semana (dom, seg, ...).
        NOMES_DIAS.forEach(nome => {
            const celula = document.createElement('span');
            celula.className = 'dp-dow'; // dow = day of week
            celula.textContent = nome;
            grade.appendChild(celula);
        });

        // new Date(ano, mes, 1).getDay() -> em que dia da semana o mes comeca (0=dom).
        // Usamos isso pra empurrar o dia 1 pra coluna certa com celulas vazias.
        const primeiroDiaSemana = new Date(visto.ano, visto.mes, 1).getDay();

        // new Date(ano, mes+1, 0).getDate() -> ultimo dia do mes.
        // Truque classico: "dia 0" do mes seguinte = ultimo dia do mes atual.
        const totalDias = new Date(visto.ano, visto.mes + 1, 0).getDate();

        // Espacos em branco antes do dia 1.
        for (let i = 0; i < primeiroDiaSemana; i++) {
            const vazio = document.createElement('span');
            vazio.className = 'dp-dia dp-vazio';
            grade.appendChild(vazio);
        }

        // Qual dia esta selecionado hoje no input (pra destacar).
        const selecionado = lerISO(input.value);
        const hoje = new Date();

        // Os dias clicaveis, de 1 ate totalDias.
        for (let dia = 1; dia <= totalDias; dia++) {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'dp-dia';
            botao.textContent = dia;

            // Destaque do dia ja escolhido.
            if (selecionado &&
                selecionado.ano === visto.ano &&
                selecionado.mes === visto.mes &&
                selecionado.dia === dia) {
                botao.classList.add('dp-selecionado');
            }
            // Marca "hoje" com um contorno leve.
            if (hoje.getFullYear() === visto.ano &&
                hoje.getMonth() === visto.mes &&
                hoje.getDate() === dia) {
                botao.classList.add('dp-hoje');
            }

            // AQUI mora o contrato: ao clicar, escrevemos ISO no input.
            botao.addEventListener('click', () => escolherData(visto.ano, visto.mes, dia));
            grade.appendChild(botao);
        }

        popup.appendChild(grade);
    }

    // Grade dos MESES (igual a imagem: jan fev mar / abr mai jun / ...).
    function desenharGradeMeses() {
        const grade = document.createElement('div');
        grade.className = 'dp-grade dp-grade-meses';
        NOMES_MESES.forEach((nome, indice) => {
            const botao = document.createElement('button');
            botao.type = 'button';
            botao.className = 'dp-mes';
            botao.textContent = nome;
            if (indice === visto.mes) botao.classList.add('dp-selecionado');
            botao.addEventListener('click', () => {
                visto.mes = indice; // escolheu o mes...
                modo = 'dias';      // ...e volta pra escolher o DIA
                desenhar();
            });
            grade.appendChild(botao);
        });
        popup.appendChild(grade);
    }

    // -----------------------------------------------------------------------
    // escolherData(): o momento em que o dado muda de verdade.
    // -----------------------------------------------------------------------
    function escolherData(ano, mes, dia) {
        input.value = paraISO(ano, mes, dia); // <-- ISO no input (fonte da verdade)

        // DISPARA o evento 'input' manualmente. Por que?
        // Porque atribuir input.value por codigo NAO dispara evento sozinho, e
        // os filtros do historico escutam 'input' (script.js linha ~85). Sem
        // isto, o filtro nao reagiria ao clique no calendario.
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        fechar(); // some com o popup depois de escolher
    }

    // -----------------------------------------------------------------------
    // ABRIR / FECHAR
    // -----------------------------------------------------------------------
    function abrir() {
        // Ao abrir, sincroniza a "pagina" com o valor atual do input (se houver).
        visto = lerISO(input.value) || visto;
        modo = 'dias';
        desenhar();
        popup.hidden = false;
        wrapper.classList.add('dp-aberto');
        // Dentro de containers com rolagem (ex.: o modal de produto no celular),
        // garante que o calendario apareca inteiro. 'nearest' rola o minimo
        // necessario e nao mexe se ja estiver visivel.
        try { popup.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignora */ }
    }

    function fechar() {
        popup.hidden = true;
        wrapper.classList.remove('dp-aberto');
    }

    // O calendario abre/fecha pelo ICONE. O campo fica livre para digitar.
    function alternar() {
        if (popup.hidden) abrir(); else fechar();
    }
    icone.addEventListener('click', alternar);

    // BUG FIX: cliques DENTRO do popup (setas, titulo, mes) nao podem "vazar"
    // ate o listener de "clique fora". Como o desenhar() recria o conteudo do
    // popup, o elemento clicado sai do DOM e o wrapper.contains() daria false,
    // fechando o popup a cada clique. stopPropagation resolve isso.
    popup.addEventListener('click', (evento) => evento.stopPropagation());

    // Fecha ao clicar FORA do wrapper. Usamos 'mousedown' (nao 'click') de
    // proposito: assim olhamos ONDE o clique COMECOU. Se o usuario comecar uma
    // selecao de texto DENTRO do wrapper e arrastar/soltar FORA, nao fecha —
    // porque o mousedown iniciou dentro. (Com 'click', o alvo seria o ponto de
    // soltura, fechando o popup no meio da selecao.)
    document.addEventListener('mousedown', (evento) => {
        if (!wrapper.contains(evento.target)) fechar();
    });

    // Tecla Esc fecha (acessibilidade / conveniencia).
    document.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape') fechar();
    });
}


// ---------------------------------------------------------------------------
// INICIALIZACAO
// Quando o HTML termina de carregar, procura TODOS os <input type="date"> da
// pagina e liga o picker em cada um. Assim, se voce adicionar outro campo de
// data no futuro, ele ja ganha o calendario customizado automaticamente.
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
    const campos = document.querySelectorAll('input[type="date"]');
    campos.forEach(initDatePicker);
});

// --- API publica (reusada por melhorias.js) ---
window.pad2 = pad2;
window.lerISO = lerISO;
})();
