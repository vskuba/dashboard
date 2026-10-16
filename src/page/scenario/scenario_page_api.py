"""Ручки страницы «Сценарии»: что браузер делает на чужом сайте и чем проверить.

Механизм сценариев живёт в общем слое (`py_modules/browser_/`): схема шагов,
хранение, прогон через контейнер. Там он **инструмент** — им работают и из
скрипта. Здесь — страница: права, выбор площадки, сборка снимка и форма отказа.

## ⚠⚠ Площадки скелет не знает, и это довод, а не импорт

У одного проекта площадка — интернет-магазин (`cyber_site`), у другого сайт
знакомств (`browser_site`), у третьего её нет вовсе. Поэтому список площадок
приходит **функцией** (`sites=`), как имена прав: страница спрашивает «какие у
тебя площадки», а не тянет чужую таблицу.

```python
app.include_router(scenario_page_api_router(
    view=AuthPermission.SCENARIO_VIEW,
    update=AuthPermission.SCENARIO_UPDATE,
    sites=orders_site_list))
```

⚠ Опустили `sites` — страница работает без площадок: сценарии лягут с
`site_id = 0`, то есть «общие для установки». Это рабочий случай, а не
вырожденный: у панели без магазинов сценарий всё равно один на всех.

## ⚠⚠ Справочник действий отдаётся странице, а не повторяется в ней

`BROWSER_SCENARIO_ACTIONS` — закрытый список: чего в нём нет, того сценарий
сделать не может. Форма шага строится по нему, и второй список в разметке
разошёлся бы со схемой в день, когда в неё добавят действие, — причём молча:
страница показывала бы поле, которого схема не ждёт.

## ⚠ Прогон отвечает кодом 200 даже когда сценарий упал

Упавший на третьем шаге сценарий — это `status: "error"` с трассой, а не ошибка
HTTP: сервер отработал верно, не отработал чужой сайт. Пятисотка здесь уводила
бы отказ в журнал ошибок установки, где ему не место.
"""

from browser_.browser_scenario import BROWSER_SCENARIO_ACTIONS
from browser_.browser_scenario_store import (browser_scenario_execute,
                                             browser_scenario_get,
                                             browser_scenario_list,
                                             browser_scenario_remove,
                                             browser_scenario_film_path,
                                             browser_scenario_runs,
                                             browser_scenario_save)
from browser_.browser_site_variable import (browser_site_variable_list,
                                            browser_site_variable_remove,
                                            browser_site_variable_save)
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from dashboard.src.panel.panel_auth import (panel_auth_admin_required,
                                            panel_auth_need)

# Сколько прогонов показать под сценарием. Не весь журнал: человеку важно
# последнее, а ленту целиком читает тот, кто разбирает отказ.
SCENARIO_PAGE_RUNS = 20

# Сколько прогонов показывает история. ⚠ Двадцать, а не сто: её смотрят, чтобы
# понять «что было только что», и сотня плёнок по полмегабайта — это полсотни
# мегабайт, которые браузер потянет при каждом открытии вкладки.
SCENARIO_PAGE_HISTORY = 20

# Состояния сценария. ⚠ Не свободная строка: по ним страница красит строку, и
# четвёртое состояние «почти работает» завелось бы само собой.
SCENARIO_PAGE_STATUSES = ('draft', 'active', 'broken')


class ScenarioPageSaveIn(BaseModel):
    """Сценарий целиком: шаги приходят списком, а не по одному."""

    id: int = 0
    site_id: int = 0
    name: str = Field(..., min_length=1, max_length=190)
    goal: str = ''
    start_url: str = ''
    status: str = 'draft'
    steps: list = Field(default_factory=list)
    variables: dict = Field(default_factory=dict)
    # Темп: пауза перед каждым шагом, случайная в этих пределах. ⚠ `None`, а не
    # ноль по умолчанию: ноль значит «без пауз», то есть нечеловеческий ритм, и
    # получать его от клиента, который про темп ничего не прислал, нельзя.
    pace_min_ms: int | None = Field(None, ge=0, le=60000)
    pace_max_ms: int | None = Field(None, ge=0, le=60000)


class ScenarioPageRunIn(BaseModel):
    """Прогон: значения переменных на этот раз.

    ⚠ Секреты отдельной сумкой — не формальность: контейнер замазывает их в
    трассе и в текстах ошибок, а обычные переменные уходят в журнал как есть.
    """

    variables: dict = Field(default_factory=dict)
    secrets: dict = Field(default_factory=dict)
    proxy: str = ''


class ScenarioPageVariableIn(BaseModel):
    """Переменная площадки: та, что одна на все её сценарии."""

    id: int = 0
    site_id: int
    name: str = Field(..., min_length=1, max_length=80)
    value: str = ''
    is_secret: bool = False


