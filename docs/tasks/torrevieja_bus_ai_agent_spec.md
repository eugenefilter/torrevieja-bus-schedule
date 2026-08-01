# Техническое задание для ИИ-агента
## Сбор новой автобусной сети Торревьехи (Испания), запущенной 27 июля 2026 года

Дата подготовки: 29 июля 2026  
Город: Torrevieja, Alicante, Spain  
Оператор: AVANZA  
Официальный сайт: https://torrevieja.avanzagrupo.com/

---

## 1. Цель

Создать полностью машиночитаемый набор данных новой городской автобусной сети Торревьехи:

1. Все маршруты.
2. Оба направления каждого маршрута.
3. Полный упорядоченный список остановок.
4. Координаты каждой остановки.
5. Время отправления каждого рейса.
6. Время прохождения каждой остановки, если оно опубликовано.
7. Геометрию маршрута для отображения на карте.
8. Расписание по типам дней и сезонам.
9. Экспорт в JSON, GeoJSON и GTFS Static.
10. Импорт данных в приложение без ручного редактирования.

Нельзя подменять реальные данные приблизительными маршрутами или выдуманными координатами.

---

## 2. Официальные источники

### Главный источник

https://torrevieja.avanzagrupo.com/

### Страница всех линий

https://torrevieja.avanzagrupo.com/lineas

### Страницы новых маршрутов

| Публичный номер | Внутренний ID | URL |
|---|---:|---|
| C | 071 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=071 |
| 01 | 081 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=081 |
| 02 | 082 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=082 |
| 03 | 083 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=083 |
| 04 | 084 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=084 |
| 05 | 085 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=085 |
| 06 | 086 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=086 |
| 07 | 087 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=087 |
| 08 | 088 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=088 |
| N1 | 091 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=091 |
| N2 | 092 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=092 |
| N3 | 093 | https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=093 |

### Муниципальные публикации

- Новая сеть начала работу 27 июля 2026 года.
- Официальная схема содержит коды остановок и маршруты в обоих направлениях.
- Частоты сезона alta опубликованы 28 июля 2026 года.

Официальные страницы:

https://torrevieja.es/es/noticias/2026-07-06-nuevo-transporte-urbano-torrevieja-inicia-su-implantacion-calendario-fases

https://torrevieja.es/es/noticias/2026-07-13-presentado-plano-oficial-nueva-red-transporte-urbano-torrevieja-ocho-lineas

https://torrevieja.es/es/noticias/2026-07-28-nuevas-lineas-transporte-urbano-cuentan-frecuencias-entre-14-30-minutos-durante

---

## 3. Новые линии

| Маршрут | Название |
|---|---|
| C | Gregorio Marañón – Estación de Autobuses – Polideportivo – C. Salud Acequión |
| 01 | Hospital – Los Altos – Punta Prima – Rocío del Mar |
| 02 | Hospital – Los Balcones – Lago Jardín |
| 03 | Gregorio Marañón – Desiderio Rodríguez – Mar Azul – Hospital |
| 04 | Gregorio Marañón – Centros Comerciales – La Torreta – C. Salud La Siesta |
| 05 | Gregorio Marañón – Centros Comerciales – C. Salud La Siesta – San Luis |
| 06 | Gregorio Marañón – Polideportivo – Hospital Quirón – C. Salud La Mata |
| 07 | Gregorio Marañón – Ramón Gallud – Av. París – La Mata |
| 08 | Gregorio Marañón – Cabo Cervera – Estación de Autobuses – La Mata |
| N1 | Gregorio Marañón – Playa Los Locos – Polideportivo – La Mata |
| N2 | Gregorio Marañón – Centros Comerciales – La Torreta – San Luis |
| N3 | Gregorio Marañón – Desiderio Rodríguez – Los Balcones – Los Altos |

---

## 4. Важная особенность сайта

Информация об остановках и рейсах загружается динамически. Обычный HTTP-парсинг HTML может вернуть только заголовок страницы без данных.

Агент должен использовать браузерную автоматизацию:

- Playwright предпочтительно;
- Chromium;
- ожидание завершения XHR/fetch;
- анализ Network;
- чтение DOM после гидратации;
- переключение направления;
- переключение даты;
- перехват JSON-ответов внутренних API.

