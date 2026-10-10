import {getData, postData, deleteData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {el, optionalList} from '/static/js/page_dom.js';

const tableHead = document.getElementById('settingTableHead');
const tableBody = document.getElementById('settingTableBody');
const searchInput = document.getElementById('settingSearch');
const createBtn = document.getElementById('createSettingBtn');

let nodes = [];
// settingsMap: key -> { global: value|null, nodes: {node_id: value} }
let settingsMap = {};

// Узлы есть не у всякой установки: `/node/list` — ручка проекта, у соседей её
// может не быть вовсе. Отсутствие узлов — это НЕ ошибка страницы, а её рабочее
// состояние: тогда колонка одна, общая.
//
// ⚠⚠ Раньше оба запроса шли одним `Promise.all`, и отказ второго валил первый:
// установка без узлов получала не «страницу без колонок», а пустую страницу с
// красным тостом. Отказ здесь глотается намеренно — ровно он и означает
// «узлов нет».
async function initManager() {
    try {
        const [settingsRes, nodeRows] = await Promise.all([
            getData('/api/setting'),
            optionalList('/node/list')
        ]);

        nodes = nodeRows;

        settingsMap = {};
        (settingsRes.result?.settings || []).forEach(row => {
            const entry = (settingsMap[row.key] ||= {global: null, nodes: {}});
            if (row.node_id) entry.nodes[row.node_id] = row.value;
            else entry.global = row.value;
        });

        renderHead();
        renderBody();
    } catch (e) {
        console.error('Ошибка загрузки настроек:', e);
        tableBody.innerHTML = '<tr><td class="empty-note">Ошибка загрузки</td></tr>';
    }
}

function renderHead() {
    tableHead.innerHTML = '';
    const tr = document.createElement('tr');
    tr.appendChild(el('th', null, 'Название'));
    tr.appendChild(el('th', null, 'Общее'));
    nodes.forEach(n => {
        const th = el('th', 'col-node', n.name);
        tr.appendChild(th);
    });
    tr.appendChild(el('th', null, '')); // колонка удаления
    tableBody.parentElement.style.tableLayout = 'fixed';
    tr.children[0].style.width = '220px';
    tr.children[tr.children.length - 1].style.width = '40px';
    tableHead.appendChild(tr);
}

function renderBody() {
    tableBody.innerHTML = '';
    const keys = Object.keys(settingsMap).sort();

    if (!keys.length) {
        const row = document.createElement('tr');
        const cell = el('td', 'empty-note', 'Настроек пока нет — добавьте первую');
        cell.colSpan = nodes.length + 3;
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    keys.forEach(key => tableBody.appendChild(renderRow(key)));
    applySearch();
}

function renderRow(key) {
    const entry = settingsMap[key];
    const row = document.createElement('tr');
    row.dataset.key = key;

    row.appendChild(el('td', 'setting-key', key));

    // Общая ячейка
    row.appendChild(buildValueCell(key, null, entry.global, ''));

    // Нодовые ячейки: пустая наследует общее значение (placeholder)
    nodes.forEach(n => {
        row.appendChild(buildValueCell(key, n.id, entry.nodes[n.id] ?? null, entry.global ?? ''));
    });

    const delCell = document.createElement('td');
    const delBtn = el('button', 'btn-row-delete', '✕');
    delBtn.type = 'button';
    delBtn.title = 'Удалить настройку (общее значение и все нодовые)';
    delBtn.onclick = () => deleteSetting(key);
    delCell.appendChild(delBtn);
    row.appendChild(delCell);

    return row;
}

function buildValueCell(key, nodeId, value, inheritedValue) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'cell-input' + (nodeId ? ' inherited' : '');
    input.value = value ?? '';
    input.dataset.saved = value ?? '';
    input.title = value ?? '';
    if (nodeId) input.placeholder = inheritedValue || '';

    input.oninput = () => { input.title = input.value; };
    input.onkeydown = e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = input.dataset.saved; input.title = input.dataset.saved; input.blur(); }
    };
    input.onchange = () => saveCell(key, nodeId, input);

    td.appendChild(input);
    return td;
}

