import {getData, deleteData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {el} from '/static/js/page_dom.js';

// ⚠ Строка журнала — это ОШИБКА С ОТПЕЧАТКОМ, а не отдельное падение:
// одинаковые повторы сходятся в одну запись со счётчиком `hits`
// (`src/journal/journal.py`). Поэтому «10 строк» здесь не значит «10 сбоев»,
// и цифру повторов видно прямо в шапке карточки.
const state = {page: 1, pages: 1, sourcesFilled: false};
let findTimer = 0;

const listEl = document.getElementById('journalList');
const sourceEl = document.getElementById('journalSource');
const levelEl = document.getElementById('journalLevel');
const findEl = document.getElementById('journalFind');
const countEl = document.getElementById('journalCount');

function timeAgo(value) {
    if (!value) return '';
    const raw = String(value).replace(' ', 'T');
    const date = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
    if (isNaN(date.getTime())) return '';
    const sec = Math.round((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return `${sec} сек назад`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return (min % 60) ? `${hours} ч ${min % 60} мин назад` : `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
}

async function load() {
    const params = new URLSearchParams({page: state.page});
    if (sourceEl.value) params.set('source', sourceEl.value);
    if (levelEl.value) params.set('level', levelEl.value);
    if (findEl.value.trim()) params.set('q', findEl.value.trim());

    let data;
    try {
        data = (await getData(`/api/journal?${params}`)).result;
    } catch (e) {
        listEl.replaceChildren(el('div', 'journal-empty', `Журнал не пришёл: ${e.message}`));
        return;
    }

    state.page = Number(data.page || 1);
    state.pages = Number(data.pages || 1);
    countEl.textContent = data.total ? `ошибок: ${data.total}` : '';

    // ⚠ Подписи процессов приходят с сервера (`sources`), своей копии
    // страница не держит: переименуют процесс в словаре — страница
    // подхватит молча. Заполняем один раз: список статичен.
    if (!state.sourcesFilled) {
        Object.entries(data.sources || {}).forEach(([key, label]) => {
            const option = el('option', null, label);
            option.value = key;
            sourceEl.appendChild(option);
        });
        state.sourcesFilled = true;
    }

    document.getElementById('journalPageInfo').textContent = `${state.page} / ${state.pages}`;
    document.getElementById('journalPagePrev').disabled = state.page <= 1;
    document.getElementById('journalPageNext').disabled = state.page >= state.pages;

    if (!data.rows.length) {
        // Пусто — хорошая новость, и сказать её надо словами: пустая
        // область читается как «не загрузилось».
        listEl.replaceChildren(el('div', 'journal-empty',
            'Ошибок нет. Сюда стекается всё, что падает на установке: '
            + 'роутеры, воркеры, кронджобы, телеграм-бот.'));
        return;
    }

    listEl.replaceChildren(...data.rows.map(card));
    listEl.scrollTop = 0;
}

function card(row) {
    const node = el('div', 'journal-card' + (row.level === 'CRITICAL' ? ' journal-critical' : ''));

    const head = el('div', 'journal-card-head');
    head.appendChild(el('span', 'journal-source', row.source_title || row.source));
    head.appendChild(el('span', 'journal-logger', row.logger || ''));
    if (row.hits > 1) head.appendChild(el('span', 'journal-hits', `×${row.hits}`));
    head.appendChild(el('span', 'journal-when',
        `${fmtTz(row.last_at, true)} · ${timeAgo(row.last_at)}`));

    const drop = el('button', 'journal-drop', '✕');
    drop.type = 'button';
    drop.title = 'Убрать запись';
    drop.onclick = async () => {
        try {
            await deleteData(`/api/journal/${row.id}`);
        } catch (e) {
            showNotification(`Запись не убралась: ${e.message}`, 'error');
            return;
        }
        load();
    };
    head.appendChild(drop);
    node.appendChild(head);

    const message = el('div', 'journal-message', row.message);
    node.appendChild(message);

    const where = row.context || {};
    if (where.file) {
        node.appendChild(el('div', 'journal-where',
            `${where.file}:${where.line} · ${where.func || ''}`
            + (where.trace_id ? ` · trace ${where.trace_id}` : '')
            + ` · впервые ${fmtTz(row.first_at, true)}`));
    }

    // Трассировка под спойлером: в ленте её сто строк забивают всё
    // остальное, а нужна она уже после того, как ошибку нашли глазами.
    if (row.traceback) {
        const trace = el('pre', 'journal-trace', row.traceback);
        trace.hidden = true;
        message.classList.add('journal-message-open');
        message.title = 'Показать трассировку';
        message.onclick = () => {
            trace.hidden = !trace.hidden;
        };
        node.appendChild(trace);
    }

    return node;
}

sourceEl.onchange = () => {
    state.page = 1;
    load();
};
levelEl.onchange = () => {
    state.page = 1;
    load();
};
findEl.oninput = () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => {
        state.page = 1;
        load();
    }, 400);
};
document.getElementById('journalReload').onclick = () => load();
document.getElementById('journalClear').onclick = async () => {
    const scope = sourceEl.value
        ? `записи процесса «${sourceEl.options[sourceEl.selectedIndex].text}»`
        : 'весь журнал';
    if (!confirm(`Убрать ${scope}? Это не отменить.`)) return;
    try {
        const params = sourceEl.value ? `?source=${encodeURIComponent(sourceEl.value)}` : '';
        const res = await deleteData(`/api/journal${params}`);
        showNotification(`Убрано записей: ${res.result.deleted}`, 'success');
    } catch (e) {
        showNotification(`Журнал не очистился: ${e.message}`, 'error');
    }
    state.page = 1;
    load();
};
document.getElementById('journalPagePrev').onclick = () => {
    if (state.page > 1) {
        state.page--;
        load();
    }
};
document.getElementById('journalPageNext').onclick = () => {
    if (state.page < state.pages) {
        state.page++;
        load();
    }
};

// ===================== Подвкладка «MySQL» =====================
//
// ⚠ Строка здесь — это ВИД запроса, а не его прогон: одинаковые повторы
// сходятся в одну запись, и числа в ней складываются (`journal_mysql`).
// Поэтому «50 строк» не значит «50 запросов», а `hits` — главная цифра
// рядом с суммарным временем.
//
// ⚠ Ответов базы здесь нет и не будет: хранится запрос, его значения и
// числа. Значения вычищены от секретов на сервере (`mysql_log_args`).

// С какого среднего времени запрос считаем медленным сам по себе. Не порог
// записи (пишутся все), а только подсветка: глазу нужна зацепка.
const SQL_SLOW_MS = 50;

const sqlState = {page: 1, pages: 1, sourcesFilled: false};
let sqlFindTimer = 0;

const sqlListEl = document.getElementById('sqlList');
const sqlSourceEl = document.getElementById('sqlSource');
const sqlOrderEl = document.getElementById('sqlOrder');
const sqlFindEl = document.getElementById('sqlFind');
const sqlCountEl = document.getElementById('sqlCount');

function msText(ms) {
    const value = Number(ms || 0);
    if (value >= 60000) return `${Math.round(value / 60000)} мин`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)} с`;
    if (value >= 10) return `${Math.round(value)} мс`;
    return `${value.toFixed(1)} мс`;
}

function qtyText(value) {
    const n = Number(value || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)} млн`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)} тыс`;
    return String(n);
}

async function sqlLoad() {
    const params = new URLSearchParams({page: sqlState.page, order: sqlOrderEl.value});
    if (sqlSourceEl.value) params.set('source', sqlSourceEl.value);
    if (sqlFindEl.value.trim()) params.set('q', sqlFindEl.value.trim());

    let data;
    try {
        data = (await getData(`/api/journal/mysql?${params}`)).result;
    } catch (e) {
        sqlListEl.replaceChildren(el('div', 'journal-empty', `Журнал запросов не пришёл: ${e.message}`));
        return;
    }

    sqlState.page = Number(data.page || 1);
    sqlState.pages = Number(data.pages || 1);
    sqlCountEl.textContent = data.total
        ? `видов: ${data.total} · запросов: ${qtyText(data.totals.hits)} · всего ${msText(data.totals.total_ms)}`
        : '';

    // Подписи процессов приходят с сервера — та же дисциплина, что на
    // соседней подвкладке: своей копии страница не держит.
    if (!sqlState.sourcesFilled) {
        Object.entries(data.sources || {}).forEach(([key, label]) => {
            const option = el('option', null, label);
            option.value = key;
            sqlSourceEl.appendChild(option);
        });
        sqlState.sourcesFilled = true;
    }

    document.getElementById('sqlPageInfo').textContent = `${sqlState.page} / ${sqlState.pages}`;
    document.getElementById('sqlPagePrev').disabled = sqlState.page <= 1;
    document.getElementById('sqlPageNext').disabled = sqlState.page >= sqlState.pages;

    const cards = data.rows.map(sqlCard);

    if (!data.enabled) {
        // Выключенный счётчик и «запросов не было» выглядят одинаково —
        // пустой лентой. Разница принципиальная, и сказать её надо словами.
        cards.unshift(el('div', 'sql-off',
            'Счёт запросов выключен: MYSQL_WATCH_ENABLED=0 в .env. '
            + 'Показано то, что успели насчитать раньше.'));
    }

    if (!data.rows.length) {
        cards.push(el('div', 'journal-empty',
            'Запросов не насчитано. Считает каждый процесс у себя и сбрасывает '
            + 'в таблицу раз в полминуты — сразу после перезапуска здесь пусто.'));
    }

    sqlListEl.replaceChildren(...cards);
    sqlListEl.scrollTop = 0;
}

function sqlCard(row) {
    const avg = Number(row.avg_ms || 0);
    const node = el('div', 'sql-card' + (avg >= SQL_SLOW_MS ? ' sql-slow' : ''));

    const head = el('div', 'journal-card-head');
    head.appendChild(el('span', 'journal-source', row.source_title || row.source || '—'));
    head.appendChild(el('span', 'journal-when',
        `${fmtTz(row.last_at, true)} · ${timeAgo(row.last_at)}`));

    const drop = el('button', 'journal-drop', '✕');
    drop.type = 'button';
    drop.title = 'Убрать строку';
    drop.onclick = async () => {
        try {
            await deleteData(`/api/journal/mysql/${row.id}`);
        } catch (e) {
            showNotification(`Строка не убралась: ${e.message}`, 'error');
            return;
        }
        sqlLoad();
    };
    head.appendChild(drop);
    node.appendChild(head);

    // Порядок чисел — от главного: суммарное время, сколько раз, среднее,
    // худший случай, сколько строк отдаёт. Отвечает на «куда уходит время» и
    // на «долгий потому, что много ищет, или потому, что много отдаёт».
    const numbers = el('div', 'sql-numbers');
    numbers.appendChild(el('span', 'sql-total', `Σ ${msText(row.total_ms)}`));
    numbers.appendChild(el('span', 'sql-hits', `×${qtyText(row.hits)}`));
    numbers.appendChild(el('span', null, `сред ${msText(avg)}`));
    numbers.appendChild(el('span', null, `макс ${msText(row.max_ms)}`));
    numbers.appendChild(el('span', null,
        `строк: сред ${Math.round(Number(row.avg_rows || 0))}, макс ${qtyText(row.max_rows)}`));
    node.appendChild(numbers);

    const query = el('div', 'sql-query sql-query-short', row.query || '');
    query.title = 'Показать запрос целиком';
    query.onclick = () => query.classList.toggle('sql-query-short');
    node.appendChild(query);

    // Значения — от самого долгого прогона, а не от последнего: вопрос,
    // ради которого сюда смотрят, звучит «почему иногда медленно».
    if (row.slow_args || Number(row.slow_ms || 0) > 0) {
        const slow = el('div', 'sql-slowest');
        slow.appendChild(el('b', null, `медленный случай: ${msText(row.slow_ms)}`));
        slow.appendChild(document.createTextNode(
            `, строк ${qtyText(row.slow_rows)}, ${fmtTz(row.slow_at, true)}`
            + (row.slow_args ? `\nArgs: ${row.slow_args}` : '')));
        node.appendChild(slow);
    }

    return node;
}

sqlSourceEl.onchange = () => {
    sqlState.page = 1;
    sqlLoad();
};
sqlOrderEl.onchange = () => {
    sqlState.page = 1;
    sqlLoad();
};
sqlFindEl.oninput = () => {
    clearTimeout(sqlFindTimer);
    sqlFindTimer = setTimeout(() => {
        sqlState.page = 1;
        sqlLoad();
    }, 400);
};
document.getElementById('sqlReload').onclick = () => sqlLoad();
document.getElementById('sqlClear').onclick = async () => {
    const scope = sqlSourceEl.value
        ? `счётчики процесса «${sqlSourceEl.options[sqlSourceEl.selectedIndex].text}»`
        : 'все счётчики';
    if (!confirm(`Обнулить ${scope}? Это не отменить.`)) return;
    try {
        const params = sqlSourceEl.value ? `?source=${encodeURIComponent(sqlSourceEl.value)}` : '';
        const res = await deleteData(`/api/journal/mysql${params}`);
        showNotification(`Убрано строк: ${res.result.deleted}`, 'success');
    } catch (e) {
        showNotification(`Счётчики не обнулились: ${e.message}`, 'error');
    }
    sqlState.page = 1;
    sqlLoad();
};
document.getElementById('sqlPagePrev').onclick = () => {
    if (sqlState.page > 1) {
        sqlState.page--;
        sqlLoad();
    }
};
document.getElementById('sqlPageNext').onclick = () => {
    if (sqlState.page < sqlState.pages) {
        sqlState.page++;
        sqlLoad();
    }
};

// ===================== Переключение подвкладок =====================
//
// Подвкладка сейчас одна, но переключатель общий и пустой работы не делает:
// соседнюю добавляют кнопкой в шапку и панелью `#tab-<имя>`, и она заработает
// без правки этого кода. Выбор помним между заходами — разбираются с журналом
// длинными заходами.
const JOURNAL_TAB_KEY = 'journal_tab';

function tabSwitch(name) {
    document.querySelectorAll('.page-tab').forEach(one => {
        one.classList.toggle('active', one.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${name}`);
    });
    // Спрашивает сервер только открытая подвкладка: у соседней свои ручки и
    // своя цена — журнал запросов на каждом показе сбрасывает накопленное.
    if (name === 'error') load();
    if (name === 'mysql') sqlLoad();
}

document.querySelectorAll('.page-tab').forEach(tab => {
    tab.onclick = () => {
        localStorage.setItem(JOURNAL_TAB_KEY, tab.dataset.tab);
        tabSwitch(tab.dataset.tab);
    };
});

// ⚠ `loadTz()` до первой отрисовки: без него `fmtTz` покажет UTC, а
// настройка `timezone` сдвигает время на всех страницах админки.
await loadTz();

// Запомненная подвкладка, если она ещё существует: пункт могли убрать, и
// тогда открывается первая — пустая страница вместо журнала хуже забытого
// выбора.
const remembered = localStorage.getItem(JOURNAL_TAB_KEY);
const known = [...document.querySelectorAll('.page-tab')].map(one => one.dataset.tab);
tabSwitch(known.includes(remembered) ? remembered : known[0]);