Сначала искать официальный JSON/API, который использует frontend. Только если API невозможно определить — извлекать данные из отрисованного DOM.

---

## 5. Использование официального API

Для каждого маршрута использовать официальный JSON API:

1. Открыть страницу через Playwright.
2. Начать запись всех `fetch` и `xhr`.
3. Дождаться `networkidle`.
4. Сохранить:
   - URL запроса;
   - HTTP-метод;
   - query parameters;
   - request body;
   - response status;
   - response JSON.
5. Найти ответы, содержащие:
   - stops;
   - paradas;
   - expeditions;
   - horarios;
   - trips;
   - coordinates;
   - latitude/longitude;
   - geometry/polyline.
6. Проверить, меняется ли endpoint при:
   - смене направления;
   - смене даты;
   - выборе выходного дня.
7. Если API найден, написать отдельный клиент API и больше не парсить DOM.
8. Сохранить пример каждого сырого ответа в `data/raw/`.

Нельзя строить production-импорт непосредственно на нестабильных CSS-классах, если доступен JSON endpoint.

---

## 6. Что собирать по каждому маршруту

### Route

```json
{
  "id": "081",
  "short_name": "01",
  "long_name": "Hospital - Los Altos - Punta Prima - Rocío del Mar",
  "type": "bus",
  "is_night": false,
  "source_url": "https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=081"
}
```

### Direction

Для каждого маршрута должны существовать отдельные направления:

```json
{
  "route_id": "081",
  "direction_id": 0,
  "headsign": "C/ Mar Rizada",
  "origin_stop_id": "...",
  "destination_stop_id": "..."
}
```

```json
{
  "route_id": "081",
  "direction_id": 1,
  "headsign": "Hospital Universitario de Torrevieja",
  "origin_stop_id": "...",
  "destination_stop_id": "..."
}
```

Не считать обратный путь простым разворотом массива: остановки и улицы в противоположном направлении могут различаться.

### Stop

```json
{
  "id": "official-stop-code",
  "code": "official-stop-code",
  "name": "Av. Gregorio Marañón, 7",
  "lat": 37.000000,
  "lon": -0.000000,
  "wheelchair_boarding": null,
  "source": "avanza",
  "verified": true
}
```

Требования:

- координаты WGS84, EPSG:4326;
- долгота и широта не должны быть перепутаны;
- координаты должны попадать в разумный bbox Торревьехи;
- одинаковая физическая остановка должна иметь один ID;
- остановки на противоположных сторонах улицы могут быть разными объектами;
- сохранить официальный код остановки, если опубликован.

### Ordered route stops

```json
{
  "route_id": "081",
  "direction_id": 0,
  "stop_id": "stop-code",
  "stop_sequence": 1
}
```

### Trip

```json
{
  "trip_id": "081-0-20260729-0720",
  "route_id": "081",
  "direction_id": 0,
  "service_id": "summer-weekday-2026",
  "headsign": "C/ Mar Rizada"
}
```

### Stop time

```json
{
  "trip_id": "081-0-20260729-0720",
  "stop_id": "stop-code",
  "stop_sequence": 1,
  "arrival_time": "07:20:00",
  "departure_time": "07:20:00",
  "time_source": "official"
}
```

Если сайт публикует только отправления от конечной:

- не выдумывать время на промежуточных остановках;
- хранить только известное время;
- `arrival_time` промежуточных остановок оставить `null`;
- добавить `schedule_precision: "headway_only"` либо `"terminal_departures"`.

---

## 7. Расписание и календарь

Разделять:

- weekday;
- Friday, если отличается;
- Saturday;
- Sunday;
- public holiday;
- high season;
- low season;
- Easter;
- ночные линии;
- исключения по конкретным датам.

Пример:

```json
{
  "service_id": "high-season-mon-thu-2026",
  "valid_from": "2026-07-27",
  "valid_to": "2026-08-31",
  "monday": true,
  "tuesday": true,
  "wednesday": true,
  "thursday": true,
  "friday": false,
  "saturday": false,
  "sunday": false
}
```

Не смешивать частоту движения с точным списком рейсов.

### Headway

