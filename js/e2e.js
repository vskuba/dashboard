import {deleteData, getData, postData, putData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {el} from '/static/js/page_dom.js';

const runsEl = document.getElementById('e2eRuns');
const listEl = document.getElementById('e2eList');
const countEl = document.getElementById('e2eCount');
const statusEl = document.getElementById('e2eRunStatus');
const modalEl = document.getElementById('e2eModal');

// Строки открытого прогона — по номеру строки: окно кадра берёт их отсюда,
// второй раз сервер не спрашивает.
const rowsById = new Map();
let openRun = '';

const STATUS_TEXT = {ok: 'прошёл', fail: 'есть провалы', error: 'сорвался'};

function badge(status) {
    const node = el('span', `e2e-badge ${status}`, STATUS_TEXT[status] || status);
    return node;
}

async function loadRuns() {
    const answer = await getData('/api/e2e/run?limit=30');
    const runs = answer.result || [];

    runsEl.replaceChildren();
    if (!runs.length) {
        runsEl.append(el('div', 'e2e-empty', 'Прогонов ещё не было'));
        return runs;
    }

    runs.forEach(run => {
        const node = el('div', 'e2e-run');
        node.dataset.run = run.run_uuid;
        node.append(el('div', 'e2e-run-time', fmtTz(run.started_at, false)));

        const sub = el('div', 'e2e-run-sub');
        sub.append(badge(run.status));
        sub.append(document.createTextNode(
            ` · тестов ${run.tests}` + (run.failed ? `, провалов ${run.failed}` : '')));
        node.append(sub);

        node.append(dropButton(run));
        node.onclick = () => openRunRows(run.run_uuid);
        runsEl.append(node);
    });
    return runs;
}

/** Кружок с крестиком на карточке прогона: снести строки и кадры. */
function dropButton(run) {
    const when = fmtTz(run.started_at, false);
    const node = el('button', 'e2e-run-drop', '×');
    node.type = 'button';
    node.title = `Удалить прогон от ${when}`;

    node.onclick = async (event) => {
        // ⚠ Щелчок по кнопке не обязан открывать прогон: карточка целиком —
        // ссылка, и без этого удаление сперва показывало бы то, что удаляет.
        event.stopPropagation();
        if (!confirm(`Удалить прогон от ${when} вместе с кадрами?`)) return;

        try {
            await deleteData(`/api/e2e/run/${run.run_uuid}`);
        } catch (err) {
            showNotification('Прогон не удалён: ' + err.message, 'error');
            return;
        }

        showNotification(`Прогон от ${when} удалён`, 'success');
        // ⚠⚠ Открыт был именно он — правую колонку надо увести на свежий
        // прогон, иначе она осталась бы показывать кадры, которых уже нет:
        // плитки молча превратились бы в битые картинки.
        const runs = await loadRuns();
        if (openRun === run.run_uuid) {
            openRun = '';
            await openRunRows(runs.length ? runs[0].run_uuid : '');
        }
    };
    return node;
}

async function openRunRows(runUuid) {
    openRun = runUuid;
    document.querySelectorAll('.e2e-run').forEach(node => {
        node.classList.toggle('active', node.dataset.run === runUuid);
    });

    const answer = await getData(`/api/e2e/run/${runUuid || 'last'}`);
    const result = answer.result || {};
    const rows = result.rows || [];

    rowsById.clear();
    rows.forEach(row => rowsById.set(row.id, row));

    const run = result.run || {};
    if (run.run_uuid) {
        openRun = run.run_uuid;
        document.querySelectorAll('.e2e-run').forEach(node => {
            node.classList.toggle('active', node.dataset.run === run.run_uuid);
        });
        statusEl.style.display = '';
        statusEl.className = `e2e-badge ${run.status}`;
        statusEl.textContent = STATUS_TEXT[run.status] || run.status;
        countEl.textContent = `${fmtTz(run.started_at, true)} · тестов ${run.tests}`
            + (run.failed ? ` · провалов ${run.failed}` : '')
            + (run.errored ? ` · сорвалось ${run.errored}` : '');
    } else {
        statusEl.style.display = 'none';
        countEl.textContent = '';
    }

    drawRows(rows);
}

// Строки → карточки: одна карточка на ИМЯ теста, внутри кадр на ширину.
function drawRows(rows) {
    listEl.replaceChildren();
    if (!rows.length) {
        listEl.append(el('div', 'e2e-empty',
            'Прогонов ещё не было. Случаи лежат в tests_e2e/, прогон идёт раз в сутки.'));
        return;
    }

    const byName = new Map();
    rows.forEach(row => {
        if (!byName.has(row.name)) byName.set(row.name, []);
        byName.get(row.name).push(row);
    });

    byName.forEach((group, name) => {
        // Вердикт карточки — худший из её ширин: одна красная ширина делает
        // красным весь тест, иначе зелёная карточка прятала бы провал.
        const worst = group.some(row => row.status === 'error') ? 'error'
            : group.some(row => row.status === 'fail') ? 'fail' : 'ok';

        const card = el('div', `e2e-card ${worst}`);

        const head = el('div', 'e2e-card-head');
        head.append(el('span', 'e2e-card-name', name));
        head.append(badge(worst));
        head.append(el('span', 'e2e-card-page', group[0].page));
        card.append(head);

        if (group[0].description) {
            card.append(el('div', 'e2e-card-desc', group[0].description));
        }

        const shots = el('div', 'e2e-shots');
        group.sort((a, b) => a.width - b.width).forEach(row => shots.append(shotTile(row)));
        card.append(shots);

        listEl.append(card);
    });
}

function shotTile(row) {
    const tile = el('div', 'e2e-shot');

    const bar = el('div', 'e2e-shot-bar');
    bar.append(el('span', 'e2e-shot-width', `${row.width}px`));
    bar.append(badge(row.status));
    bar.append(el('span', 'e2e-shot-areas',
        row.areas_failed ? `${row.areas_failed} из ${row.areas_total}`
            : `областей ${row.areas_total}`));
    tile.append(bar);

    if (row.shot_url) {
        const img = document.createElement('img');
        img.src = row.shot_url;
        img.alt = `${row.name}, ${row.width}px`;
        img.loading = 'lazy';
        tile.append(img);
    } else {
        tile.append(el('div', 'e2e-shot-none', row.error || 'кадра нет'));
    }

    tile.onclick = () => openShot(row.id);
    return tile;
}

function openShot(rowId) {
    const row = rowsById.get(rowId);
    if (!row) return;

    document.getElementById('e2eModalTitle').textContent =
        `${row.name} · ${row.width}px`;

    const shotBox = document.getElementById('e2eModalShot');
    shotBox.replaceChildren();
    if (row.shot_url) {
        const img = document.createElement('img');
        img.src = row.shot_url;
        img.alt = row.name;
        shotBox.append(img);
    }

    const areasBox = document.getElementById('e2eModalAreas');
    areasBox.replaceChildren();
    (row.areas || []).forEach(area => areasBox.append(areaRow(area)));
    if (!(row.areas || []).length) {
        areasBox.append(el('div', 'e2e-empty', row.error || 'областей нет'));
    }

    const consoleBox = document.getElementById('e2eModalConsole');
    const lines = row.console || [];
    consoleBox.style.display = lines.length ? '' : 'none';
    consoleBox.textContent = lines.join('\n');

    modalEl.classList.add('open');
}

function areaRow(area) {
    const node = el('div', 'e2e-area');

    const head = el('div', 'e2e-area-name');
    head.append(el('span', '', area.name || '—'));
    head.append(badge(area.status || 'ok'));
    node.append(head);
    node.append(el('div', 'e2e-area-sel', area.selector || ''));

    (area.rules || []).forEach(rule => {
        const bad = rule.status !== 'ok';
        const line = el('div', `e2e-rule${bad ? ' bad' : ''}`);
        line.append(el('span', 'e2e-rule-mark', bad ? '✕' : '✓'));
        // Числом, а не словом: «не вылезла» без числа не отличить от
        // «не проверяли», а 1452 при вьюпорте 1440 — уже готовый ответ.
        line.append(el('span', '', rule.detail
            ? `${rule.name} — ${rule.detail}` : rule.name));
        node.append(line);
    });

    return node;
}

function closeShot() {
    modalEl.classList.remove('open');
    document.getElementById('e2eModalShot').replaceChildren();
}

document.getElementById('e2eModalClose').onclick = closeShot;
modalEl.onclick = event => {
    if (event.target === modalEl) closeShot();
};
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeShot();
});

