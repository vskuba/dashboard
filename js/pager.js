/* Пейджер списка — ОБЩИЙ: лежит в submodule `dashboard`.
 *
 * ⚠⚠ Собран не «на будущее», а по факту повтора: «← назад · N из M · вперёд →»
 * был написан в ПЯТИ файлах трёх проектов (покупатели и отпечатки CyberAi,
 * темы и история RhapsodyAi, лента DatingAi). Одна разметка в пяти местах
 * расходится на первой же правке — у двух копий уже по-разному вело себя
 * «вперёд» на последней странице.
 *
 * Арифметику страниц считает общий слой (`py_modules/page_/page_slice.py`), и
 * сюда приезжает готовый конверт: `{page, pages, total, shown}`.
 *
 * ⚠ Пейджер НЕ ходит за данными сам. Он получает `onPage(номер)` и зовёт его:
 * где лежит список, чем он фильтруется и что делать с отказом — дело страницы,
 * и тащить это в общий модуль значит тащить туда знание о каждом проекте.
 */

import {el} from '/static/js/page_dom.js';

/**
 * Нарисовать пейджер в контейнере.
 *
 * @param {HTMLElement} box    куда рисовать; очищается
 * @param {Object} data        конверт страницы: `{page, pages, total, shown}`
 * @param {Function} onPage    что звать при смене: `onPage(номер)`
 * @param {Object} [options]   `{always: false}` — рисовать и при одной странице
 * @returns {boolean}          нарисован ли пейджер
 *
 * ⚠ При одной странице по умолчанию НЕ рисуется: кнопки «назад/вперёд», обе
 * выключенные, выглядят поломкой, а не подсказкой. Списку, который растёт на
 * глазах (лента), это переключается `always`.
 */
export function pager(box, data, onPage, options = {}) {
    if (!box) return false;

    box.innerHTML = '';
    const pages = Number(data?.pages) || 1;
    const page = Math.min(Math.max(1, Number(data?.page) || 1), pages);
    if (pages < 2 && !options.always) return false;

    box.appendChild(pagerButton('← назад', page <= 1, () => onPage(page - 1)));
    box.appendChild(el('span', 'pager-at', `${page} из ${pages}`));
    box.appendChild(pagerButton('вперёд →', page >= pages, () => onPage(page + 1)));

    // ⚠ Общее число — подсказкой, а не отдельной строкой: место под пейджером
    // ценнее, а «сколько всего» спрашивают редко.
    if (data?.total) box.title = `всего: ${data.total}`;

    return true;
}

/**
 * Подпись «показано N из M» — её пишут рядом со счётчиком списка.
 *
 * ⚠ Отдельной функцией, а не внутри `pager`: счётчик живёт в шапке списка, а
 * пейджер под таблицей, и склеивать их значило бы требовать от страницы
 * держать их рядом.
 *
 * @param {Object} data конверт страницы
 * @returns {string}    подпись; список целиком на экране — без «из»
 */
export function pagerCount(data, word = 'строк') {
    const total = Number(data?.total) || 0;
    const shown = Number(data?.shown) || 0;

    return shown < total ? `${shown} из ${total} ${word}` : `${total} ${word}`;
}

function pagerButton(text, off, onClick) {
    const btn = el('button', 'pager-btn', text);
    btn.type = 'button';
    btn.disabled = !!off;
    btn.onclick = onClick;

    return btn;
}
