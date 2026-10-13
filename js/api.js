// Вызовы ручек панели: четыре глагола, один разбор отказа, кука всегда с собой.
//
// ⚠⚠ **Файл общий, и он не «ещё один обёрточный модуль».** Его импортируют
// `user.js`, `setting_page.js`, `journal.js`, `cronicle.js`, `e2e.js` и
// `page_dom.js` — то есть ПОЧТИ ВСЕ страницы каркаса. Пока его здесь не было,
// каждая такая страница у нового проекта падала на первой строке импорта
// (`Failed to resolve module specifier`), и падала молча: вёрстка рисовалась,
// данные не приезжали никогда.
//
// ⚠ Проект, которому нужен свой вариант, кладёт `js/api.js` у себя: раздача ищет
// файл сперва у проекта (`panel_static_files`, свой каталог первым). Так и
// живут четыре установки, у которых он уже был, — этот файл их не трогает.
//
// ⚠⚠ Сведён **по богатой** из четырёх разошедшихся копий, как велит README:
// `error.status` пришёл от одной установки, `putData` с поддержкой FormData — от
// другой. Ни одна копия не была надмножеством остальных, и взять «ту, что
// проще» значило бы молча отнять работающий функционал у половины.

// Ошибка ответа API: вытягивает detail/message из JSON-тела, иначе — HTTP-статус.
// FastAPI кладёт причину в {detail: "..."} (или массив объектов при 422-валидации).
async function apiError(response) {
    let message = `Ошибка: ${response.status}`;
    try {
        const body = await response.json();
        const detail = body.detail ?? body.message;
        if (typeof detail === 'string' && detail) message = detail;
        else if (detail) message = JSON.stringify(detail);
    } catch {
        // тело не JSON (HTML от прокси и т.п.) — оставляем статус
    }

    // ⚠ Код ответа — **полем ошибки**, а не только в тексте. Страница иногда
    // обязана различать «не вышло» и «этого уже нет»: 404 на удалении означает,
    // что цель человека достигнута, и показывать ему красное «карточки #3 нет»
    // про то, что он видит на экране, — пугать без повода.
    //
    // Разбирать текст вместо кода — примета, которая рассыплется от первой же
    // правки формулировки в роутере.
    const error = new Error(message);
    error.status = response.status;

    return error;
}

export async function getData(url) {
    const options = {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    };

    const response = await fetch(url, options);
    if (!response.ok) throw await apiError(response);
    return await response.json();
}

export async function postData(url, data = {}) {
    // ⚠ FormData (с файлами) уходит как есть: свой `Content-Type` с границей
    // multipart браузер ставит сам, и заданный руками `application/json` сломал
    // бы разбор тела на сервере.
    const options = {
        method: 'POST',
        headers: data instanceof FormData ? {} : {'Content-Type': 'application/json'},
        body: data instanceof FormData ? data : JSON.stringify(data),
        credentials: 'include'
    };

    const response = await fetch(url, options);
    if (!response.ok) throw await apiError(response);
    return await response.json();
}

export async function putData(url, data = {}) {
    // Как `postData`: FormData (с файлами) уходит как есть, объект — как JSON.
    const options = {
        method: 'PUT',
        headers: data instanceof FormData ? {} : {'Content-Type': 'application/json'},
        body: data instanceof FormData ? data : JSON.stringify(data),
        credentials: 'include'
    };

    const response = await fetch(url, options);
    if (!response.ok) throw await apiError(response);
    return await response.json();
}

export async function deleteData(url) {
    const options = {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include'
    };

    const response = await fetch(url, options);
    if (!response.ok) throw await apiError(response);
    return await response.json();
}
