import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exportGtfs } from './gtfs.js'
import { HEADWAYS, SERVICES } from './headways.js'
import { ensureDir, readJson, sha256, timestampForFile, writeJson } from './io.js'
import { NETWORK, ROUTES, apiUrl } from './routes.js'

const ROOT = process.cwd()
const RAW_DIR = join(ROOT, 'data/raw')
const NORMALIZED_DIR = join(ROOT, 'data/normalized')
const GEOJSON_DIR = join(ROOT, 'data/geojson')
const GTFS_DIR = join(ROOT, 'data/gtfs')
const REPORTS_DIR = join(ROOT, 'data/reports')
const PUBLIC_DATA_DIR = join(ROOT, 'public/data')
const SCHEDULE_DATES = ['20260729', '20260801', '20260802']
const DIRECTIONS = [
  { api: 'I', key: 'ida', id: 0, label: 'Ida' },
  { api: 'V', key: 'vuelta', id: 1, label: 'Vuelta' },
]

function directionName(key) {
  return key === 'ida' ? 0 : 1
}

function directionLabel(key) {
  return key === 'ida' ? 'Ida' : 'Vuelta'
}

function pointFeatures(collection) {
  return collection.features.filter((feature) => feature.geometry?.type === 'Point')
}

function shapeFeatures(collection) {
  return collection.features.filter((feature) => feature.geometry?.type === 'MultiLineString')
}

function flattenMultiLineString(feature) {
  const coordinates = feature.geometry?.coordinates ?? []
  return coordinates.flat()
}

function stopFromFeature(feature) {
  const [lon, lat] = feature.geometry.coordinates
  return {
    id: String(feature.properties.id ?? feature.properties.nodo ?? feature.properties.idsae),
    code: String(feature.properties.idsae ?? feature.properties.nodo ?? feature.properties.id),
    name: feature.properties.nombre ?? feature.properties.DESCRIPCION,
    lat,
    lon,
    wheelchair_boarding: null,
    source: 'avanza',
    verified: true,
  }
}

function stopFromTrayectoStop(stop) {
  const [lon, lat] = stop.coordinates.map(Number)
  return {
    id: String(stop.codigo ?? stop.idsae),
    code: String(stop.idsae ?? stop.codigo),
    name: stop.nombre,
    lat,
    lon,
    wheelchair_boarding: null,
    source: 'avanza',
    verified: true,
  }
}

function formatTime(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
}

