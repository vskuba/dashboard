"""Хранилище страницы «Сценарии»: то, что знает про её таблицы и файлы.

Механизм сценариев живёт в общем слое (`py_modules/browser_/`) — схема шагов,
прогон через контейнер, разбор трассы. Здесь то, что нужно **странице** и
больше никому: очистка истории по кнопке.

## ⚠⚠ Работа с базой — здесь, а не в слое

Граница проходит по тому, кто владеет данными. Слой — инструменты: он умеет
снять кадр, разобрать шаг, собрать плёнку. Таблицы и файлы установки
принадлежат ей, и обвязка, которая их читает и удаляет, живёт рядом со
страницей — как `journal_store.py` и `e2e_store.py` по соседству.

⚠ Цена иного: функция в слое приезжает submodule-ом во все проекты сразу, и
удаление, написанное для одной панели, оказывается в тех, где этой кнопки
нет вовсе.
"""

import pathlib

from browser_.browser_scenario_store import (BROWSER_SCENARIO_FILM_DIR,
                                             BROWSER_SCENARIO_FILM_OK)
from logging_.logging_ import logger_info
from mysql_.mysql_ import mysql_get_db_async
from project_.project_ import project_root


async def scenario_page_store_history_clear(site_id: int = 0) -> dict:
    """Убрать прогоны с плёнками: записи журнала и сами файлы GIF.

    Args:
        site_id: чьи прогоны чистим; `0` — все, какие есть.

    Returns:
        `{'runs': сколько записей убрано, 'films': сколько файлов удалено}`.

    ⚠⚠ Чистятся ТОЛЬКО прогоны с плёнкой — ровно то, что показывает история.
    Остальные записи журнала это отрезки: сценарий заказа гоняют по шагу за
    поход, и на одну карточку их семьдесят одна. Человек, нажавший «очистить
    историю», убирает девять карточек, которые видит, а не шестьсот строк, о
    которых не знает: трасса шагов нужна разбору отказов и живёт своей
    жизнью.

    ⚠⚠ Файл удаляется ПЕРЕД записью, а не после. Обратный порядок на отказе
    базы оставил бы сироту: запись есть, файла нет, и история показывала бы
    битую картинку. Сирота наоборот (файл без записи) безвреден — на него
    никто не сошлётся.

    ⚠ Имя файла проверяется тем же `BROWSER_SCENARIO_FILM_OK`, что и при
    отдаче: в базе лежит строка, а мы по ней удаляем файл, и чужая форма
    здесь стоила бы чужого файла.
    """
    rows = await _history_rows(site_id)
    films = _films_drop(rows)
    await _runs_drop([row['id'] for row in rows])

    logger_info(f'[сценарии] история очищена: прогонов {len(rows)}, '
                f'плёнок {films}')

    return {'runs': len(rows), 'films': films}


# ── детали реализации ──────────────────────────────────────────────────────

async def _history_rows(site_id: int) -> list:
    """Прогоны с плёнками — те самые, что показывает история.

    ⚠ Площадка у СЦЕНАРИЯ, а не у прогона: прогон знает только свой сценарий,
    и без присоединения чистка по площадке забрала бы чужое.
    """
    where = ["r.`film` <> ''"]
    args: list = []
    if site_id:
        where.append('s.`site_id` = %s')
        args.append(int(site_id))

    async with mysql_get_db_async() as db:
        await db.execute(
            'SELECT r.`id`, r.`film` FROM `browser_scenario_run` r'
            '  JOIN `browser_scenario` s ON s.`id` = r.`scenario_id`'
            f'  WHERE {" AND ".join(where)}', args)

        return [dict(row) for row in await db.fetchall() or []]


def _films_drop(rows: list) -> int:
    """Удалить файлы плёнок; вернуть, сколько удалось.

    ⚠ Отказ одного файла не останавливает остальные: права могли съехать на
    одном из сотни, и бросать из-за него значит не вычистить ничего.
    """
    root = pathlib.Path(project_root()) / BROWSER_SCENARIO_FILM_DIR
    gone = 0
    for row in rows:
        name = str(row.get('film') or '')
        if not BROWSER_SCENARIO_FILM_OK.match(name):
            continue
        try:
            (root / name).unlink()
            gone += 1
        except FileNotFoundError:
            pass
        except OSError as fault:
            logger_info(f'[сценарии] плёнка {name} не удалилась: {fault}')

    return gone


async def _runs_drop(ids: list) -> None:
    """Убрать записи прогонов одним запросом; пустой список — ничего."""
    if not ids:
        return

    async with mysql_get_db_async() as db:
        await db.execute(
            'DELETE FROM `browser_scenario_run` WHERE `id` IN (%s)'
            % ','.join(['%s'] * len(ids)), ids)
