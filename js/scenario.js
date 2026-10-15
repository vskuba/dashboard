// Страница «Сценарии»: что браузер делает на чужом сайте, шагами.
//
// ⚠⚠ Форма шага строится по справочнику С СЕРВЕРА (`result.actions`), а не по
// списку действий здесь. Список закрыт схемой слоя, и вторая копия разошлась бы
// с ней в день, когда в схему добавят действие, — причём молча: страница
// показывала бы поле, которого схема не ждёт, а сохранение падало бы отказом,
// непонятным человеку.
//
// ⚠ Правка идёт в памяти и уходит на сервер ЦЕЛИКОМ, одним сценарием. Шаг —
// не самостоятельная запись: порядок шагов и есть сценарий, и сохранять их по
// одному значило бы допускать состояние «третий шаг сохранён, второй нет».
//
// ⚠ Площадка в шапке задаёт всю страницу: её сценарии, её переменные. Смена
// перерисовывает колонки целиком, а не докладывает к ним чужое.

import {getData, postData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {el} from '/static/js/page_dom.js';

const STATUS_LABEL = {draft: 'черновик', active: 'в работе', broken: 'сломан'};

// Каким действием заводится новый шаг. ⚠ Не первое из справочника: тот
// отсортирован по алфавиту, и новый шаг выходил бы `assert_text` — проверкой,
// с которой сценарии не начинают. Переход открывает почти каждый.
const STEP_DEFAULT = 'goto';

// Чем помечена переменная в шаге. ⚠ Тот же вид, что у слоя
// (`BROWSER_SCENARIO_VAR_RE`): буквы, цифры, подчёркивание. Шире нельзя —
// фигурные скобки встречаются и сами по себе, в CSS-селекторах и JSON.
const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// В каких полях шага ищем переменные. ⚠ Не во всех подряд: `fields` — список
// записей, и строковый поиск по нему дал бы имена из чужой разметки.
const VAR_FIELDS = ['url', 'selector', 'value', 'key', 'name'];

// Где лежит выбранная площадка. В localStorage, а не в сессии: выбор — свойство
// этой машины и этой вкладки человека, серверу он не нужен ни для чего.
const SITE_KEY = 'panel_scenario_site';

const listBox = document.getElementById('scnList');
const varsBox = document.getElementById('scnVars');
const editorBox = document.getElementById('scnEditor');
const siteSel = document.getElementById('scnSite');
const siteBox = document.getElementById('scnSiteBox');

// Снимок страницы: справочник действий, состояния, площадки. Заполняется
// ответом сервера — здесь только то, что уже пришло.
let actions = [];
let statuses = [];
let site = 0;

// Имена переменных площадки. ⚠ Держим отдельно от их значений: секретные
// приходят под маской, и значение нам здесь не нужно — нужен ответ «подставит
// ли сервер эту переменную сам».
let siteVarNames = [];

// Сценарий, открытый в правой колонке. ⚠ Копия, а не ссылка на строку списка:
// человек правит шаги и может уйти, не сохранив, — список при этом обязан
// показывать то, что лежит на сервере.
let draft = null;

// Какой шаг показан в колонке настроек. ⚠ Номер, а не ссылка на объект: шаги
// переставляют и удаляют, и ссылка пережила бы свой шаг, показывая настройки
// того, кого уже нет.
let stepAt = 0;

// Какая подвкладка открыта: «шаги» или «граф». ⚠ Живёт между перерисовками:
// правка поля перерисовывает редактор целиком, и без памяти человека
// выбрасывало бы из графа на каждом нажатии клавиши.
let pane = 'steps';

document.getElementById('scnNew').onclick = () => openDraft(null);
document.getElementById('scnVarAdd').onsubmit = saveVariable;
siteSel.onchange = () => {
    localStorage.setItem(SITE_KEY, siteSel.value);
    load(siteSel.value);
};

load(localStorage.getItem(SITE_KEY) || 0);


// Снимок страницы одной площадки.
//
// ⚠ Показанную площадку называет сервер (`result.site_id`), а не этот запрос:
// сохранённой в прошлый раз могло уже не быть, и селект обязан показать ту, что
// нарисована на деле.
async function load(wanted) {
    try {
        const {result} = await getData(`/api/scenario?site_id=${Number(wanted) || 0}`);
        site = Number(result.site_id) || 0;
        actions = result.actions || [];
        statuses = result.statuses || [];
        renderSites(result.sites);
        renderList(result.scenarios);
        renderVars(result.variables);
    } catch (e) {
        listBox.innerHTML = '';
        listBox.appendChild(el('div', 'scn-empty', 'Ошибка загрузки'));
        console.error('Сценарии:', e);
    }
}

// ── шапка: выбор площадки ──────────────────────────────────────────────────

// ⚠ Нет площадок — селект прячется целиком, а не стоит пустым. У установки без
// магазинов сценарии общие, и выбор там не из чего делать.
function renderSites(sites) {
    siteBox.hidden = !(sites || []).length;
    siteSel.innerHTML = '';
    (sites || []).forEach(row => {
        const opt = document.createElement('option');
        opt.value = row.id;
        opt.textContent = row.name;
        opt.selected = Number(row.id) === site;
        siteSel.appendChild(opt);
    });
}

// ── левая колонка: сценарии и переменные ───────────────────────────────────

function renderList(rows) {
    listBox.innerHTML = '';
    if (!(rows || []).length) {
        listBox.appendChild(el('div', 'scn-empty', 'сценариев пока нет'));
        return;
    }

    rows.forEach(row => {
        const item = el('div', 'scn-item' + (draft && draft.id === row.id ? ' active' : ''));
        const head = el('div', 'scn-item-head');
        head.appendChild(el('span', 'scn-item-name', row.name));
        head.appendChild(el('span', `scn-status scn-status-${row.status}`,
                            STATUS_LABEL[row.status] || row.status));
        item.appendChild(head);
        if (row.goal) item.appendChild(el('div', 'scn-item-goal', row.goal));
        item.onclick = () => openScenario(row.id);
        listBox.appendChild(item);
    });
}

function renderVars(rows) {
    varsBox.innerHTML = '';
    // ⚠ Имена запоминаются здесь, а не считаются в колонке переменных: та
    // перерисовывается на каждое нажатие клавиши, и ходить за ними заново
    // значило бы считать одно и то же сотни раз за минуту правки.
    siteVarNames = (rows || []).map(row => row.name);
    if (!site) {
        varsBox.appendChild(el('div', 'scn-empty', 'переменные у площадки'));
        return;
    }
    if (!(rows || []).length) {
        varsBox.appendChild(el('div', 'scn-empty', 'переменных нет'));
        return;
    }

    rows.forEach(row => {
        const line = el('div', 'scn-var');
        line.appendChild(el('span', 'scn-var-name',
                            (row.is_secret ? '🔒 ' : '') + row.name));
        // ⚠ Секрет приходит под маской — всегда. Показывать нечего, и это не
        // недоделка: сырое значение отдаётся только прогону.
        line.appendChild(el('span', 'scn-var-value', row.value || '—'));
        const bin = el('button', 'scn-drop', '🗑');
        bin.type = 'button';
        bin.title = 'убрать переменную';
        bin.onclick = () => dropVariable(row);
        line.appendChild(bin);
        varsBox.appendChild(line);
    });
}

async function saveVariable(event) {
    event.preventDefault();
    const name = document.getElementById('scnVarName');
    const value = document.getElementById('scnVarValue');
    const secret = document.getElementById('scnVarSecret');
    if (!site) {
        showNotification('Сначала выберите площадку', 'error');
        return;
    }

    try {
        const {result} = await postData('/api/scenario/variable', {
            site_id: site, name: name.value, value: value.value,
            is_secret: secret.checked,
        });
        name.value = '';
        value.value = '';
        secret.checked = false;
        renderVars(result);
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    }
}

async function dropVariable(row) {
    if (!confirm(`Убрать переменную «${row.name}»?`)) return;

    try {
        await postData('/api/scenario/variable/remove', {id: row.id});
        await load(site);
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    }
}

// ── правая колонка: редактор ───────────────────────────────────────────────

async function openScenario(id) {
    try {
        const {result} = await getData(`/api/scenario/${id}`);
        openDraft(result);
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    }
}

// Новый сценарий или открытый существующий. ⚠ Шаги копируются, а не берутся
// ссылкой: правка в редакторе не должна менять список слева до сохранения.
function openDraft(row) {
    draft = row
        ? {...row, steps: JSON.parse(JSON.stringify(row.steps || []))}
        : {id: 0, name: '', goal: '', start_url: '', status: 'draft', steps: [],
           variables: {}, runs: []};
    renderEditor();
}

function renderEditor() {
    editorBox.innerHTML = '';
    if (!draft) {
        editorBox.appendChild(el('div', 'scn-empty',
                                 'Выберите сценарий слева или заведите новый'));
        return;
    }

    editorBox.appendChild(editorHead());
    editorBox.appendChild(editorTabs());
    editorBox.appendChild(pane === 'graph' ? graphBox() : stepsPane());
    editorBox.appendChild(editorButtons());
    if (draft.runs && draft.runs.length) editorBox.appendChild(runsBox(draft.runs));
}

// Две подвкладки: «Шаги» — что правим, «Граф» — что получится.
//
// ⚠⚠ Это разные вопросы, а не два вида одного. В шагах человек правит селектор
// и значение; в графе он смотрит, откуда куда идёт работа и какая переменная
// в каком шаге всплывает. Второе по списку из тридцати строк не читается.
function editorTabs() {
    const box = el('div', 'scn-subtabs');
    [['steps', '👣 Шаги'], ['graph', '🕸 Граф']].forEach(([code, title]) => {
        const btn = el('button', 'scn-subtab' + (pane === code ? ' on' : ''), title);
        btn.type = 'button';
        btn.onclick = () => { pane = code; renderEditor(); };
        box.appendChild(btn);
    });

    return box;
}

// Подвкладка «Шаги»: переменные | список | настройки выбранного.
//
// ⚠⚠ Три колонки, а не лента карточек. Лента тратила ширину впустую: поля шага
// занимали треть экрана, остальное пустовало, и чтобы увидеть десятый шаг,
// приходилось прокручивать мимо девяти развёрнутых. Теперь список шагов виден
// целиком, а правится тот, на который нажали.
function stepsPane() {
    const box = el('div', 'scn-panes');
    box.appendChild(varsPane());
    box.appendChild(stepsList());
    box.appendChild(stepCard());

    return box;
}

function editorHead() {
    const box = el('div', 'scn-form');
    box.appendChild(field('Имя', 'name', 'как звать в карточке заказа'));
    box.appendChild(field('Зачем', 'goal', 'что этот сценарий делает'));
    box.appendChild(field('Начальный адрес', 'start_url', 'https://…'));

    const line = el('div', 'scn-field');
    line.appendChild(el('label', null, 'Состояние'));
    const select = document.createElement('select');
    statuses.forEach(code => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = STATUS_LABEL[code] || code;
        opt.selected = code === draft.status;
        select.appendChild(opt);
    });
    select.onchange = () => { draft.status = select.value; };
    line.appendChild(select);
    box.appendChild(line);
    box.appendChild(paceField());

    return box;
}