const runBtn = document.getElementById('e2eRun');

// Пока прогон идёт, страница опрашивает его состояние и сама подхватывает
// результат. ⚠ Опрос заводится ТОЛЬКО на время прогона и гасится по его
// окончании: вечный таймер на открытой вкладке — это запрос в секунду к
// панели круглые сутки.
let pollTimer = 0;

function paintRun(running) {
    runBtn.disabled = running;
    runBtn.textContent = running ? '⏳ Идёт прогон…' : '▶ Прогнать сейчас';
}

function pollStop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
}

function pollStart() {
    pollStop();
    paintRun(true);
    pollTimer = setInterval(async () => {
        try {
            const answer = await getData('/api/e2e/run/status');
            if (answer.result && answer.result.running) return;
            pollStop();
            paintRun(false);
            // Прогон кончился — список обновляем сами: человек нажал кнопку
            // и ждёт результата, а не ещё одного нажатия.
            openRun = '';
            await load();
            showNotification('Прогон закончен', 'success');
        } catch (err) {
            pollStop();
            paintRun(false);
            showNotification(err.message, 'error');
        }
    }, 3000);
}

runBtn.onclick = async () => {
    runBtn.disabled = true;
    try {
        const answer = await postData('/api/e2e/run', {});
        const result = answer.result || {};
        if (!result.started) {
            showNotification(result.reason || 'Прогон уже идёт', 'warning');
        } else {
            showNotification('Прогон запущен', 'success');
        }
        pollStart();
    } catch (err) {
        showNotification(err.message, 'error');
        paintRun(false);
    }
};

