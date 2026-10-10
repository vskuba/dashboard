"""Ручки страницы «Журнал»: сбои установки и счёт запросов к базе.

Страница отвечает на вопрос «что происходило на установке». Две подвкладки, и
предмет у них разный, поэтому ручки тоже разные:

* **Ошибки** — всё, что падает в любом процессе. Попадает туда само, заставой на
  корневом логгере (`journal_install`), без единой строчки про журнал в
  падающем коде.
* **MySQL** — запросы к базе: строка на ВИД запроса, числа складываются по
  отпечатку. Ответы базы не хранятся, секреты в значениях вырезаны.

⚠⚠ Роутеры собираются **фабрикой**: имена прав приходят доводом. Каталог прав —
предметная область проекта и в общий модуль не уезжает
(`py_modules/docs/panel.md`, § 1).

```python
app.include_router(journal_api_router(view=AuthPermission.JOURNAL_VIEW,
                                           delete=AuthPermission.JOURNAL_DELETE))
```

⚠ Подвкладка с другим предметом принесёт **свои** ручки: общей «дай журнал»
здесь нет намеренно — у разных предметов разные поля и разные отборы, и одна
лента утопила бы один в другом.
"""

from fastapi import APIRouter, Depends
from dashboard.src.panel.panel_auth import panel_auth_admin_required, panel_auth_need

from dashboard.src.page.journal.journal_mysql import (JOURNAL_MYSQL_PAGE,
                                      journal_mysql_clear,
                                      journal_mysql_delete,
                                      journal_mysql_flush,
                                      journal_mysql_rows,
                                      journal_mysql_trim)
from dashboard.src.page.journal.journal_store import (JOURNAL_STORE_PAGE,
                                      JOURNAL_STORE_PAGE_MAX,
                                      journal_store_clear,
                                      journal_store_delete,
                                      journal_store_rows,
                                      journal_store_trim)


def journal_api_router(view=None, delete=None) -> APIRouter:
    """Роутер страницы «Журнал» — обе подвкладки одним.

    Args:
        view: право на чтение. Пусто — только администратор.
        delete: право на уборку записей. Пусто — только администратор.

    Returns:
        APIRouter: подключается `app.include_router(...)`.

    ⚠ Подвкладки объявлены в ОДНОМ роутере, а не в двух: страница одна, и
    подключать её двумя строками значит однажды забыть вторую.
    """
    guard_view = panel_auth_need(view) if view else panel_auth_admin_required
    guard_delete = panel_auth_need(delete) if delete else panel_auth_admin_required

    router = APIRouter(tags=['journal'])
    errors = APIRouter(prefix='/api/journal')
    mysql = APIRouter(prefix='/api/journal/mysql')



    @mysql.get('', include_in_schema=False)
    async def journal_mysql_list(source: str = '', q: str = '', order: str = 'total_ms',
                                 page: int = 1, per_page: int = JOURNAL_MYSQL_PAGE,
                                 user=Depends(guard_view)):
        """Страница журнала запросов — самое дорогое сверху.

        Args:
            source: чей процесс (`uvicorn`, `worker`, `telegram`, `cronjob`). Пусто — любой.
            q: подстрока в тексте запроса или в его значениях.
            order: чем сортировать — `total_ms`, `max_ms`, `avg_ms`, `hits`, `rows`, `last_at`.
            page, per_page: страница и её размер.

        Returns:
            dict: `result` — `rows`, `total`, `page`, `pages`, `sources`, `orders`,
            `enabled`, `totals`.

        ⚠ Перед выдачей сбрасывает накопленное этим процессом (`journal_mysql_flush`):
        иначе человек, открывший страницу ради «что происходит прямо сейчас», видел
        бы картину получасовой давности плюс-минус такт сброса. Соседние процессы
        (воркеры, бот) сбрасывают своё сами, по своему такту.

        ⚠ Заодно чистит строки старше `JOURNAL_MYSQL_KEEP_DAYS`. Отдельного
        расписания у чистки нет намеренно — так же чистится подвкладка ошибок.
        """
        await journal_mysql_flush()
        await journal_mysql_trim()

        return {'result': await journal_mysql_rows(source=source, q=q, order=order,
                                                   page=page, per_page=per_page)}


    @mysql.delete('/{record_id}', include_in_schema=False)
    async def journal_mysql_remove(record_id: int,
                                   user=Depends(guard_delete)):
        """Убирает одну строку. Повторный вызов не ошибка: результат тот же."""
        return {'result': {'deleted': await journal_mysql_delete(record_id)}}


    @mysql.delete('', include_in_schema=False)
    async def journal_mysql_remove_all(source: str = '',
                                       user=Depends(guard_delete)):
        """Обнуляет счётчики целиком либо по одному процессу.

        Args:
            source: чей процесс убрать. Пусто — все.

        Здесь это обычный ход, а не крайняя мера: счётчики копятся с начала времён, и
        после правки запроса старые числа мешают увидеть, стало ли лучше.
        """
        return {'result': {'deleted': await journal_mysql_clear(source)}}



    @errors.get('', include_in_schema=False)
    async def journal_list(source: str = '', level: str = '', q: str = '',
                           page: int = 1, per_page: int = JOURNAL_STORE_PAGE,
                           user=Depends(guard_view)):
        """Страница журнала — свежее сверху.

        Args:
            source: чей процесс (`uvicorn`, `worker`, `telegram`, `cronjob`). Пусто — любой.
            level: `ERROR` или `CRITICAL`. Пусто — любой.
            q: подстрока в тексте записи, в трассировке или в имени логгера.
            page, per_page: страница и её размер.

        Returns:
            dict: `result` — `rows`, `total`, `page`, `pages`, `sources`.

        ⚠ Заодно чистит записи старше `JOURNAL_KEEP_DAYS`. Отдельного расписания у
        чистки нет намеренно — так же чистится трасса workflow, при показе списка.
        """
        await journal_store_trim()

        return {'result': await journal_store_rows(source=source, level=level, q=q,
                                             page=page, per_page=per_page)}


    @errors.delete('/{record_id}', include_in_schema=False)
    async def journal_remove(record_id: int,
                             user=Depends(guard_delete)):
        """Убирает одну запись — разобрались и больше не хотим её видеть.

        Повторный вызов не ошибка: результат тот же — записи нет.
        """
        return {'result': {'deleted': await journal_store_delete(record_id)}}


    @errors.delete('', include_in_schema=False)
    async def journal_remove_all(source: str = '',
                                 user=Depends(guard_delete)):
        """Чистит журнал целиком либо по одному источнику.

        Args:
            source: чей процесс убрать. Пусто — все.
        """
        return {'result': {'deleted': await journal_store_clear(source)}}
    # ⚠ Порядок включения: «mysql» с более длинным префиксом идёт ПЕРВЫМ.
    # Иначе `GET /api/journal/mysql` проглотится соседом, который слушает
    # `/api/journal` и считает «mysql» своим параметром.
    router.include_router(mysql)
    router.include_router(errors)
    return router