async function saveCell(key, nodeId, input) {
    const value = input.value;
    if (value === input.dataset.saved) return;

    try {
        await postData('/api/setting', {key, node_id: nodeId, value});
        input.dataset.saved = value;

        const entry = settingsMap[key];
        if (nodeId) {
            if (value === '') delete entry.nodes[nodeId];
            else entry.nodes[nodeId] = value;
        } else {
            entry.global = value === '' ? null : value;
            // Обновляем placeholder наследования в нодовых ячейках строки
            const row = tableBody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
            if (row) row.querySelectorAll('.cell-input.inherited').forEach(i => i.placeholder = value);
        }

        input.classList.add('saved');
        setTimeout(() => input.classList.remove('saved'), 600);
    } catch (e) {
        showNotification(`Ошибка сохранения: ${e.message}`, 'error');
        input.value = input.dataset.saved;
    }
}

async function deleteSetting(key) {
    if (!confirm(`Удалить настройку "${key}" полностью (общее значение и все нодовые)?`)) return;
    try {
        await deleteData(`/api/setting/${encodeURIComponent(key)}`);
        delete settingsMap[key];
        renderBody();
        showNotification(`Удалено: ${key}`, 'success');
    } catch (e) {
        showNotification(`Ошибка удаления: ${e.message}`, 'error');
    }
}

// Новая настройка: строка с редактируемым ключом сверху таблицы
function createSettingRow() {
    if (tableBody.querySelector('tr.new-setting')) {
        tableBody.querySelector('tr.new-setting .key-input').focus();
        return;
    }

    const row = document.createElement('tr');
    row.className = 'new-setting';

    const keyCell = document.createElement('td');
    const keyInput = document.createElement('input');
    keyInput.className = 'cell-input key-input';
    keyInput.placeholder = 'название_настройки';
    keyCell.appendChild(keyInput);
    row.appendChild(keyCell);

    const valueCell = document.createElement('td');
    const valueInput = document.createElement('input');
    valueInput.className = 'cell-input';
    valueInput.placeholder = 'общее значение';
    valueCell.appendChild(valueInput);
    row.appendChild(valueCell);

    const filler = document.createElement('td');
    filler.colSpan = nodes.length;
    filler.innerHTML = '<span style="padding: 6px 10px; display:block; color:#b8c2cc; font-size:12px;">нодовые значения — после создания</span>';
    row.appendChild(filler);

    const delCell = document.createElement('td');
    const cancelBtn = el('button', 'btn-row-delete', '✕');
    cancelBtn.type = 'button';
    cancelBtn.title = 'Отменить';
    cancelBtn.onclick = () => row.remove();
    delCell.appendChild(cancelBtn);
    row.appendChild(delCell);

    const submit = async () => {
        const key = keyInput.value.trim();
        if (!key) { keyInput.focus(); return; }
        if (settingsMap[key]) {
            showNotification(`Настройка "${key}" уже существует`, 'warning');
            return;
        }
        try {
            await postData('/api/setting', {key, node_id: null, value: valueInput.value});
            settingsMap[key] = {global: valueInput.value || null, nodes: {}};
            renderBody();
            showNotification(`Создано: ${key}`, 'success');
        } catch (e) {
            showNotification(`Ошибка создания: ${e.message}`, 'error');
        }
    };

    [keyInput, valueInput].forEach(inp => {
        inp.onkeydown = e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') row.remove();
        };
    });
    valueInput.onblur = () => { if (keyInput.value.trim() && valueInput.value !== '') submit(); };

    tableBody.prepend(row);
    keyInput.focus();
}

function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    tableBody.querySelectorAll('tr[data-key]').forEach(row => {
        row.style.display = row.dataset.key.toLowerCase().includes(query) ? '' : 'none';
    });
}

searchInput.oninput = applySearch;
createBtn.onclick = createSettingRow;

initManager();