document.getElementById('e2eReload').onclick = () => load();

async function load() {
    try {
        const runs = await loadRuns();
        if (runs.length) {
            await openRunRows(openRun || runs[0].run_uuid);
        } else {
            listEl.replaceChildren(el('div', 'e2e-empty',
                'Прогонов ещё не было. Случаи лежат в tests_e2e/, прогон идёт раз в сутки.'));
        }
    } catch (err) {
        showNotification(err.message, 'error');
        listEl.replaceChildren(el('div', 'e2e-empty', err.message));
    }
}

// ===================== Подвкладка «Тесты» =====================

const caseListEl = document.getElementById('e2eCaseList');
const caseCountEl = document.getElementById('e2eCaseCount');

function caseSwitch(button, on) {
    button.className = `e2e-switch ${on ? 'on' : 'off'}`;
    button.textContent = on ? 'включён' : 'выключен';
    const card = button.closest('.e2e-case');
    if (card) card.classList.toggle('off', !on);
}

async function caseToggle(button, one) {
    const want = !button.classList.contains('on');
    button.disabled = true;
    try {
        await putData(`/api/e2e/case/${encodeURIComponent(one.file)}/enabled`,
                      {enabled: want});
        one.enabled = want;
        caseSwitch(button, want);
        showNotification(want ? 'Тест включён' : 'Тест выключен', 'success');
        caseCount();
    } catch (err) {
        showNotification(err.message, 'error');
    } finally {
        button.disabled = false;
    }
}

let cases = [];

function caseCount() {
    const on = cases.filter(one => one.enabled).length;
    caseCountEl.textContent = `тестов ${cases.length} · включено ${on}`
        + (on < cases.length ? ` · выключено ${cases.length - on}` : '');
}