// Темп: пауза между шагами, случайная в этих пределах.
//
// ⚠⚠ Сайту виден РИТМ. Браузер без пауз делает десяток действий в секунду —
// человек так не умеет, и для защиты это примета заметнее любого заголовка:
// отпечаток подделывается заголовками, ритм — нет.
//
// ⚠ Свойство сценария, а не площадки: разведка должна идти быстро —
// правдоподобие там никому не нужно, — а оформление заказа обязано выглядеть
// живым. Это разные сценарии на одной площадке.
function paceField() {
    const line = el('div', 'scn-field scn-field-pace');
    line.appendChild(el('label', null, 'Темп, мс'));

    const box = el('div', 'scn-pace');
    ['pace_min_ms', 'pace_max_ms'].forEach((key, at) => {
        if (at) box.appendChild(el('span', 'scn-pace-dash', '…'));
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '60000';
        input.className = 'scn-pace-input';
        input.value = draft[key] === undefined ? '' : draft[key];
        input.title = at ? 'верхняя граница паузы' : 'нижняя граница паузы';
        input.oninput = () => { draft[key] = Number(input.value) || 0; };
        box.appendChild(input);
    });
    // ⚠ Подпись обязательна: два числа без неё читаются как что угодно, а ноль
    // в обоих — законное значение «без пауз», и человек должен знать, что оно
    // значит, не открывая документацию.
    box.appendChild(el('span', 'scn-pace-note', 'пауза перед шагом; 0 — без пауз'));
    line.appendChild(box);

    return line;
}

