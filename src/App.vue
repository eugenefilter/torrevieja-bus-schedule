<script setup>
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const stops = ref([])
const routes = ref([])
const transitData = ref(null)
const selectedRoute = ref('all')
const selectedDirection = ref('all')
const loadError = ref('')
const stopQuery = ref('')
const selectedStopId = ref('')
const selectedStopRouteId = ref('')
const selectedScheduleDate = ref('20260729')
const mapEl = ref(null)
let map = null
let routeLayer = null
let stopLayer = null
let stopMarkers = new Map()

const palette = ['#0067a5', '#d1495b', '#007f5f', '#edae49', '#5f0f40', '#2a9d8f', '#9b5de5', '#f15bb5', '#4d908e', '#bc6c25', '#277da1', '#c1121f']

const routeOptions = computed(() => {
  const byId = new Map()
  for (const route of routes.value) {
    byId.set(route.properties.route_id, {
      id: route.properties.route_id,
      linweb: route.properties.linweb ?? route.properties.route_id,
      name: route.properties.route_name ?? route.properties.route_id,
    })
  }
  return [...byId.values()].sort((a, b) => a.linweb.localeCompare(b.linweb, undefined, { numeric: true }))
})

const routeColor = (routeId) =>
  palette[Math.max(0, routeOptions.value.findIndex((route) => route.id === routeId)) % palette.length]

const normalizeSearchText = (value) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const selectedStop = computed(() => stops.value.find((stop) => stop.properties.stop_id === selectedStopId.value))

const selectedStopRouteIds = computed(() => new Set(selectedStop.value?.properties.route_ids ?? []))

const filteredRoutes = computed(() => {
  const stopRouteFilter = selectedStopRouteId.value
    ? new Set([selectedStopRouteId.value])
    : selectedStopId.value
      ? selectedStopRouteIds.value
      : null

  return routes.value.filter((route) => {
    const byRoute = selectedRoute.value === 'all' || route.properties.route_id === selectedRoute.value
    const byDirection = selectedDirection.value === 'all' || String(route.properties.direction_id) === selectedDirection.value
    const byStop = !stopRouteFilter || stopRouteFilter.has(route.properties.route_id)
    return byRoute && byDirection && byStop
  })
})

const filteredStops = computed(() => {
  if (selectedStopId.value) {
    const visibleRouteIds = new Set(filteredRoutes.value.map((route) => route.properties.route_id))
    return stops.value.filter(
      (stop) =>
        stop.properties.stop_id === selectedStopId.value ||
        stop.properties.route_ids.some((routeId) => visibleRouteIds.has(routeId)),
    )
  }
  if (selectedRoute.value === 'all') return stops.value
  return stops.value.filter((stop) => stop.properties.route_ids.includes(selectedRoute.value))
})

const routeById = computed(() => {
  const byId = new Map()
  for (const route of routeOptions.value) byId.set(route.id, route)
  return byId
})

const stopMatches = computed(() => {
  const query = normalizeSearchText(stopQuery.value.trim())
  if (query.length < 2) return []
  return stops.value
    .filter((stop) => {
      const haystack = normalizeSearchText(`${stop.properties.stop_id} ${stop.properties.stop_code} ${stop.properties.stop_name}`)
      return haystack.includes(query)
    })
    .slice(0, 8)
})

const selectedStopRoutes = computed(() => {
  if (!selectedStop.value) return []
  return selectedStop.value.properties.route_ids
    .map((routeId) => routeById.value.get(routeId) ?? { id: routeId, linweb: routeId, name: routeId })
    .sort((a, b) => a.linweb.localeCompare(b.linweb, undefined, { numeric: true }))
})

