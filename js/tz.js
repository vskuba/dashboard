// Пояс установки для страниц панели: `loadTz()` один раз на страницу, дальше
// `fmtTz(value)` над строками UTC из базы.
//
// ⚠⚠ Скрипт глобальный, а не ESM-модуль, и это не наследие. Его зовут обе
// половины: модули каркаса (`e2e.js`, `journal.js`, `cronicle.js`) и inline-код
// шаблонов (`seed.html`, `backup.html`), а inline-скрипт импортировать не умеет.
// Пока файл лежал у одного проекта, у соседей общая страница молча умирала
// на `ReferenceError: loadTz is not defined` — вёрстка при этом рисовалась, и
// страница выглядела живой, просто навсегда «Загрузка…».
//
// ⚠ Отсюда правило: общий шаблон, который зовёт `loadTz`/`fmtTz`, подключает
// этот файл **сам**, строкой перед своим модулем, и не надеется на base.html
// проекта.
(function () {
    window.APP_TZ_OFFSET = 0; // minutes

    window.loadTz = async function () {
        try {
            const r = await fetch('/api/setting');
            const data = await r.json();
            const row = (data.result?.settings || []).find(s => s.key === 'timezone' && !s.node_id);
            if (row) {
                const m = String(row.value || '').match(/([+-]?\d+)/);
                if (m) window.APP_TZ_OFFSET = parseInt(m[1], 10) * 60;
            }
        } catch {}
    };

    window.fmtTz = function (value, withSeconds) {
        if (!value) return '—';
        const raw = String(value).replace(' ', 'T');
        const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z');
        if (isNaN(d.getTime())) return String(value).slice(0, withSeconds ? 19 : 16);
        const local = new Date(d.getTime() + window.APP_TZ_OFFSET * 60000);
        const pad = n => String(n).padStart(2, '0');
        const base = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
        return withSeconds ? base + ':' + pad(local.getUTCSeconds()) : base;
    };
})();