function field(title, key, placeholder) {
    const line = el('div', 'scn-field');
    line.appendChild(el('label', null, title));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = draft[key] || '';
    input.placeholder = placeholder || '';
    input.oninput = () => { draft[key] = input.value; };
    line.appendChild(input);

    return line;
}

// ── колонка 1: переменные и куда они идут ──────────────────────────────────

// Какие переменные сценарий поминает и в каких шагах. ⚠ Читаются ИЗ ШАГОВ, а
// не из отдельного списка: список пришлось бы вести руками, и он расходился бы
// с шагами в первую же правку — причём молча.
function varsUsed() {
    const found = new Map();
    (draft.steps || []).forEach((step, at) => {
        VAR_FIELDS.forEach(name => {
            const text = String(step[name] === undefined ? '' : step[name]);
            for (const hit of text.matchAll(VAR_RE)) {
                const key = hit[1];
                if (!found.has(key)) found.set(key, []);
                const rows = found.get(key);
                if (!rows.includes(at)) rows.push(at);
            }
        });
    });

    return found;
}

function varsPane() {
    const box = el('div', 'scn-pane scn-pane-vars');
    box.appendChild(el('div', 'scn-pane-name', '🔑 Переменные'));

    const used = varsUsed();
    if (!used.size) {
        box.appendChild(el('div', 'scn-empty',
            'Сценарий не поминает ни одной переменной. Напишите {{phone}} в '
            + 'поле шага — она появится здесь.'));
        return box;
    }

    // ⚠ Переменная площадки отмечена: её значение подставит сервер, остальные
    // обязан передать тот, кто запускает, — и перепутать эти два случая значит
    // получить отказ «не переданы переменные» уже на прогоне.
    const known = new Set((draft.variables ? Object.keys(draft.variables) : [])
        .concat(siteVarNames));

    [...used.entries()].forEach(([name, rows]) => {
        const one = el('div', 'scn-var-used');
        const head = el('div', 'scn-var-head');
        head.appendChild(el('b', null, `{{${name}}}`));
        if (known.has(name)) {
            head.appendChild(el('span', 'scn-var-mark', 'площадки'));
        }
        one.appendChild(head);
        // Куда идёт: номера шагов. Щелчок открывает шаг — это и есть ответ на
        // вопрос «а где она используется».
        const where = el('div', 'scn-var-steps');
        rows.forEach(at => {
            const link = el('button', 'scn-var-step', `${at + 1}`);
            link.type = 'button';
            link.title = (draft.steps[at] || {}).action || '';
            link.onclick = () => { stepAt = at; renderEditor(); };
            where.appendChild(link);
        });
        one.appendChild(where);
        box.appendChild(one);
    });

    return box;
}