```json
{
  "route_id": "071",
  "direction_id": null,
  "service_id": "high-season-mon-thu-2026",
  "start_time": "07:00:00",
  "end_time": "09:00:00",
  "headway_minutes": 15
}
```

### Известные официальные частоты сезона alta

#### C

- Пн–Чт:
  - 07:00–09:00: 15 минут;
  - 09:00–17:00: 18 минут;
  - 17:00–конец: 17 минут.
- Пт:
  - первая полоса: 14 минут;
  - средняя: 20 минут;
  - вечерняя: 17 минут.
- Сб, Вс, праздники: 15 минут весь день.
- Первая отправка: 07:00.
- Последняя отправка: 23:15.

#### 01

- Пн–Пт:
  - 07:00–10:00: 20–25 минут;
  - 10:00–21:00: 30 минут;
  - после 21:00: 25 минут.
- Сб, Вс, праздники:
  - 07:00–10:00: 22 минуты;
  - 10:00–21:00: 30 минут;
  - после 21:00: 25 минут.

#### 02

- Пн–Пт:
  - 07:00–08:00: 25 минут;
  - 08:00–21:00: 30 минут;
  - после 21:00: 25 минут.
- Сб, Вс, праздники: 25 минут весь день.

#### 03

Официальная новостная публикация содержит неполно сформулированный диапазон между 08:00 и 10:00. Агент обязан брать точные времена с сайта линии, а не восстанавливать их догадкой.

- Пн–Пт:
  - 07:00–08:00: 17 минут;
  - 10:00–21:30: 20 минут;
  - после 21:30: 17 минут.
- Сб, Вс, праздники:
  - 07:00–08:00: 14 минут;
  - 10:00–14:00: 20 минут;
  - далее до 21:30: 17 минут;
  - после 21:30: 14 минут.

#### 04

- Пн–Пт:
  - до 10:00: 17–20 минут;
  - 10:00–18:00: 25 минут;
  - после 18:00: 18 минут.
- Сб:
  - до 10:00: 18 минут;
  - затем: 20 минут.
- Вс и праздники: 18 минут.

#### 05

- Каждый день 07:00–10:00: 25 минут.
- Пн–Сб 10:00–21:30: 30 минут.
- Вс и праздники 10:00–21:30: 27 минут.
- После 21:30: 27 минут каждый день.

#### 06

- Пн–Чт:
  - 07:00–08:00: 18 минут;
  - 08:00–21:00: 20 минут;
  - после 21:00: 17 минут.
- Пт: 20 / 25 / 17 минут.
- Сб: 18 / 20 / 18 минут.
- Вс и праздники: 18 / 18–20 / 18 минут.

Точные границы полос для пятницы и выходных необходимо получить с официальной страницы линии.

#### 07

- Пн–Пт:
  - 07:00–09:00: 22 минуты;
  - 09:00–21:00: 24 минуты.
- Сб, Вс, праздники:
  - первая полоса: 20 минут;
  - следующая: 22 минуты.
- После 21:00: 20 минут каждый день.

#### 08

- Пн–Пт:
  - 07:00–10:00: 17 минут;
  - 10:00–21:00: 18 минут.
- Сб, Вс, праздники:
  - 07:00–10:00: 14 минут;
  - Сб 10:00–21:00: 17 минут;
  - Вс/праздники 10:00–21:00: 16 минут.
- После 21:00: 16 минут каждый день.

#### N1, N2, N3

- Работают ежедневно.
- Интервал: 60 минут.
- Первые отправления с внешней конечной: 00:00.
- Первые отправления от Gregorio Marañón: 00:30.
- Последние с внешней конечной: 03:00.
- Последние от Gregorio Marañón: 03:30.

---

## 8. Геометрия маршрута

Приоритет источников:

1. Официальная геометрия из API AVANZA.
2. Официальный GTFS `shapes.txt`.
3. GeoJSON/KML официальной карты.
4. Маршрутизация по дорожной сети между последовательными остановками — только как производная геометрия и с явной маркировкой.

Формат:

```json
{
  "type": "Feature",
  "properties": {
    "route_id": "081",
    "direction_id": 0,
    "geometry_source": "official_api"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-0.000000, 37.000000],
      [-0.000100, 37.000100]
    ]
  }
}
```

