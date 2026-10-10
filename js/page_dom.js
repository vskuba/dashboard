/* Мелочь, которую писала каждая страница панели заново.
 *
 * ⚠⚠ Собрано не «на будущее», а по факту повтора: `el(...)` лежал в ЧЕТЫРЁХ
 * файлах каркаса (cronicle, e2e, journal, setting) в двух слегка разных
 * вариантах, а мягкая загрузка списка — в двух под разными именами
 * (`nodesLoad`, `optionalList`). Одна логика в пяти местах расходится на первой
 * же правке: у двух копий `el` уже разошлась проверка на `null`.
 *
 * Взят богатый вариант: `null` отсекается наравне с `undefined`. Иначе
 * `el('div', null, null)` рисует строку «null» — и видно это только глазами.
 */

import {getData} from '/static/js/api.js';

/**
 * Узел с классом и текстом — то, из чего собраны все списки панели.
 *
 * @param {string} tag       имя тега
 * @param {?string} className класс; пусто — без класса
 * @param {?string} text      текст; `undefined` или `null` — без текста
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/**
 * Список, которого может не быть на этой установке.
 *
 * ⚠⚠ Отказ здесь — не беда, а ответ «такого у нас нет», и потому он глотается.
 * Ручки вроде `/node/list` есть не у всех панелей: раньше они шли одним
 * `Promise.all` с обязательными запросами, и отказ любого ронял страницу
 * целиком — человек видел не «страницу без узлов», а пустоту со строкой в
 * консоли.
 *
 * ⚠ Беду покажет обязательный запрос рядом: он остаётся без обёртки намеренно.
 *
 * @param {string} url адрес ручки
 * @returns {Promise<Array>} строки или пустой список
 */
export async function optionalList(url) {
    try {
        const answer = await getData(url);
        const rows = answer.result;
        return Array.isArray(rows) ? rows : (rows?.rows || []);
    } catch (err) {
        return [];
    }
}