// ── колонка 2: список шагов ────────────────────────────────────────────────

// Коротко о шаге: что делает и над чем. ⚠ Без этого список — столбик из
// «fill, fill, fill», по которому нужный шаг не найти.
function stepShort(step) {
    const spec = actions.find(one => one.action === step.action);
    const first = (spec ? spec.fields : []).find(
        name => name !== 'fields' && step[name]);

    return first ? String(step[first]).slice(0, 48) : '';
}

function stepsList() {
    const box = el('div', 'scn-pane scn-pane-steps');
    box.appendChild(el('div', 'scn-pane-name', '👣 Шаги'));

    const list = el('div', 'scn-list-steps');
    (draft.steps || []).forEach((step, at) => {
        const row = el('button', 'scn-line' + (at === stepAt ? ' on' : ''), '');
        row.type = 'button';
        row.appendChild(el('span', 'scn-line-no', `${at + 1}`));
        row.appendChild(el('span', 'scn-line-act', step.action));
        const short = stepShort(step);
        if (short) row.appendChild(el('span', 'scn-line-what', short));
        // Отметки значками: они важны для понимания хода и должны читаться из
        // списка, не открывая шаг.
        if (step.shot) row.appendChild(el('span', 'scn-line-mark', '📷'));
        if (step.submit) row.appendChild(el('span', 'scn-line-mark', '⏎'));
        row.onclick = () => { stepAt = at; renderEditor(); };
        list.appendChild(row);
    });
    box.appendChild(list);

    const add = el('button', 'scn-btn scn-step-add', '+ шаг');
    add.type = 'button';
    add.onclick = () => {
        draft.steps.push({action: STEP_DEFAULT});
        stepAt = draft.steps.length - 1;
        renderEditor();
    };
    box.appendChild(add);

    return box;
}