В GeoJSON порядок координат всегда:

```text
[longitude, latitude]
```

Не использовать:

```text
[latitude, longitude]
```

### Если официальной геометрии нет

Можно построить предполагаемую линию через OSRM, Valhalla или GraphHopper с профилем driving, но:

- использовать последовательность официальных остановок;
- не проводить прямые отрезки через здания;
- помечать `geometry_source: "router_derived"`;
- не выдавать такую линию за официальный путь;
- сохранять дату и параметры построения;
- визуально проверить каждый маршрут.

---

## 9. Выходная структура проекта

```text
torrevieja-transit/
├── README.md
├── package.json
├── playwright.config.ts
├── src/
│   ├── scrape/
│   │   ├── discover-api.ts
│   │   ├── scrape-routes.ts
│   │   ├── scrape-stops.ts
│   │   ├── scrape-schedules.ts
│   │   └── scrape-shapes.ts
│   ├── normalize/
│   │   ├── normalize-stop.ts
│   │   ├── normalize-time.ts
│   │   └── deduplicate-stops.ts
│   ├── export/
│   │   ├── export-json.ts
│   │   ├── export-geojson.ts
│   │   └── export-gtfs.ts
│   ├── validate/
│   │   ├── validate-coordinates.ts
│   │   ├── validate-routes.ts
│   │   ├── validate-schedules.ts
│   │   └── validate-gtfs.ts
│   └── cli.ts
├── data/
│   ├── raw/
│   ├── normalized/
│   │   ├── routes.json
│   │   ├── stops.json
│   │   ├── route-stops.json
│   │   ├── trips.json
│   │   ├── stop-times.json
│   │   ├── services.json
│   │   └── headways.json
│   ├── geojson/
│   │   ├── stops.geojson
│   │   └── routes.geojson
│   └── gtfs/
│       ├── agency.txt
│       ├── routes.txt
│       ├── stops.txt
│       ├── trips.txt
│       ├── stop_times.txt
│       ├── calendar.txt
│       ├── calendar_dates.txt
│       ├── shapes.txt
│       ├── frequencies.txt
│       └── feed_info.txt
└── tests/
```

---

## 10. Единый итоговый JSON

```json
{
  "metadata": {
    "city": "Torrevieja",
    "country": "ES",
    "timezone": "Europe/Madrid",
    "operator": "AVANZA",
    "network_start_date": "2026-07-27",
    "generated_at": "ISO-8601",
    "source_urls": []
  },
  "routes": [],
  "stops": [],
  "directions": [],
  "route_stops": [],
  "services": [],
  "trips": [],
  "stop_times": [],
  "headways": [],
  "shapes": []
}
```

---

## 11. Формат для Leaflet / MapLibre / OpenLayers

### Остановки

`data/geojson/stops.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "stop_id": "stop-code",
        "stop_name": "Av. Gregorio Marañón, 7",
        "route_ids": ["071", "083", "084"]
      },
      "geometry": {
        "type": "Point",
        "coordinates": [-0.000000, 37.000000]
      }
    }
  ]
}
```

### Маршруты

`data/geojson/routes.geojson`

Каждое направление — отдельный Feature.

---

## 12. GTFS

Сформировать валидный GTFS Static ZIP.

Обязательные проверки:

- уникальные `route_id`;
- уникальные `stop_id`;
- уникальные `trip_id`;
- `stop_sequence` строго возрастает;
- `shape_dist_traveled` не уменьшается;
- все внешние ключи существуют;
- время после полуночи ночных линий допускается писать как `24:30:00`, `25:30:00`, `27:30:00`;
- timezone: `Europe/Madrid`;
- `route_type = 3` для автобусов;
- UTF-8;
- CSV с корректным quoting;
- отсутствие BOM желательно;
- feed должен проходить MobilityData GTFS Validator.

---

## 13. Правила качества данных

### Запрещено

- придумывать координаты;
- получать координаты только геокодированием названия улицы без проверки;
- считать схему-картинку точным географическим источником;
- объединять остановки только по похожему названию;
- считать частоту точным расписанием;
- восстанавливать пропущенные временные диапазоны догадкой;
- использовать старые линии A, A.2, B, C, D/F, E, G как новую сеть;
- заменять официальный маршрут прямыми линиями между остановками;
- скрывать ошибки парсинга.