function caseDraw() {
    caseListEl.replaceChildren();
    if (!cases.length) {
        caseListEl.append(el('div', 'e2e-empty',
            'Случаев нет. Они лежат файлами в tests_e2e/*.yaml.'));
        return;
    }

    cases.forEach(one => {
        const card = el('div', `e2e-case${one.enabled ? '' : ' off'}`);

        const body = el('div', 'e2e-case-body');
        body.append(el('div', 'e2e-case-name', one.name));
        body.append(el('div', 'e2e-case-meta',
            `${one.page} · ${one.file} · ширин ${one.widths.length}`
            + ` · областей ${one.areas}`
            + (one.checks ? ` · проверок ${one.checks}` : '')));
        if (one.description) body.append(el('div', 'e2e-case-desc', one.description));
        card.append(body);

        const button = document.createElement('button');
        button.type = 'button';
        caseSwitch(button, one.enabled);
        button.onclick = () => caseToggle(button, one);
        card.append(button);

        caseListEl.append(card);
    });
}

async function caseLoad() {
    try {
        const answer = await getData('/api/e2e/case');
        cases = answer.result || [];
        caseCount();
        caseDraw();
    } catch (err) {
        showNotification(err.message, 'error');
        caseListEl.replaceChildren(el('div', 'e2e-empty', err.message));
    }
}

document.getElementById('e2eCaseReload').onclick = caseLoad;

// Переключение подвкладок: панель ищется по `id`, кнопка — по `data-tab`.
// ⚠ Спрашивает сервер только открытая: у соседней свои ручки, и дёргать их
// впустую на каждом заходе незачем.
const E2E_TAB_KEY = 'e2eTab';
let casesLoaded = false;

function tabSwitch(name) {
    document.querySelector('.e2e-page').classList.toggle('cases', name === 'cases');
    document.querySelectorAll('.page-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${name}`);
    });
    if (name === 'cases' && !casesLoaded) {
        casesLoaded = true;
        caseLoad();
    }
}

document.querySelectorAll('.page-tab').forEach(tab => {
    tab.onclick = () => {
        localStorage.setItem(E2E_TAB_KEY, tab.dataset.tab);
        tabSwitch(tab.dataset.tab);
    };
});

// Делитель колонок: ширина списка прогонов запоминается в браузере. Двойной
// клик по нему возвращает умолчание.
//
// ⚠ `initSidebarResizer` — глобаль из `tz.js`-соседа `sidebar_resizer.js`,
// который шаблон страницы подключает сам. Проверка на `typeof`, а не прямой
// вызов: проект вправе положить у себя свой `e2e.html` без этой строки, и
// страница обязана тогда работать без делителя, а не падать на первой же
// отрисовке — иначе отсутствие ручки уносит с собой весь список.
if (typeof initSidebarResizer === 'function') {
    initSidebarResizer('e2eResizer', 'e2e_runs_width',
                       document.querySelector('.e2e-runs'));
}

// ⚠ `loadTz()` до первой отрисовки: без него `fmtTz` покажет UTC, а
// настройка `timezone` сдвигает время на всех страницах админки.
await loadTz();
await load();

// Запомненная подвкладка, если она ещё существует: пункт могли убрать, и
// тогда открывается первая — пустая страница хуже забытого выбора.
const rememberedTab = localStorage.getItem(E2E_TAB_KEY);
const knownTabs = [...document.querySelectorAll('.page-tab')].map(one => one.dataset.tab);
tabSwitch(knownTabs.includes(rememberedTab) ? rememberedTab : knownTabs[0]);

// ⚠⚠ Состояние прогона спрашиваем и при заходе, а не только после нажатия.
// Прогон живёт в очереди, а не во вкладке: его мог завести сосед или ночное
// расписание, а страницу — перезагрузить посреди прогона. Без этой проверки
// кнопка предлагала бы завести второй, и человек получал бы отказ вместо
// честного «идёт».
try {
    const answer = await getData('/api/e2e/run/status');
    if (answer.result && answer.result.running) pollStart();
} catch (err) {
    // Состояние не узнали — кнопка остаётся доступной: отказ придёт от
    // ручки, и это честнее, чем запереть её из-за молчания Redis.
}