// ── колонка 3: настройки выбранного шага ───────────────────────────────────

function stepCard() {
    const box = el('div', 'scn-pane scn-pane-card');
    const steps = draft.steps || [];
    // ⚠ Номер подрезается здесь, а не при удалении: шаг могли убрать, и
    // `stepAt` пережил бы его, показывая пустоту либо чужие настройки.
    if (stepAt >= steps.length) stepAt = Math.max(0, steps.length - 1);

    if (!steps.length) {
        box.appendChild(el('div', 'scn-pane-name', '⚙️ Шаг'));
        box.appendChild(el('div', 'scn-empty', 'Шагов пока нет — заведите первый'));
        return box;
    }

    box.appendChild(el('div', 'scn-pane-name', `⚙️ Шаг ${stepAt + 1}`));
    box.appendChild(stepRow(steps[stepAt], stepAt));

    return box;
}

// ── подвкладка «Граф»: откуда куда идёт работа ─────────────────────────────

// Что за шаг по смыслу: от этого зависит, каким он нарисован. ⚠ Не ради
// красоты: в цепочке из тридцати узлов глаз ищет переходы и отправку, а
// заполнение полей читает как фон.
const GRAPH_KIND = {
    goto: 'move', wait_url: 'move',
    click: 'act', hover: 'act', press: 'act', select: 'act', scroll: 'act',
    fill: 'input', type: 'input', upload: 'input',
    wait_for: 'wait', wait_ms: 'wait', wait_stable: 'wait', wait_text: 'wait',
    extract: 'take', extract_rows: 'take', read_text: 'take',
    net_dump: 'take', console_dump: 'take', download: 'take',
    assert_text: 'check',
};