### Обязательно

- сохранять сырой источник;
- записывать URL и timestamp;
- рассчитывать checksum сырого ответа;
- делать повторный запуск идемпотентным;
- создавать diff между версиями;
- отмечать данные как official / derived / inferred;
- выводить список неполных данных;
- делать скриншот каждой страницы после загрузки;
- проверять оба направления;
- проверять weekday и weekend;
- проверять ночные рейсы после полуночи.

---

## 14. Дедупликация остановок

Использовать комбинацию:

1. официальный stop code;
2. нормализованное название;
3. координаты;
4. расстояние;
5. сторона дороги;
6. список маршрутов.

Остановки с одинаковым названием, но координатами на разных сторонах дороги, не объединять автоматически.

Допустимый порог географического совпадения для предложения merge:

```text
до 15 метров
```

Но merge выполнять только при дополнительных совпадающих признаках.

---

## 15. Валидация координат

Проверить:

- `lat` примерно от 37.94 до 38.05;
- `lon` примерно от -0.75 до -0.60;
- точка не находится в море;
- последовательность остановок логична;
- расстояние между соседними остановками обычно не превышает несколько километров;
- нет координат `0,0`;
- нет одинаковых координат у большого количества разных остановок;
- нет перепутанных lat/lon.

Bbox выше служит грубой технической проверкой, а не источником координат.

---

## 16. CLI

Команды:

```bash
npm run discover-api
npm run scrape
npm run normalize
npm run validate
npm run export:json
npm run export:geojson
npm run export:gtfs
npm run all
```

Пример:

```bash
npm run scrape -- --route=081 --date=2026-07-29
```

---

## 17. Обновление данных

Реализовать повторное получение:

```bash
npm run update
```

Поведение:

1. скачать текущие данные;
2. сохранить snapshot;
3. сравнить с предыдущим;
4. показать:
   - добавленные остановки;
   - удалённые остановки;
   - изменение порядка;
   - новые рейсы;
   - удалённые рейсы;
   - изменение частот;
   - изменение геометрии;
5. не перезаписывать production-данные при критической ошибке валидации.

---

## 18. Отчёт об источниках

Создать `data/source-report.json`:

```json
{
  "routes": {
    "081": {
      "api_url": "https://torrevieja.avanzagrupo.com/index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=081",
      "scraped_at": "ISO-8601",
      "api_endpoints": [],
      "directions_found": 2,
      "stops_found": 0,
      "trips_found": 0,
      "geometry_found": false,
      "warnings": []
    }
  }
}
```

---

## 19. Definition of Done

Задача выполнена только когда:

- собраны C, 01–08, N1–N3;
- для каждого маршрута проверены оба направления;
- остановки имеют порядок;
- остановки имеют координаты либо явно отмечены как missing;
- расписания не смешаны с частотами;
- экспортированы JSON и GeoJSON;
- создан GTFS ZIP;
- GTFS прошёл валидатор;
- маршруты открываются на тестовой карте;
- карта показывает направление и остановки;
- создан отчёт о неполных данных;
- все значения имеют ссылку на источник;
- агент не выдумал отсутствующие сведения.

---

## 20. Приоритет реализации

1. Найти внутренний API официального сайта.
2. Скачать сырые ответы всех линий.
3. Получить направления и остановки.
4. Получить точные рейсы по датам.
5. Получить координаты.
6. Получить официальную геометрию.
7. Нормализовать.
8. Валидировать.
9. Экспортировать JSON/GeoJSON.
10. Экспортировать GTFS.
11. Создать демонстрационную карту.
12. Настроить обновление и diff.

---

## 21. Финальная инструкция агенту

Не ограничивайся написанием парсера. Запусти его, собери реальные данные и положи готовые результаты в `data/`.

Если официальный сайт не раскрывает некоторую информацию:

1. зафиксируй, чего именно нет;
2. не придумывай данные;
3. найди альтернативный официальный источник;
4. пометь производные данные;
5. добавь warning в source report.

Главный результат — не код сам по себе, а проверенный машиночитаемый набор данных новой транспортной сети Торревьехи.