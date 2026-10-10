"""Ручки страницы «Тесты → E2E»: прогоны, случаи, кадры.

Роутер собирается **фабрикой**, а не объявляется готовым: имена прав приходят
доводом. Приём тот же, что у `panel_setting_api`, и причина та же.

⚠⚠ Каталог прав в общий модуль не уезжает ни при каких условиях: `e2e:view` —
имя предметной области проекта, и модуль с ним перестаёт быть переносимым
(`py_modules/docs/panel.md`, § 1). Здесь известно только, что право **нужно**, и
что их два разных: смотреть и действовать.

```python
app.include_router(e2e_api_router(view=AuthPermission.E2E_VIEW,
                                  run=AuthPermission.E2E_RUN))
```

⚠ Кадр отдаётся по **номеру строки**, а не по пути: путь берётся из базы.
Присланный путь не спасает никакая проверка — `..%2f` и симлинк превращают
раздачу кадров в чтение любого файла контейнера.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from dashboard.src.panel.panel_auth import panel_auth_admin_required, panel_auth_need
from pydantic import BaseModel

from dashboard.src.page.e2e.e2e_case import e2e_case_enable, e2e_case_list
from dashboard.src.page.e2e.e2e_run import E2E_RUN_CASE_DIR
from dashboard.src.page.e2e.e2e_shot import e2e_shot_path
from dashboard.src.page.e2e.e2e_store import (E2E_STORE_API_PREFIX, e2e_store_row_get,
                            e2e_store_run_list, e2e_store_run_rows)
from dashboard.src.page.e2e.e2e_worker import e2e_worker_enqueue, e2e_worker_running


class E2eApiEnableIn(BaseModel):
    """Тело переключателя случая."""
    enabled: bool


def e2e_api_router(view=None, run=None, prefix: str = E2E_STORE_API_PREFIX) -> APIRouter:
    """Роутер страницы «Тесты».

    Args:
        view: право на чтение (имя строкой или значение Enum). Пусто — только
            администратор.
        run: право на действие — прогон и переключатель. Пусто — только
            администратор.
        prefix: путь ручек; менять незачем, но проект вправе.

    Returns:
        APIRouter: подключается `app.include_router(...)`.

    ⚠ Право на действие отдельное от чтения, и это не формальность: прогон
    поднимает браузер и ходит по страницам панели, а выключенный случай молча
    перестаёт проверяться — узнают об этом по ненайденной поломке.
    """
    guard_view = panel_auth_need(view) if view else panel_auth_admin_required
    guard_run = panel_auth_need(run) if run else panel_auth_admin_required

    router = APIRouter(prefix=prefix, tags=['e2e'])

    @router.get('/run', include_in_schema=False)
    async def e2e_run_list_route(limit: int = 30, user=Depends(guard_view)):
        """Список прогонов — свежий сверху."""
        return {'result': await e2e_store_run_list(limit=limit)}

    @router.post('/run', include_in_schema=False)
    async def e2e_run_start_route(user=Depends(guard_run)):
        """Прогнать случаи сейчас, не дожидаясь расписания.

        ⚠⚠ Работа уезжает в очередь, а ручка отвечает сразу: прогон длится
        минуты, и держать на нём обработчик запроса нельзя — браузер оборвёт его
        по своему таймауту, а работа останется идти в осиротевшем обработчике.
        """
        return {'result': e2e_worker_enqueue()}

    @router.get('/run/status', include_in_schema=False)
    async def e2e_run_status_route(user=Depends(guard_view)):
        """Идёт ли прогон прямо сейчас.

        ⚠ Объявлено **выше** `/run/{run_uuid}`: иначе FastAPI отдаст этот адрес
        обработчику с параметром, и `status` приедет туда как имя прогона.
        """
        return {'result': {'running': e2e_worker_running()}}

    @router.get('/run/{run_uuid}', include_in_schema=False)
    async def e2e_run_get_route(run_uuid: str, user=Depends(guard_view)):
        """Один прогон целиком; `last` — самый свежий."""
        return {'result': await e2e_store_run_rows('' if run_uuid == 'last' else run_uuid)}

    @router.get('/row/{row_id}', include_in_schema=False)
    async def e2e_row_get_route(row_id: int, user=Depends(guard_view)):
        """Одна строка теста — кадр, области, консоль."""
        row = await e2e_store_row_get(row_id)
        if not row:
            raise HTTPException(status_code=404, detail='Строка теста не найдена')
        return {'result': row}

    @router.get('/shot/{row_id}', include_in_schema=False)
    async def e2e_shot_route(row_id: int, plain: int = 0, user=Depends(guard_view)):
        """Кадр строки теста картинкой; `plain=1` — без рамок областей."""
        row = await e2e_store_row_get(row_id)
        if not row:
            raise HTTPException(status_code=404, detail='Строка теста не найдена')

        path = e2e_shot_path((row.get('shot_plain_path') if plain
                              else row.get('shot_path')) or '')
        if not path:
            raise HTTPException(status_code=404, detail='Кадр не найден')
        return FileResponse(path, media_type='image/png')

    @router.get('/case', include_in_schema=False)
    async def e2e_case_list_route(user=Depends(guard_view)):
        """Случаи установки с признаком «включён».

        ⚠ Список берётся из файлов случаев, а не из таблицы результатов: случай,
        который ещё ни разу не гоняли, тоже обязан быть виден — иначе его нечем
        включить.
        """
        return {'result': await e2e_case_list(E2E_RUN_CASE_DIR)}

    @router.put('/case/{case_file}/enabled', include_in_schema=False)
    async def e2e_case_enable_route(case_file: str, body: E2eApiEnableIn,
                                    user=Depends(guard_run)):
        """Включить или выключить случай.

        ⚠⚠ Имя случая сверяется со списком файлов, а не берётся из адреса как
        есть: иначе в таблицу уехала бы любая присланная строка, а список на
        странице молча оброс бы выдуманными именами.
        """
        known = {one['file']: one['name'] for one in await e2e_case_list(E2E_RUN_CASE_DIR)}
        if case_file not in known:
            raise HTTPException(status_code=404, detail='Случая с таким файлом нет')

        enabled = await e2e_case_enable(case_file, body.enabled, known[case_file])
        return {'result': {'file': case_file, 'enabled': enabled}}

    return router