// Граф сценария: цепочка узлов сверху вниз, переменные — подписями на узлах.
//
// ⚠⚠ Рисуется своей разметкой, а не библиотекой диаграмм. Страница панели не
// тянет ничего извне (та же причина, по которой здесь нет CDN), а цепочка без
// ветвлений — это список со стрелками: библиотека на полтораста килобайт
// рисовала бы ровно то же самое.
//
// ⚠ Сценарий линеен по построению: ветвлений в шагах нет вовсе
// (`BROWSER_SCENARIO_ACTIONS`), и рисовать их значило бы обещать то, чего
// сценарий не умеет.
function graphBox() {
    const box = el('div', 'scn-graph');
    const steps = draft.steps || [];
    if (!steps.length) {
        box.appendChild(el('div', 'scn-empty',
            'Шагов нет — граф появится, когда они будут'));
        return box;
    }

    const used = varsUsed();
    // Переменная → в каких шагах всплывает; здесь нужен обратный разворот:
    // шаг → какие переменные он поминает.
    const byStep = new Map();
    used.forEach((rows, name) => rows.forEach(at => {
        if (!byStep.has(at)) byStep.set(at, []);
        byStep.get(at).push(name);
    }));

    box.appendChild(graphStart());
    steps.forEach((step, at) => {
        box.appendChild(graphArrow());
        box.appendChild(graphNode(step, at, byStep.get(at) || []));
    });

    return box;
}

// Откуда всё начинается. ⚠ Узел «старт» нужен: без него первый шаг читается
// как продолжение чего-то, что было до — а до него не было ничего.
function graphStart() {
    const node = el('div', 'scn-node scn-node-start');
    node.appendChild(el('div', 'scn-node-act', '▶ старт'));
    if (draft.start_url) {
        node.appendChild(el('div', 'scn-node-what', draft.start_url));
    }

    return node;
}

function graphArrow() {
    return el('div', 'scn-arrow', '↓');
}

function graphNode(step, at, vars) {
    const kind = GRAPH_KIND[step.action] || 'act';
    const node = el('button', `scn-node kind-${kind}`
        + (at === stepAt ? ' on' : '') + (step.submit ? ' submit' : ''), '');
    node.type = 'button';
    // ⚠ Щелчок уводит в «Шаги» на этот шаг: граф отвечает на вопрос «где», и
    // естественное следующее движение — «покажи».
    node.onclick = () => { stepAt = at; pane = 'steps'; renderEditor(); };

    const head = el('div', 'scn-node-head');
    head.appendChild(el('span', 'scn-node-no', `${at + 1}`));
    head.appendChild(el('span', 'scn-node-act', step.action));
    if (step.shot) head.appendChild(el('span', 'scn-node-mark', '📷'));
    if (step.submit) head.appendChild(el('span', 'scn-node-mark', '⏎'));
    node.appendChild(head);

    const short = stepShort(step);
    if (short) node.appendChild(el('div', 'scn-node-what', short));

    // ⚠⚠ Переменные подписаны на том узле, где уходят в страницу. Отдельным
    // списком сбоку они отвечали бы «какие есть», а вопрос другой — «куда
    // попадает телефон покупателя».
    if (vars.length) {
        const line = el('div', 'scn-node-vars');
        vars.forEach(name => line.appendChild(
            el('span', 'scn-node-var', `{{${name}}}`)));
        node.appendChild(line);
    }

    return node;
}


// Один шаг: действие селектом, поля — те, что это действие требует.
//
// ⚠⚠ Поля берутся из справочника сервера по имени действия. Сменили действие —
// поля перерисовываются; чужие значения при этом остаются в объекте шага и
// уходят на сервер. Это осознанно: человек часто переключает `click` ↔ `hover`
// на том же селекторе, и терять его на каждом переключении значило бы заставить
// набирать заново.
function stepRow(step, at) {
    const row = el('div', 'scn-step');

    const head = el('div', 'scn-step-head');
    head.appendChild(el('span', 'scn-step-no', `${at + 1}`));

    const select = document.createElement('select');
    actions.forEach(one => {
        const opt = document.createElement('option');
        opt.value = one.action;
        opt.textContent = one.action;
        opt.selected = one.action === step.action;
        select.appendChild(opt);
    });
    select.onchange = () => { step.action = select.value; renderEditor(); };
    head.appendChild(select);

    head.appendChild(stepSubmit(step));
    head.appendChild(stepShot(step));
    head.appendChild(moveButton('↑', at, -1));
    head.appendChild(moveButton('↓', at, 1));

    const bin = el('button', 'scn-drop', '🗑');
    bin.type = 'button';
    bin.title = 'убрать шаг';
    bin.onclick = () => { draft.steps.splice(at, 1); renderEditor(); };
    head.appendChild(bin);
    row.appendChild(head);

    const spec = actions.find(one => one.action === step.action);
    (spec ? spec.fields : []).forEach(name => {
        row.appendChild(stepField(step, name));
    });

    return row;
}