class ScenarioPageDropIn(BaseModel):
    """Что убрать — по номеру."""

    id: int


def scenario_page_api_router(view=None, update=None, sites=None) -> APIRouter:
    """Роутер страницы «Сценарии».

    Args:
        view: право на просмотр; пусто — точка открыта полноправному.
        update: право на правку и прогон.
        sites: корутина без доводов, отдающая площадки установки списком
            словарей с `id` и `name`. Пусто — страница живёт без площадок.

    ⚠ Роутер отдаётся **функцией**, а не переменной модуля: два приложения в
    одном процессе (так живут тесты) получили бы один объект с уже навешенными
    роутами (`panel.md`, §5).
    """
    # ⚠ Право не задано — точка достаётся полноправному, а не открывается всем:
    # `panel_auth_need(None)` потребовал бы право с именем `None` и отказал бы
    # каждому. Тот же приём, что у соседних страниц скелета.
    guard_view = panel_auth_need(view) if view else panel_auth_admin_required
    guard_update = panel_auth_need(update) if update else panel_auth_admin_required

    router = APIRouter(prefix='/api/scenario', tags=['scenario'])

    @router.get('', include_in_schema=False)
    async def scenario_page_view(site_id: int = 0,
                                 user=Depends(guard_view)):
        """Снимок страницы: площадки, сценарии выбранной, её переменные, схема.

        Одной точкой, а не четырьмя: страница открывает колонки разом, и
        человеку не стоит видеть, как они дорисовываются друг за другом.
        """
        known = await _sites_of(sites)
        site_id = int(site_id) if any(int(row['id']) == int(site_id)
                                      for row in known) else _site_first(known)

        return {'result': {
            'sites': known,
            'site_id': site_id,
            'scenarios': await browser_scenario_list(site_id),
            'variables': await browser_site_variable_list(site_id) if site_id else [],
            # Справочник действий — со схемы, а не списком в разметке (см. шапку).
            'actions': [{'action': name, 'fields': list(fields)}
                        for name, fields in sorted(BROWSER_SCENARIO_ACTIONS.items())],
            'statuses': list(SCENARIO_PAGE_STATUSES),
        }}

    @router.get('/history', include_in_schema=False)
    async def scenario_page_history(site_id: int = 0,
                                    limit: int = SCENARIO_PAGE_HISTORY,
                                    user=Depends(guard_view)):
        """Последние прогоны площадки с плёнками: что и как шло.

        ⚠⚠ Стоит ВЫШЕ `/{scenario_id}` намеренно. Пути одной группы
        разбираются по порядку объявления, и «history» под шаблоном читался
        как номер сценария — ручка отвечала «Сценарий: нужно число».
        Поймано кадром страницы, а не кодом.

        ⚠⚠ Прогоны ВСЕХ сценариев вместе, а не одного. История отвечает на
        вопрос «что тут происходило», и перебирать ради него сценарии по
        одному значит заставлять человека искать то, что должно само лежать
        перед глазами.

        ⚠ Трасса и собранное из ответа убраны: списком их не читают, а на
        длинном сценарии это десятки килобайт на строку — двадцать прогонов
        дали бы мегабайт ради двадцати подписей. Нужна трасса — её отдаёт
        `/{id}/runs`.
        """
        rows = await browser_scenario_runs(limit=limit * 8, site_id=site_id)

        # ⚠⚠ Только прогоны С ПЛЁНКОЙ. Сценарий гоняют и пошагово — отрезками
        # по одному шагу, чтобы рассказывать о каждом, — и в журнал ложится
        # запись на КАЖДЫЙ шаг: семьдесят одна на одну карточку заказа.
        # Истории нужна работа целиком, а её отмечает плёнка: она собирается
        # один раз, тем, кто вёл сценарий от начала до конца.
        rows = [row for row in rows if int(row.get('film_frames') or 0)][:limit]

        return {'result': [{
            'id': row['id'],
            'scenario_id': row['scenario_id'],
            'scenario': row.get('scenario_name') or '',
            'status': row['status'],
            'step_no': row['step_no'],
            'error': str(row.get('error') or '')[:300],
            'duration_ms': row['duration_ms'],
            'created_at': row['created_at'],
            'frames': int(row.get('film_frames') or 0),
        } for row in rows]}

    @router.get('/run/{run_id}/film', include_in_schema=False)
    async def scenario_page_film(run_id: int, user=Depends(guard_view)):
        """Плёнка прогона — сам GIF.

        ⚠ Путь собирает хранилище (`browser_scenario_film_path`), а не эта
        ручка: имя в базе проверяется там же, где записывается, и второе
        место сверки разошлось бы с первым.
        """
        whole = await browser_scenario_film_path(run_id)
        if not whole:
            raise HTTPException(404, 'плёнки у этого прогона нет')

        return FileResponse(whole, media_type='image/gif')

    @router.get('/{scenario_id}', include_in_schema=False)
    async def scenario_page_one(scenario_id: int,
                                user=Depends(guard_view)):
        """Один сценарий с разобранными шагами и свежими прогонами."""
        row = await browser_scenario_get(scenario_id)
        if not row:
            raise HTTPException(404, 'сценария с таким номером нет')
        row['runs'] = await browser_scenario_runs(scenario_id,
                                                  limit=SCENARIO_PAGE_RUNS)

        return {'result': row}

    @router.post('', include_in_schema=False)
    async def scenario_page_save(payload: ScenarioPageSaveIn,
                                 user=Depends(guard_update)):
        """Завести сценарий или переписать существующий.

        ⚠ Шаги проверяются схемой слоя, и негодный шаг — 422 с именем действия,
        а не пятисотка: человек правит форму, и ему нужно знать, что именно не
        так, а не что «на сервере ошибка».
        """
        if payload.status not in SCENARIO_PAGE_STATUSES:
            raise HTTPException(422, f'негодное состояние: {payload.status}')
        try:
            made = await browser_scenario_save(
                payload.name, payload.steps, site_id=payload.site_id,
                goal=payload.goal, start_url=payload.start_url,
                variables=payload.variables, status=payload.status,
                scenario_id=payload.id,
                pace_min_ms=payload.pace_min_ms,
                pace_max_ms=payload.pace_max_ms)
        except ValueError as fault:
            raise HTTPException(422, str(fault)) from fault

        return {'result': await browser_scenario_get(made)}

    @router.post('/remove', include_in_schema=False)
    async def scenario_page_drop(payload: ScenarioPageDropIn,
                                 user=Depends(guard_update)):
        """Убрать сценарий. Прогоны уходят следом — они без него бессмысленны."""
        await browser_scenario_remove(payload.id)

        return {'result': {'id': payload.id}}

    @router.post('/{scenario_id}/run', include_in_schema=False)
    async def scenario_page_run(scenario_id: int, payload: ScenarioPageRunIn,
                                user=Depends(guard_update)):
        """Прогнать сценарий сейчас и вернуть ответ контейнера как есть.

        ⚠⚠ Упавший сценарий — это 200 со `status: "error"` внутри (см. шапку
        модуля). Пятисотка уводила бы чужой отказ в журнал ошибок установки.
        """
        row = await browser_scenario_get(scenario_id)
        if not row:
            raise HTTPException(404, 'сценария с таким номером нет')

        return {'result': await browser_scenario_execute(
            row, variables=payload.variables, secrets=payload.secrets,
            proxy=payload.proxy)}

    @router.get('/{scenario_id}/runs', include_in_schema=False)
    async def scenario_page_runs(scenario_id: int, limit: int = SCENARIO_PAGE_RUNS,
                                 user=Depends(guard_view)):
        """Журнал прогонов сценария: когда, чем кончился, что сломалось."""
        return {'result': await browser_scenario_runs(scenario_id, limit=limit)}

    @router.post('/variable', include_in_schema=False)
    async def scenario_page_variable(payload: ScenarioPageVariableIn,
                                     user=Depends(guard_update)):
        """Завести или поправить переменную площадки.

        ⚠ Секретная возвращается под маской — всегда: сырое значение отдаётся
        только прогону, и странице оно не нужно ни для чего.
        """
        try:
            await browser_site_variable_save(
                payload.id, payload.site_id, payload.name, payload.value,
                payload.is_secret)
        except ValueError as fault:
            raise HTTPException(422, str(fault)) from fault

        return {'result': await browser_site_variable_list(payload.site_id)}

    @router.post('/variable/remove', include_in_schema=False)
    async def scenario_page_variable_drop(payload: ScenarioPageDropIn,
                                          user=Depends(guard_update)):
        """Убрать переменную площадки."""
        await browser_site_variable_remove(payload.id)

        return {'result': {'id': payload.id}}

    return router


# ── детали реализации ──────────────────────────────────────────────────────

async def _sites_of(sites) -> list:
    """Площадки установки списком `[{'id', 'name'}, …]`; поставщика нет — пусто.

    ⚠ Берутся только два поля, хотя проект отдаёт больше: странице нужно, чем
    подписать пункт селекта, а остальное — его предметное дело. Тащить строку
    целиком значило бы впустить чужие колонки в общий слой.
    """
    if not sites:
        return []

    return [{'id': int(row['id']), 'name': str(row['name'])}
            for row in await sites()]


def _site_first(sites: list) -> int:
    """Какую площадку показать, когда человек ещё не выбирал; нет ни одной — 0."""
    return int(sites[0]['id']) if sites else 0