function serviceForDate(date) {
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return {
    service_id: `official-${date}`,
    valid_from: iso,
    valid_to: iso,
    monday: day === 1,
    tuesday: day === 2,
    wednesday: day === 3,
    thursday: day === 4,
    friday: day === 5,
    saturday: day === 6,
    sunday: day === 0,
    source: 'official_api',
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'TorreviejaTransitDataAgent/1.0',
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, got status ${response.status}: ${text.slice(0, 120)}`)
  }
  return { response, text, json }
}

export async function scrapeRoutes() {
  await ensureDir(RAW_DIR)
  await ensureDir(REPORTS_DIR)
  const generatedAt = new Date().toISOString()
  const report = {
    generated_at: generatedAt,
    routes: {},
  }

  for (const route of ROUTES) {
    const url = apiUrl(route.id)
    const detail = await fetchJson(url)
    const checksum = sha256(detail.text)
    const directions = {}
    const schedules = {}

    for (const direction of DIRECTIONS) {
      const trayectosUrl = `${NETWORK.agencyUrl}index.php?option=com_avanzainfo&task=display.apiTrayectos&lineId=${route.id}&sentido=${direction.api}`
      const mapUrl = `${NETWORK.agencyUrl}index.php?option=com_avanzainfo&task=display.apiLineDetail&lineId=${route.id}&iv=${direction.api}`
      const trayectos = await fetchJson(trayectosUrl)
      const map = await fetchJson(mapUrl)
      directions[direction.api] = {
        trayectos: {
          url: trayectosUrl,
          status: trayectos.response.status,
          checksum_sha256: sha256(trayectos.text),
          data: trayectos.json,
        },
        map: {
          url: mapUrl,
          status: map.response.status,
          checksum_sha256: sha256(map.text),
          data: map.json,
        },
      }

      schedules[direction.api] = {}
      for (const date of SCHEDULE_DATES) {
        const scheduleUrl = `${NETWORK.agencyUrl}index.php?option=com_avanzainfo&task=display.apiSchedulesCabecera&lineId=${route.id}&iv=${direction.api}&date=${date}`
        const schedule = await fetchJson(scheduleUrl)
        schedules[direction.api][date] = {
          url: scheduleUrl,
          status: schedule.response.status,
          checksum_sha256: sha256(schedule.text),
          data: schedule.json,
        }
      }
    }

    const rawPayload = {
      metadata: {
        route_id: route.id,
        short_name: detail.json.linweb ?? route.linweb,
        linweb: detail.json.linweb ?? route.linweb,
        linsae: detail.json.linsae ?? route.linsae,
        empresa: detail.json.empresa ?? null,
        api_url: url,
        scraped_at: generatedAt,
        status: detail.response.status,
        checksum_sha256: checksum,
      },
      data: detail.json,
      directions,
      schedules,
    }
    await writeJson(join(RAW_DIR, `${route.id}.json`), rawPayload)

    const directionsFound = DIRECTIONS.filter((direction) => directions[direction.api].trayectos.data.trayectos?.length > 0).length
    const stopsFound = DIRECTIONS.reduce(
      (sum, direction) => sum + (directions[direction.api].trayectos.data.trayectos?.[0]?.paradas?.length ?? 0),
      0,
    )
    const tripsFound = DIRECTIONS.reduce(
      (sum, direction) =>
        sum +
        SCHEDULE_DATES.reduce(
          (dateSum, date) => dateSum + (schedules[direction.api][date].data.cabecera?.fecha?.length ?? 0),
          0,
        ),
      0,
    )
    const geometryFound = DIRECTIONS.some((direction) => {
      const data = directions[direction.api].map.data
      const collection = data.geojson ?? data[direction.key] ?? data
      return collection?.features && shapeFeatures(collection).length > 0
    })

    report.routes[route.id] = {
      api_url: url,
      linweb: detail.json.linweb ?? route.linweb,
      linsae: detail.json.linsae ?? route.linsae,
      scraped_at: generatedAt,
      status: detail.response.status,
      checksum_sha256: checksum,
      api_endpoints: [
        url,
        ...DIRECTIONS.flatMap((direction) => [
          directions[direction.api].trayectos.url,
          directions[direction.api].map.url,
          ...SCHEDULE_DATES.map((date) => schedules[direction.api][date].url),
        ]),
      ],
      directions_found: directionsFound,
      stops_found: stopsFound,
      trips_found: tripsFound,
      geometry_found: geometryFound,
      warnings: tripsFound > 0 ? [] : ['No exact terminal departures were found in apiSchedulesCabecera.'],
    }
  }

  await writeJson(join(ROOT, 'data/source-report.json'), report)
  return report
}

async function loadRawRoutes() {
  const raw = {}
  for (const route of ROUTES) {
    raw[route.id] = await readJson(join(RAW_DIR, `${route.id}.json`))
  }
  return raw
}

export async function normalizeRoutes() {
  const raw = await loadRawRoutes()
  const generatedAt = new Date().toISOString()
  const routes = ROUTES.map((route) => ({
    id: route.id,
    short_name: raw[route.id]?.data?.linweb ?? raw[route.id]?.metadata?.linweb ?? route.linweb,
    linweb: raw[route.id]?.data?.linweb ?? raw[route.id]?.metadata?.linweb ?? route.linweb,
    linsae: raw[route.id]?.data?.linsae ?? raw[route.id]?.metadata?.linsae ?? route.linsae,
    empresa: raw[route.id]?.data?.empresa ?? raw[route.id]?.metadata?.empresa ?? null,
    long_name: route.longName,
    type: 'bus',
    is_night: route.isNight,
    source_url: apiUrl(route.id),
  }))

  const stopsById = new Map()
  const directions = []
  const routeStops = []
  const shapes = []
  const trips = []
  const stopTimes = []
  const warnings = []

  for (const route of ROUTES) {
    for (const direction of DIRECTIONS) {
      const trayectos = raw[route.id].directions[direction.api].trayectos.data.trayectos ?? []
      const trayecto = trayectos[0]
      if (!trayecto) {
        warnings.push({ route_id: route.id, direction_id: direction.id, warning: `Missing ${direction.label} trayecto in official API response.` })
        continue
      }

      const stops = trayecto.paradas.map(stopFromTrayectoStop)
      const first = stops[0]
      const last = stops.at(-1)
      directions.push({
        route_id: route.id,
        direction_id: direction.id,
        headsign: last?.name ?? direction.label,
        origin_stop_id: first?.id ?? null,
        destination_stop_id: last?.id ?? null,
        source: 'official_api',
        trayecto_id: trayecto.codtray,
        trayecto_name: trayecto.nomtray,
      })

      stops.forEach((stop, index) => {
        if (!stopsById.has(stop.id)) {
          stopsById.set(stop.id, stop)
        }
        routeStops.push({
          route_id: route.id,
          direction_id: direction.id,
          stop_id: stop.id,
          stop_sequence: index + 1,
          trayecto_id: trayecto.codtray,
          source: 'official_api',
        })
      })

      const mapData = raw[route.id].directions[direction.api].map.data
      const collection = mapData.geojson ?? mapData[direction.key] ?? mapData
      const shape = shapeFeatures(collection)[0]
      if (shape) {
        shapes.push({
          route_id: route.id,
          direction_id: direction.id,
          geometry_source: 'official_api',
          coordinates: flattenMultiLineString(shape),
        })
      } else {
        warnings.push({ route_id: route.id, direction_id: direction.id, warning: 'Missing official geometry.' })
      }

      for (const date of SCHEDULE_DATES) {
        const departures = raw[route.id].schedules[direction.api][date].data.cabecera?.fecha ?? []
        departures.forEach((departure, index) => {
          const time = formatTime(departure.hora)
          const tripId = `${route.id}-${direction.id}-${date}-${departure.hora.replace(':', '')}-${String(index + 1).padStart(3, '0')}`
          trips.push({
            trip_id: tripId,
            route_id: route.id,
            direction_id: direction.id,
            service_id: `official-${date}`,
            headsign: departure.txhasta ?? last?.name ?? direction.label,
            origin_stop_id: departure.desde,
            destination_stop_id: departure.hasta,
            trayecto_id: departure.trayecto ?? trayecto.codtray,
            schedule_precision: 'terminal_departures',
            source: 'official_api',
          })

          const originSequence =
            routeStops.find(
              (routeStop) =>
                routeStop.route_id === route.id &&
                routeStop.direction_id === direction.id &&
                routeStop.stop_id === String(departure.desde),
            )?.stop_sequence ?? 1

          stopTimes.push({
            trip_id: tripId,
            stop_id: String(departure.desde),
            stop_sequence: originSequence,
            arrival_time: time,
            departure_time: time,
            time_source: 'official',
            schedule_precision: 'terminal_departures',
          })
        })
      }
    }
  }

  const services = SCHEDULE_DATES.map(serviceForDate)
  const calendarDates = SCHEDULE_DATES.map((date) => ({
    service_id: `official-${date}`,
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    exception_type: 1,
  }))

  const dataset = {
    metadata: {
      city: NETWORK.city,
      country: NETWORK.country,
      timezone: NETWORK.timezone,
      operator: NETWORK.operator,
      network_start_date: NETWORK.networkStartDate,
      generated_at: generatedAt,
      source_urls: ROUTES.map((route) => apiUrl(route.id)),
      warnings,
    },
    routes,
    stops: [...stopsById.values()].sort((a, b) => Number(a.id) - Number(b.id)),
    directions,
    route_stops: routeStops,
    services,
    calendar_dates: calendarDates,
    trips,
    stop_times: stopTimes,
    headways: HEADWAYS,
    shapes,
  }

  await ensureDir(NORMALIZED_DIR)
  await writeJson(join(NORMALIZED_DIR, 'routes.json'), routes)
  await writeJson(join(NORMALIZED_DIR, 'stops.json'), dataset.stops)
  await writeJson(join(NORMALIZED_DIR, 'directions.json'), directions)
  await writeJson(join(NORMALIZED_DIR, 'route-stops.json'), routeStops)
  await writeJson(join(NORMALIZED_DIR, 'services.json'), services)
  await writeJson(join(NORMALIZED_DIR, 'calendar-dates.json'), calendarDates)
  await writeJson(join(NORMALIZED_DIR, 'trips.json'), trips)
  await writeJson(join(NORMALIZED_DIR, 'stop-times.json'), stopTimes)
  await writeJson(join(NORMALIZED_DIR, 'headways.json'), HEADWAYS)
  await writeJson(join(NORMALIZED_DIR, 'shapes.json'), shapes)
  await writeJson(join(NORMALIZED_DIR, 'torrevieja-transit.json'), dataset)
  return dataset
}

function validateDataset(dataset) {
  const errors = []
  const warnings = [...dataset.metadata.warnings]
  const stopIds = new Set(dataset.stops.map((stop) => stop.id))
  const routeIds = new Set(dataset.routes.map((route) => route.id))

  for (const route of dataset.routes) {
    const dirs = dataset.directions.filter((direction) => direction.route_id === route.id)
    if (dirs.length !== 2) {
      warnings.push({
        route_id: route.id,
        warning: `Official API returned ${dirs.length} directions; expected 2. Missing direction is not inferred.`,
      })
    }
  }

  for (const stop of dataset.stops) {
    if (stop.lat === 0 || stop.lon === 0) errors.push(`Stop ${stop.id} has 0,0-like coordinates.`)
    if (stop.lat < 37.94 || stop.lat > 38.05) errors.push(`Stop ${stop.id} latitude ${stop.lat} is outside Torrevieja bbox.`)
    if (stop.lon < -0.75 || stop.lon > -0.6) errors.push(`Stop ${stop.id} longitude ${stop.lon} is outside Torrevieja bbox.`)
  }

  const routeDirectionSequences = new Map()
  for (const routeStop of dataset.route_stops) {
    if (!routeIds.has(routeStop.route_id)) errors.push(`Route stop references missing route ${routeStop.route_id}.`)
    if (!stopIds.has(routeStop.stop_id)) errors.push(`Route stop references missing stop ${routeStop.stop_id}.`)
    const key = `${routeStop.route_id}-${routeStop.direction_id}`
    const previous = routeDirectionSequences.get(key) ?? 0
    if (routeStop.stop_sequence <= previous) errors.push(`Route ${key} has non-increasing stop sequence.`)
    routeDirectionSequences.set(key, routeStop.stop_sequence)
  }

  if (dataset.stop_times.length === 0) {
    warnings.push({
      warning: 'No exact stop_times exported because official apiLineDetail responses do not expose per-trip stop times.',
    })
  } else {
    warnings.push({
      warning: 'Official schedules expose terminal departures only; intermediate stop arrival/departure times are intentionally not inferred.',
    })
  }

  for (const shape of dataset.shapes) {
    if (shape.coordinates.length < 2) errors.push(`Shape ${shape.route_id}-${shape.direction_id} has fewer than two points.`)
    for (const [lon, lat] of shape.coordinates) {
      if (lat < 37.9 || lat > 38.1 || lon < -0.8 || lon > -0.55) {
        errors.push(`Shape ${shape.route_id}-${shape.direction_id} has coordinate outside coarse bbox: ${lon},${lat}.`)
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    status: errors.length > 0 ? 'failed' : 'passed_with_warnings',
    errors,
    warnings,
    counts: {
      routes: dataset.routes.length,
      stops: dataset.stops.length,
      directions: dataset.directions.length,
      route_stops: dataset.route_stops.length,
      services: dataset.services.length,
      trips: dataset.trips.length,
      stop_times: dataset.stop_times.length,
      headways: dataset.headways.length,
      shapes: dataset.shapes.length,
    },
  }
}

export async function validate() {
  const dataset = await readJson(join(NORMALIZED_DIR, 'torrevieja-transit.json'))
  const report = validateDataset(dataset)
  await writeJson(join(REPORTS_DIR, 'validation-report.json'), report)
  if (report.errors.length > 0) {
    throw new Error(`Validation failed with ${report.errors.length} errors. See data/reports/validation-report.json`)
  }
  return report
}

export async function exportJson() {
  const dataset = await readJson(join(NORMALIZED_DIR, 'torrevieja-transit.json'))
  await writeJson(join(PUBLIC_DATA_DIR, 'normalized/torrevieja-transit.json'), dataset)
  return dataset
}

export async function exportGeojson() {
  const dataset = await readJson(join(NORMALIZED_DIR, 'torrevieja-transit.json'))
  const stopRoutes = new Map()
  for (const routeStop of dataset.route_stops) {
    const current = stopRoutes.get(routeStop.stop_id) ?? new Set()
    current.add(routeStop.route_id)
    stopRoutes.set(routeStop.stop_id, current)
  }

  const stops = {
    type: 'FeatureCollection',
    features: dataset.stops.map((stop) => ({
      type: 'Feature',
      properties: {
        stop_id: stop.id,
        stop_code: stop.code,
        stop_name: stop.name,
        route_ids: [...(stopRoutes.get(stop.id) ?? [])].sort(),
      },
      geometry: {
        type: 'Point',
        coordinates: [stop.lon, stop.lat],
      },
    })),
  }

  const routes = {
    type: 'FeatureCollection',
    features: dataset.shapes.map((shape) => ({
      type: 'Feature',
      properties: {
        route_id: shape.route_id,
        linweb: dataset.routes.find((route) => route.id === shape.route_id)?.linweb ?? shape.route_id,
        route_name: dataset.routes.find((route) => route.id === shape.route_id)?.long_name ?? shape.route_id,
        direction_id: shape.direction_id,
        geometry_source: shape.geometry_source,
      },
      geometry: {
        type: 'LineString',
        coordinates: shape.coordinates,
      },
    })),
  }

  await writeJson(join(GEOJSON_DIR, 'stops.geojson'), stops)
  await writeJson(join(GEOJSON_DIR, 'routes.geojson'), routes)
  await writeJson(join(PUBLIC_DATA_DIR, 'geojson/stops.geojson'), stops)
  await writeJson(join(PUBLIC_DATA_DIR, 'geojson/routes.geojson'), routes)
}

export async function exportGtfsCommand() {
  const dataset = await readJson(join(NORMALIZED_DIR, 'torrevieja-transit.json'))
  await exportGtfs(dataset, GTFS_DIR)
}

export async function update() {
  const stamp = timestampForFile()
  await ensureDir(join(ROOT, 'data/snapshots', stamp))
  try {
    const previous = await readFile(join(NORMALIZED_DIR, 'torrevieja-transit.json'), 'utf8')
    await writeFile(join(ROOT, 'data/snapshots', stamp, 'previous-torrevieja-transit.json'), previous)
  } catch {
    // First update run has no previous production dataset.
  }
  await scrapeRoutes()
  await normalizeRoutes()
  const report = await validate()
  await writeJson(join(ROOT, 'data/snapshots', stamp, 'validation-report.json'), report)
}

async function all() {
  await scrapeRoutes()
  await normalizeRoutes()
  await validate()
  await exportJson()
  await exportGeojson()
  await exportGtfsCommand()
}

const commands = {
  'discover-api': scrapeRoutes,
  scrape: scrapeRoutes,
  normalize: normalizeRoutes,
  validate,
  'export:json': exportJson,
  'export:geojson': exportGeojson,
  'export:gtfs': exportGtfsCommand,
  update,
  all,
}

const command = process.argv[2] ?? 'all'
if (!commands[command]) {
  console.error(`Unknown command "${command}". Available: ${Object.keys(commands).join(', ')}`)
  process.exit(1)
}

commands[command]()
  .then((result) => {
    if (result?.counts) {
      console.log(JSON.stringify(result.counts, null, 2))
    } else {
      console.log(`transit:${command}:done`)
    }
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