// Отметка «этим шаг отправляет заказ». ⚠⚠ Без неё прогон не умеет
// останавливаться перед кнопкой: репетиция и отправка — один сценарий,
// делённый по этому признаку, и сценарий без него отправить нельзя вовсе.
function stepSubmit(step) {
    const label = el('label', 'scn-mark' + (step.submit ? ' on' : ''), '');
    label.title = 'необратимый шаг: нажатие «оформить». '
        + 'Всё после него прогоняется только при включённой отправке';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!step.submit;
    box.onchange = () => { step.submit = box.checked; renderEditor(); };
    label.appendChild(box);
    label.appendChild(el('span', null, '⏎ отправка'));

    return label;
}

// Отметка «снять кадр после этого шага». ⚠ Текст — подпись кадра: он уедет в
// колонку обработанных, и «кадр 2» человеку ничего не скажет.
function stepShot(step) {
    const label = el('label', 'scn-mark' + (step.shot ? ' on' : ''), '');
    label.title = 'снять кадр после шага; текст станет подписью под превью';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!step.shot;
    box.onchange = () => {
        // ⚠ Пустая подпись у включённой галочки бессмысленна: кадр снимется,
        // но человек не поймёт, какой он по счёту. Подставляем умолчание и
        // даём править.
        step.shot = box.checked ? (step.shot || 'этап заполнен') : '';
        renderEditor();
    };
    label.appendChild(box);
    label.appendChild(el('span', null, '📷 кадр'));

    if (step.shot) {
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'scn-shot-title';
        text.value = step.shot;
        text.maxLength = 120;
        text.title = 'подпись кадра';
        text.oninput = () => { step.shot = text.value; };
        // ⚠ Клик по полю не должен снимать галочку: поле лежит внутри `label`,
        // и без этого ввод подписи выключал бы кадр.
        text.onclick = event => event.preventDefault();
        label.appendChild(text);
    }

    return label;
}

function stepField(step, name) {
    const line = el('div', 'scn-step-field');
    line.appendChild(el('label', null, name));

    // `fields` у `extract_rows` — список записей, и строкой его не набрать:
    // отдаём как JSON в textarea, где его и правят.
    const json = name === 'fields';
    const input = document.createElement(json ? 'textarea' : 'input');
    if (!json) input.type = 'text';
    input.value = json
        ? JSON.stringify(step[name] || [], null, 1)
        : (step[name] === undefined ? '' : step[name]);
    input.oninput = () => {
        if (!json) { step[name] = input.value; return; }
        // ⚠ Негодный JSON не стирает набранное и не роняет страницу: человек
        // печатает, и в середине ввода текст закономерно негоден. Значение
        // примется, когда станет разбираемым.
        try {
            step[name] = JSON.parse(input.value);
            input.classList.remove('scn-bad');
        } catch (e) {
            input.classList.add('scn-bad');
        }
    };
    line.appendChild(input);

    return line;
}

function moveButton(sign, at, shift) {
    const btn = el('button', 'scn-move', sign);
    btn.type = 'button';
    btn.title = 'переставить шаг';
    btn.disabled = at + shift < 0 || at + shift >= draft.steps.length;
    btn.onclick = () => {
        const steps = draft.steps;
        [steps[at], steps[at + shift]] = [steps[at + shift], steps[at]];
        renderEditor();
    };

    return btn;
}

