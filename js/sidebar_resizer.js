/**
 * Draggable-разделители для страниц панели. Три входа на одном движке:
 *   initSidebarResizer      — вертикальный (меняет ШИРИНУ панели СЛЕВА);
 *   initSidebarResizerRight — он же для панели СПРАВА: тянем влево — растёт;
 *   initRowResizer          — горизонтальный (меняет ВЫСОТУ панели сверху).
 * Позиция запоминается в localStorage (per-браузер). Двойной клик — сброс
 * в дефолт (inline-стиль и сохранённое значение удаляются).
 *
 * ⚠⚠ Файл живёт в каркасе, а не у проекта, и это не уборка. Два проекта имели
 * его своей копией, и копии разошлись: у одного остался только вертикальный
 * разделитель без сброса и без ограничения по окну. Общая страница панели при
 * этом зовёт `initSidebarResizer` — то есть молча рассчитывает на то, что файл
 * у проекта есть. У кого не было, разделитель просто не появлялся: ни отказа,
 * ни записи в консоли, страница выглядела задуманной.
 *
 * ⚠ Не модуль, а глобальные функции: его подключают и шаблоны inline-кодом, и
 * ES-модули страниц — а inline-скрипт импортировать не умеет. Шаблон каркаса,
 * которому разделитель нужен, подключает этот файл САМ, строкой перед своим
 * скриптом.
 *
 * @param {string} resizerId   - id элемента-разделителя
 * @param {string} storageKey  - ключ localStorage
 * @param {Element} target     - элемент, размер которого меняется
 * @param {number} min         - минимум px
 * @param {number} max         - максимум px (для ширины дополнительно ограничен 60% окна)
 */
function makeResizer(resizerId, storageKey, target, axis, min, max, invert = false) {
    const resizer = document.getElementById(resizerId);
    if (!resizer || !target) return;

    const prop = axis === 'x' ? 'width' : 'height';
    const cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    const clampMax = () => (axis === 'x'
        ? Math.min(max, Math.floor(window.innerWidth * 0.6))
        : Math.min(max, Math.floor(window.innerHeight * 0.75)));

    // Восстановление позиции из localStorage.
    const saved = parseInt(localStorage.getItem(storageKey), 10);
    if (saved && saved >= min && saved <= clampMax()) target.style[prop] = saved + 'px';

    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        const start = axis === 'x' ? e.clientX : e.clientY;
        const startSize = target.getBoundingClientRect()[axis === 'x' ? 'width' : 'height'];
        resizer.classList.add('dragging');
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';

        function onMove(ev) {
            // У панели СПРАВА от разделителя движение мыши влево должно её
            // расширять, а не сужать: ползёт её левый край, а не правый.
            const delta = ((axis === 'x' ? ev.clientX : ev.clientY) - start) * (invert ? -1 : 1);
            const size = Math.min(clampMax(), Math.max(min, Math.round(startSize + delta)));
            target.style[prop] = size + 'px';
        }
        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem(storageKey, Math.round(target.getBoundingClientRect()[axis === 'x' ? 'width' : 'height']));
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Двойной клик — сброс в дефолт.
    resizer.addEventListener('dblclick', () => {
        target.style[prop] = '';
        localStorage.removeItem(storageKey);
    });
}

function initSidebarResizer(resizerId, storageKey, sidebar, minW = 160, maxW = 520) {
    makeResizer(resizerId, storageKey, sidebar, 'x', minW, maxW);
}

/** То же для колонки СПРАВА от разделителя: тянем влево — она растёт. */
function initSidebarResizerRight(resizerId, storageKey, sidebar, minW = 160, maxW = 520) {
    makeResizer(resizerId, storageKey, sidebar, 'x', minW, maxW, true);
}

function initRowResizer(resizerId, storageKey, panel, minH = 90, maxH = 800) {
    makeResizer(resizerId, storageKey, panel, 'y', minH, maxH);
}
