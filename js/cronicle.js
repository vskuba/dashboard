import {getData, putData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {el} from '/static/js/page_dom.js';

const listEl = document.getElementById('cronList');
const noteEl = document.getElementById('cronNote');
const countEl = document.getElementById('cronCount');

// Расписание Cronicle приходит полями `timing`, а не строкой crontab:
// {hours: [4], minutes: [0]} — это «каждый день в 04:00». Пустое поле
// означает «каждый», поэтому отсутствие ключа и пустой массив читаются
// одинаково: звёздочкой.
function timingText(timing) {
    if (!timing || !Object.keys(timing).length) return 'каждую минуту';
    const part = (list, pad) => {
        if (!list || !list.length) return '*';
        return list.map(v => pad ? String(v).padStart(2, '0') : v).join(',');
    };
    const hm = `${part(timing.hours, true)}:${part(timing.minutes, true)}`;
    const days = [];
    if (timing.weekdays && timing.weekdays.length) {
        const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
        days.push(timing.weekdays.map(d => names[d] || d).join(','));
    }
    if (timing.days && timing.days.length) days.push(`число ${part(timing.days)}`);
    if (timing.months && timing.months.length) days.push(`месяц ${part(timing.months)}`);
    return days.length ? `${hm} · ${days.join(' · ')}` : hm;
}

function elapsedText(seconds) {
    const value = Number(seconds || 0);
    if (!value) return '';
    if (value < 60) return `${value.toFixed(1)} с`;
    const min = Math.floor(value / 60);
    return `${min}м ${Math.round(value % 60)}с`;
}

// Сколько прошло с прогона. Длительность отвечает «сколько он шёл», это —
// «когда он был»: без второго дата в колонке требует считать в уме, а
// смотрят в неё именно за этим — «крон вообще отрабатывал недавно?».
//
// ⚠ Показываем старшую единицу и СОСЕДНЮЮ с ней, а не любые две ненулевые.
// Разница не косметическая: «любые две» на возрасте ровно в пять часов
// давали «5 ч 14 с назад» — минуты нулевые, и разряд перескакивал через
// них к секундам. Читается это как ошибка, и один раз так и прочиталось.
//
// Все четыре единицы сразу тоже не годятся: «0 дн 5 ч 12 мин 3 с» длиннее
// и хуже «5 ч 12 мин». Секунды видны там, где важны, — у свежего прогона.
//
// ⚠⚠ Разница берётся от epoch-секунд Cronicle напрямую, без пояса: «сколько
// назад» — это промежуток, и часовой пояс на него не влияет. Пояс нужен
// соседней дате, и путать их нельзя.
function agoText(epochSeconds) {
    const started = Number(epochSeconds || 0);
    if (!started) return '';
    const total = Math.max(0, Math.round(Date.now() / 1000 - started));

    const units = [['дн', 86400], ['ч', 3600], ['мин', 60], ['с', 1]];
    const top = units.findIndex(([, size]) => total >= size);
    if (top < 0) return 'только что';

    const parts = [];
    let rest = total;
    for (const [label, size] of units.slice(top, top + 2)) {
        const qty = Math.floor(rest / size);
        rest -= qty * size;
        if (qty) parts.push(`${qty} ${label}`);
    }
    return `${parts.join(' ')} назад`;
}

function lastOkCell(run) {
    if (!run) return el('span', 'cron-none', '—');
    const box = el('span', 'cron-ok');
    // Cronicle отдаёт время секундами epoch; fmtTz ждёт строку UTC.
    const when = new Date(Number(run.time_start) * 1000).toISOString();
    box.append(el('span', '', `${fmtTz(when, false)} · ${elapsedText(run.elapsed)}`));
    box.append(el('span', 'cron-ago', agoText(run.time_start)));
    return box;
}

async function toggle(button, event) {
    const want = !button.classList.contains('on');
    button.disabled = true;
    try {
        await putData(`/api/cronicle/event/${encodeURIComponent(event.id)}/enabled`,
                      {enabled: want});
        event.enabled = want;
        paintSwitch(button, want);
        showNotification(want ? 'Событие включено' : 'Событие выключено', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    } finally {
        button.disabled = false;
    }
}

function paintSwitch(button, on) {
    button.className = `cron-switch ${on ? 'on' : 'off'}`;
    button.textContent = on ? 'включено' : 'выключено';
    const row = button.closest('tr');
    if (row) row.classList.toggle('off', !on);
}

function draw(result) {
    noteEl.replaceChildren();
    listEl.replaceChildren();

    if (!result.ready) {
        const note = el('div', 'cron-note');
        note.append(document.createTextNode(result.reason || 'Cronicle недоступен'));
        noteEl.append(note);
        countEl.textContent = '';
        return;
    }

    const events = result.events || [];
    const on = events.filter(one => one.enabled).length;
    const ranToday = events.filter(one => one.last_ok).length;
    countEl.textContent = `событий ${events.length} · включено ${on} · `
        + `удачно сегодня ${ranToday}`;

    if (!events.length) {
        listEl.append(el('div', 'cron-empty', 'В расписании нет событий'));
        return;
    }

    const table = el('table', 'cron-table');
    const head = document.createElement('tr');
    ['Событие', 'Расписание', 'Последний удачный сегодня', ''].forEach((title, i) => {
        const th = el('th', i === 3 ? '' : null, title);
        if (i === 2) th.className = 'cron-num';
        head.append(th);
    });
    table.append(head);

    events.forEach(event => {
        const row = document.createElement('tr');
        if (!event.enabled) row.classList.add('off');

        const first = document.createElement('td');
        first.append(el('div', 'cron-title', event.title));
        if (event.target) first.append(el('div', 'cron-target', event.target));
        // Заметка события — здесь же, а не под раскрытием: по имени
        // `dating_chat` не догадаться, что оно делает, и читают её именно
        // затем, чтобы это понять.
        if (event.notes) first.append(el('div', 'cron-notes', event.notes));
        row.append(first);

        const timing = document.createElement('td');
        timing.append(el('span', 'cron-timing', timingText(event.timing)));
        row.append(timing);

        const last = document.createElement('td');
        last.className = 'cron-num';
        last.append(lastOkCell(event.last_ok));
        row.append(last);

        const act = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button';
        paintSwitch(button, event.enabled);
        button.onclick = () => toggle(button, event);
        act.append(button);
        row.append(act);

        table.append(row);
    });

    listEl.append(table);
}

async function load() {
    try {
        const answer = await getData('/api/cronicle/event');
        draw(answer.result || {});
    } catch (err) {
        showNotification(err.message, 'error');
        listEl.replaceChildren(el('div', 'cron-empty', err.message));
    }
}

document.getElementById('cronReload').onclick = load;

// ⚠ `loadTz()` до первой отрисовки: без него `fmtTz` покажет UTC, а
// «последний удачный сегодня» смотрят в поясе установки.
await loadTz();
await load();
