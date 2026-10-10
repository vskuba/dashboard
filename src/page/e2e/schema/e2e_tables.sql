-- Схема страницы «Тесты → E2E»: ЭТАЛОН, а не миграция.
--
-- ⚠⚠ Этот файл никто не применяет. Схему накатывает проект своей миграцией —
-- у каждой установки свой движок миграций, свой порядок и свои сроки. Здесь
-- лежит то, что общий код ТРЕБУЕТ: имена таблиц, колонок и их смысл.
--
-- ⚠ Без этого файла каждый следующий проект копировал бы DDL у соседа — а он
-- уже совпадал байт в байт у двух установок и разошёлся бы на первой правке.
-- Заводя страницу у себя, перенеси отсюда, поменяв лишь имя файла миграции.

--
--
--
--
--

CREATE TABLE IF NOT EXISTS `test_e2e`
(
    `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- Один ночной прогон = одна метка на всех своих строках. UUID, а не номер:
    -- строки пишутся по мере готовности случаев, и номер пришлось бы выдавать
    -- заранее отдельной таблицей ради единственного поля.
    `run_uuid`     CHAR(36)        NOT NULL,

    -- Имя и описание случая КОПИЕЙ из YAML — см. шапку.
    `name`         VARCHAR(190)    NOT NULL,
    `description`  TEXT                     DEFAULT NULL,

    -- Путь страницы на панели («/admin/llm»), как он записан в случае.
    `page`         VARCHAR(190)    NOT NULL,

    -- Ширина вьюпорта этой строки. 360 / 768 / 1440 — но не ENUM: набор ширин
    -- задаёт случай, и новая ширина не должна требовать миграции.
    `width`        SMALLINT UNSIGNED NOT NULL,

    -- `ok` — все области сошлись; `fail` — сошлись не все (дефект вёрстки);
    -- `error` — прогон не состоялся (страница не открылась, зонд упал). ⚠ Третий
    -- отдельно от второго намеренно: «тест не смог проверить» и «тест проверил и
    -- нашёл дефект» требуют разных действий, а одним красным неразличимы.
    `status`       ENUM ('ok', 'fail', 'error') NOT NULL,

    `areas_total`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `areas_failed` SMALLINT UNSIGNED NOT NULL DEFAULT 0,

    -- Строка на область: имя, селектор, rect со страницы, правила и вердикт
    -- каждого, замеренное число. ⚠ JSON, а не своя таблица: области читают
    -- всегда целиком вместе со своей строкой и никогда не ищут по ним — ни
    -- отбора, ни соединения по области не бывает.
    `area_json`    JSON            NOT NULL,

    -- Кадр с нарисованными рамками областей и кадр без них. Путь относительно
    -- `data/e2e/`, а не сам файл: картинки в базе раздувают дамп и бэкап, а
    -- читаются они по одной, ручкой раздачи.
    `shot_path`    VARCHAR(255)    NOT NULL DEFAULT '',
    `shot_plain_path` VARCHAR(255) NOT NULL DEFAULT '',

    -- Что страница сказала в консоль. Красная ошибка при внешне целом кадре
    -- означает, что часть обработчиков не навесилась, — кадр этого не покажет.
    `console_json` JSON                     DEFAULT NULL,

    -- Текст сбоя при `status='error'`; у остальных пусто.
    `error`        TEXT                     DEFAULT NULL,

    `duration_ms`  INT UNSIGNED    NOT NULL DEFAULT 0,

    -- UTC, как всё время в проекте: в пояс настройки `timezone` переводит страница.
    `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),

    -- Страница открывает прогон целиком: все строки одной метки, свежие сверху.
    KEY `idx_test_e2e_run` (`run_uuid`),

    -- «Как этот случай вёл себя раньше» — история одного имени по времени.
    KEY `idx_test_e2e_name_created` (`name`, `created_at`),

    -- Список прогонов строится по времени; отдельный ключ нужен, потому что
    -- первым столбцом в предыдущем стоит имя.
    KEY `idx_test_e2e_created` (`created_at`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci;

--
--
--
--
--

CREATE TABLE IF NOT EXISTS `test_e2e_case`
(
    -- Имя файла случая без каталога: «workflow_trace_error_today.yaml».
    `case_file`  VARCHAR(190) NOT NULL,

    `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,

    -- Название на момент переключения — КОПИЕЙ, как `name` в `test_e2e`.
    -- Нужно одному: показать в отчёте, что именно выключено, если файл случая
    -- тем временем переименовали или унесли.
    `name`       VARCHAR(190) NOT NULL DEFAULT '',

    -- UTC, как всё время в проекте.
    `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`case_file`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci;