// ── сохранить и прогнать ───────────────────────────────────────────────────

function editorButtons() {
    const box = el('div', 'scn-actions');

    const save = el('button', 'scn-btn scn-btn-main', 'Сохранить');
    save.type = 'button';
    save.onclick = () => saveDraft(save);
    box.appendChild(save);

    // ⚠ Прогнать можно только сохранённый: контейнер получает сценарий из базы,
    // а не из этой формы. Кнопка у нового поэтому выключена — иначе человек
    // прогонял бы прошлую версию, думая, что проверяет свою правку.
    const run = el('button', 'scn-btn', '▶ прогнать');
    run.type = 'button';
    run.disabled = !draft.id;
    run.title = draft.id ? 'прогнать сценарий сейчас' : 'сначала сохраните';
    run.onclick = () => runDraft(run);
    box.appendChild(run);

    if (draft.id) {
        const bin = el('button', 'scn-btn scn-btn-bad', 'Убрать');
        bin.type = 'button';
        bin.onclick = () => dropDraft();
        box.appendChild(bin);
    }

    return box;
}

async function saveDraft(btn) {
    btn.disabled = true;
    try {
        const {result} = await postData('/api/scenario', {
            id: draft.id, site_id: site, name: draft.name, goal: draft.goal,
            start_url: draft.start_url, status: draft.status,
            steps: draft.steps, variables: draft.variables || {},
            pace_min_ms: draft.pace_min_ms, pace_max_ms: draft.pace_max_ms,
        });
        showNotification(`Сценарий «${result.name}» сохранён`, 'success');
        draft = {...result, steps: result.steps || [], runs: draft.runs || []};
        await load(site);
        renderEditor();
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    } finally {
        btn.disabled = false;
    }
}

async function runDraft(btn) {
    btn.disabled = true;
    btn.textContent = '▶ идёт…';
    try {
        const {result} = await postData(`/api/scenario/${draft.id}/run`, {});
        // ⚠⚠ Упавший сценарий приходит кодом 200 со `status: "error"` внутри:
        // не отработал чужой сайт, а не наш сервер. Поэтому цвет уведомления
        // решает поле ответа, а не то, что запрос не бросил исключение.
        const ok = result.status === 'ok' || result.status === 'success';
        showNotification(ok ? 'Прогон удался'
                            : `Прогон не удался: ${result.error || result.status}`,
                         ok ? 'success' : 'error');
        await openScenario(draft.id);
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '▶ прогнать';
    }
}

async function dropDraft() {
    if (!confirm(`Убрать сценарий «${draft.name}»? Прогоны уйдут следом.`)) return;

    try {
        await postData('/api/scenario/remove', {id: draft.id});
        draft = null;
        await load(site);
        renderEditor();
    } catch (e) {
        showNotification(String(e.message || e), 'error');
    }
}

// ── прогоны ────────────────────────────────────────────────────────────────

// ⚠ Последние прогоны стоят под сценарием, а не в отдельной ленте: провал надо
// видеть там же, где правят шаги, иначе человек правит вслепую.
function runsBox(runs) {
    const box = el('div', 'scn-runs');
    box.appendChild(el('div', 'scn-col-name', '📜 Прогоны'));
    runs.forEach(run => {
        const line = el('div', 'scn-run');
        const ok = run.status === 'ok' || run.status === 'success';
        line.appendChild(el('span', `scn-run-mark ${ok ? 'good' : 'bad'}`,
                            ok ? '✓' : '✕'));
        line.appendChild(el('span', 'scn-run-when', run.created_at || ''));
        if (run.error) line.appendChild(el('span', 'scn-run-error', run.error));
        box.appendChild(line);
    });

    return box;
}
