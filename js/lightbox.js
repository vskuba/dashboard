// Карусель кадров — общая для всех страниц панели.
//
// Кадров в панели всегда больше одного: прогон сценария снимает этап за этапом,
// проверка страницы — до и после. Смотрят их подряд, сравнивая соседние, и
// открывать каждый отдельной вкладкой значит заставить человека щёлкать «назад»
// между двумя картинками, которые он хотел положить рядом.
//
// Пользоваться:
//
//     import {lightbox} from './lightbox.js';
//
//     lightbox([{src: '/api/shot/1', title: 'форма заполнена'}, …], 2);
//
// ⚠ Своё окно не заводится: открывается общее (`modal.js`), и крестик, Escape,
// возврат фокуса и запрет прокрутки фона достаются оттуда. Второе окно со своим
// Escape — это спор о том, какое из них он закрывает.
import {modalOpen} from './modal.js';

// Листание стрелками. ⚠ Вешается на документ, а не на картинку: фокус после
// открытия стоит на крестике окна (так его ставит `modal.js`), и слушатель на
// картинке не услышал бы ничего.
let lightboxKey = null;

/**
 * Открывает кадры каруселью, начиная с указанного.
 *
 * @param {Array<{src: string, title?: string}>} shots — кадры по порядку.
 * @param {number} start — с какого начать; за пределами списка — с первого.
 * @returns {HTMLElement|null} узел окна; пустой список — `null` и ничего не
 *     открывается: окно с подписью «кадров нет» ничем не лучше его отсутствия.
 *
 * ⚠ Картинки НЕ подгружаются заранее. Кадр страницы весит десятки килобайт, их
 * бывает два десятка, и тянуть все ради того, что человек посмотрит три, —
 * плата за догадку о его намерении.
 */
export function lightbox(shots, start = 0) {
    const list = (shots || []).filter(one => one && one.src);
    if (!list.length) return null;

    let at = Number(start) || 0;
    if (at < 0 || at >= list.length) at = 0;

    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<button type="button" class="lightbox-step" data-step="-1"'
        + ' title="Предыдущий кадр" aria-label="Предыдущий кадр">‹</button>'
        + '<div class="lightbox-stage"><img class="lightbox-img" alt=""></div>'
        + '<button type="button" class="lightbox-step" data-step="1"'
        + ' title="Следующий кадр" aria-label="Следующий кадр">›</button>';

    const img = box.querySelector('.lightbox-img');
    const node = modalOpen({title: 'Кадры', body: box, onClose: lightboxStop});
    // ⚠⚠ Окно расширяется под кадр. Умолчание модалки — 920×760: оно рассчитано
    // на текст и форму, а кадр страницы магазина при нём обрезается снизу ровно
    // там, где стоит кнопка, ради которой его и открыли.
    node.classList.add('lightbox-back');
    const title = node.querySelector('.modal-title');
    const note = node.querySelector('.modal-note');

    const show = () => {
        const one = list[at];
        img.src = one.src;
        img.alt = one.title || 'кадр страницы';
        // Подпись и счёт идут в шапку окна, а не под картинку: внизу их
        // выдавливает за край высокий кадр — ровно на тех, где они нужнее.
        title.textContent = one.title || 'кадр';
        note.textContent = `${at + 1} из ${list.length}`;
        // ⚠ Стрелки не прячутся, а гаснут: исчезающая кнопка сдвигает кадр, и
        // следующий щелчок попадает не туда, куда целились.
        box.querySelectorAll('.lightbox-step').forEach(btn => {
            const to = at + Number(btn.dataset.step);
            btn.disabled = to < 0 || to >= list.length;
        });
    };

    const step = by => {
        const to = at + by;
        if (to < 0 || to >= list.length) return;
        at = to;
        show();
    };

    box.querySelectorAll('.lightbox-step').forEach(btn => {
        btn.onclick = () => step(Number(btn.dataset.step));
    });

    lightboxStop();
    lightboxKey = event => {
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', lightboxKey);

    show();

    return node;
}

/** Снимает слушатель стрелок. Зовётся закрытием окна; руками — не нужно. */
export function lightboxStop() {
    if (!lightboxKey) return;

    document.removeEventListener('keydown', lightboxKey);
    lightboxKey = null;
}