const publicRouteNames = (routeIds) =>
  routeIds
    .map((routeId) => routeById.value.get(routeId)?.linweb ?? routeId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

const scheduleDates = computed(() => {
  const dates = new Set()
  for (const trip of transitData.value?.trips ?? []) {
    const date = trip.service_id.replace('official-', '')
    if (/^\d{8}$/.test(date)) dates.add(date)
  }
  return [...dates].sort()
})

const formattedScheduleDate = (date) => `${date.slice(6, 8)}.${date.slice(4, 6)}.${date.slice(0, 4)}`

const directionLabel = (directionId) => (Number(directionId) === 0 ? 'Ida' : 'Vuelta')

const scheduleRouteIds = computed(() => {
  if (selectedStop.value) {
    return selectedStopRouteId.value ? [selectedStopRouteId.value] : selectedStopRoutes.value.map((route) => route.id)
  }
  return selectedRoute.value === 'all' ? [] : [selectedRoute.value]
})

const stopTimesByTripId = computed(() => {
  const byTripId = new Map()
  for (const stopTime of transitData.value?.stop_times ?? []) {
    byTripId.set(stopTime.trip_id, stopTime)
  }
  return byTripId
})

const scheduleGroups = computed(() => {
  if (!transitData.value || scheduleRouteIds.value.length === 0) return []
  const routeIds = new Set(scheduleRouteIds.value)
  const groups = new Map()

  for (const trip of transitData.value.trips) {
    if (!routeIds.has(trip.route_id)) continue
    if (trip.service_id !== `official-${selectedScheduleDate.value}`) continue
    if (selectedDirection.value !== 'all' && String(trip.direction_id) !== selectedDirection.value) continue

    const stopTime = stopTimesByTripId.value.get(trip.trip_id)
    if (!stopTime?.departure_time) continue

    const route = routeById.value.get(trip.route_id) ?? { linweb: trip.route_id, name: trip.route_id }
    const key = `${trip.route_id}-${trip.direction_id}-${trip.headsign}`
    const group = groups.get(key) ?? {
      key,
      route,
      direction_id: trip.direction_id,
      direction_label: directionLabel(trip.direction_id),
      headsign: trip.headsign,
      origin_stop_id: trip.origin_stop_id,
      times: [],
    }
    group.times.push(stopTime.departure_time.slice(0, 5))
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({ ...group, times: [...new Set(group.times)].sort() }))
    .sort((a, b) => `${a.route.linweb}-${a.direction_id}`.localeCompare(`${b.route.linweb}-${b.direction_id}`, undefined, { numeric: true }))
})

const activeRouteLabel = computed(() => {
  if (selectedRoute.value === 'all') return 'All routes'
  const route = routeOptions.value.find((item) => item.id === selectedRoute.value)
  return route ? `${route.linweb} - ${route.name}` : selectedRoute.value
})

const asLatLng = ([lon, lat]) => [lat, lon]

const popupContent = (stop) => {
  const routesText = publicRouteNames(stop.properties.route_ids).join(', ')
  return `<strong>${stop.properties.stop_name}</strong><br><span>Stop ${stop.properties.stop_id}</span><br><span>Routes: ${routesText}</span>`
}

const chooseStop = (stop) => {
  selectedStopId.value = stop.properties.stop_id
  selectedStopRouteId.value = ''
  stopQuery.value = stop.properties.stop_name
  const [lat, lon] = asLatLng(stop.geometry.coordinates)
  if (map) map.setView([lat, lon], 16)
  updateSelectedStopMarker()
  stopMarkers.get(stop.properties.stop_id)?.openPopup()
}

const chooseStopRoute = (routeId) => {
  selectedStopRouteId.value = routeId
  renderMapData({ preserveView: true })
}

const stopMarkerStyle = (stopId) => {
  const selected = stopId === selectedStopId.value
  return {
    radius: selected ? 9 : 5,
    color: selected ? '#004ea8' : '#1f2937',
    weight: selected ? 3 : 1.5,
    fillColor: selected ? '#ffd34d' : '#ffffff',
    fillOpacity: 1,
  }
}

const updateSelectedStopMarker = () => {
  for (const [stopId, marker] of stopMarkers) {
    marker.setStyle(stopMarkerStyle(stopId))
    if (stopId === selectedStopId.value) marker.bringToFront()
  }
}

const renderMapData = ({ preserveView = false } = {}) => {
  if (!map) return
  if (routeLayer) routeLayer.remove()
  if (stopLayer) stopLayer.remove()

  routeLayer = L.layerGroup()
  stopLayer = L.layerGroup()
  stopMarkers = new Map()
  const bounds = L.latLngBounds([])

  for (const route of filteredRoutes.value) {
    const latLngs = route.geometry.coordinates.map(asLatLng)
    if (latLngs.length === 0) continue
    L.polyline(latLngs, {
      color: routeColor(route.properties.route_id),
      weight: 5,
      opacity: 0.82,
      lineCap: 'round',
      lineJoin: 'round',
    })
      .bindPopup(`${route.properties.linweb} - ${route.properties.route_name}<br>Direction ${route.properties.direction_id}`)
      .addTo(routeLayer)
    latLngs.forEach((latLng) => bounds.extend(latLng))
  }

  for (const stop of filteredStops.value) {
    const latLng = asLatLng(stop.geometry.coordinates)
    const marker = L.circleMarker(latLng, stopMarkerStyle(stop.properties.stop_id))
    marker
      .bindPopup(popupContent(stop))
      .on('click', () => {
        selectedStopId.value = stop.properties.stop_id
        stopQuery.value = stop.properties.stop_name
        updateSelectedStopMarker()
      })
      .addTo(stopLayer)
    stopMarkers.set(stop.properties.stop_id, marker)
    bounds.extend(latLng)
  }

  routeLayer.addTo(map)
  stopLayer.addTo(map)
  updateSelectedStopMarker()
  if (bounds.isValid() && !preserveView) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 })
}

onMounted(async () => {
  try {
    const [stopsResponse, routesResponse, transitResponse] = await Promise.all([
      fetch('/data/geojson/stops.geojson'),
      fetch('/data/geojson/routes.geojson'),
      fetch('/data/normalized/torrevieja-transit.json'),
    ])
    if (!stopsResponse.ok || !routesResponse.ok || !transitResponse.ok) throw new Error('Exported transit data is not available yet.')
    stops.value = (await stopsResponse.json()).features
    routes.value = (await routesResponse.json()).features
    transitData.value = await transitResponse.json()
    await nextTick()
    map = L.map(mapEl.value, {
      center: [37.9786, -0.6821],
      zoom: 13,
      zoomControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
  renderMapData()
  } catch (error) {
    loadError.value = error.message
  }
})

watch([filteredRoutes, filteredStops], () => renderMapData({ preserveView: Boolean(selectedStopId.value) }))
watch(selectedStopId, updateSelectedStopMarker)
</script>

<template>
  <main class="shell">
    <section class="toolbar">
      <div>
        <p class="eyebrow">Torrevieja transit</p>
        <h1>Official AVANZA route data</h1>
      </div>

      <div class="controls">
        <label>
          Route
          <select id="route-select" v-model="selectedRoute" name="route">
            <option value="all">All</option>
            <option v-for="route in routeOptions" :key="route.id" :value="route.id">
              {{ route.linweb }} - {{ route.name }}
            </option>
          </select>
        </label>

        <label>
          Direction
          <select id="direction-select" v-model="selectedDirection" name="direction">
            <option value="all">Both</option>
            <option value="0">Ida</option>
            <option value="1">Vuelta</option>
          </select>
        </label>
      </div>
    </section>

    <section class="workspace">
      <aside class="stop-search">
        <label class="search-label">
          Stop search
          <input
            v-model="stopQuery"
            type="search"
            name="stop-search"
            placeholder="Type stop name or code"
            autocomplete="off"
          />
        </label>

        <div v-if="stopMatches.length > 0" class="stop-results">
          <button
            v-for="stop in stopMatches"
            :key="stop.properties.stop_id"
            type="button"
            @click="chooseStop(stop)"
          >
            <strong>{{ stop.properties.stop_name }}</strong>
            <span>Stop {{ stop.properties.stop_id }} · routes {{ publicRouteNames(stop.properties.route_ids).join(', ') }}</span>
          </button>
        </div>

        <div v-if="selectedStop" class="stop-card">
          <div>
            <strong>{{ selectedStop.properties.stop_name }}</strong>
            <span>Stop {{ selectedStop.properties.stop_id }}</span>
          </div>
          <div class="stop-route-actions">
            <button
              v-if="selectedStopRoutes.length > 1"
              type="button"
              :class="{ active: selectedStopRouteId === '' }"
              @click="selectedStopRouteId = ''"
            >
              All passing routes
            </button>
            <button
              v-for="route in selectedStopRoutes"
              :key="route.id"
              type="button"
              :class="{ active: selectedStopRouteId === route.id }"
              @click="chooseStopRoute(route.id)"
            >
              {{ route.linweb }} - {{ route.name }}
            </button>
          </div>
        </div>

        <div v-if="scheduleRouteIds.length > 0" class="schedule-card">
          <div class="schedule-card-header">
            <div>
              <strong>Departures</strong>
              <span>from route origin</span>
            </div>
            <select v-model="selectedScheduleDate" name="schedule-date">
              <option v-for="date in scheduleDates" :key="date" :value="date">
                {{ formattedScheduleDate(date) }}
              </option>
            </select>
          </div>

          <p class="schedule-note">
            These are official terminal departures, not arrival times at the selected stop.
          </p>

          <div v-if="scheduleGroups.length > 0" class="schedule-groups">
            <section v-for="group in scheduleGroups" :key="group.key" class="schedule-group">
              <header>
                <strong>{{ group.route.linweb }}</strong>
                <span>{{ group.direction_label }} · to {{ group.headsign }}</span>
              </header>
              <div class="time-grid">
                <span v-for="time in group.times" :key="`${group.key}-${time}`">{{ time }}</span>
              </div>
            </section>
          </div>
          <p v-else class="schedule-empty">No departures found for this date and direction.</p>
        </div>
      </aside>

      <section class="map-panel">
        <div v-if="loadError" class="empty">{{ loadError }}</div>
        <div v-else ref="mapEl" class="real-map" aria-label="Torrevieja bus route map"></div>
      </section>
    </section>

    <section class="stats">
      <div>
        <strong>{{ activeRouteLabel }}</strong>
        <span>selected route</span>
      </div>
      <div>
        <strong>{{ filteredRoutes.length }}</strong>
        <span>directions shown</span>
      </div>
      <div>
        <strong>{{ filteredStops.length }}</strong>
        <span>stops shown</span>
      </div>
    </section>
  </main>
</template>
