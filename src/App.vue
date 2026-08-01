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

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
const isDark = ref(localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && prefersDark.matches))

const applyTheme = () => document.documentElement.classList.toggle('dark', isDark.value)
applyTheme()

const toggleTheme = () => {
  isDark.value = !isDark.value
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  applyTheme()
}

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
      fetch(`${import.meta.env.BASE_URL}data/geojson/stops.geojson`),
      fetch(`${import.meta.env.BASE_URL}data/geojson/routes.geojson`),
      fetch(`${import.meta.env.BASE_URL}data/normalized/torrevieja-transit.json`),
    ])
    if (!stopsResponse.ok || !routesResponse.ok || !transitResponse.ok) throw new Error('Exported transit data is not available yet.')
    stops.value = (await stopsResponse.json()).features
    routes.value = (await routesResponse.json()).features
    transitData.value = await transitResponse.json()
    const todayKey = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    if (scheduleDates.value.includes(todayKey)) {
      selectedScheduleDate.value = todayKey
    } else if (scheduleDates.value.length > 0) {
      selectedScheduleDate.value = scheduleDates.value[0]
    }
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
  <main class="mx-auto w-full max-w-[1180px] px-4 py-8">
    <section class="mb-6 flex flex-col items-stretch gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
          Torrevieja transit
        </p>
        <h1 class="m-0 text-[28px] font-bold tracking-tight text-slate-900 dark:text-neutral-50">
          Official AVANZA route data
        </h1>
      </div>

      <div class="flex items-center gap-2.5">
        <label class="grid gap-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">
          Route
          <div class="relative">
            <select
              id="route-select"
              v-model="selectedRoute"
              name="route"
              class="h-10 w-full min-w-[148px] cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-8 text-sm text-slate-900 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700"
            >
              <option value="all">All</option>
              <option v-for="route in routeOptions" :key="route.id" :value="route.id">
                {{ route.linweb }} - {{ route.name }}
              </option>
            </select>
            <svg class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </div>
        </label>

        <label class="grid gap-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">
          Direction
          <div class="relative">
            <select
              id="direction-select"
              v-model="selectedDirection"
              name="direction"
              class="h-10 w-full min-w-[110px] cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-8 text-sm text-slate-900 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700"
            >
              <option value="all">Both</option>
              <option value="0">Ida</option>
              <option value="1">Vuelta</option>
            </select>
            <svg class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </div>
        </label>

        <button
          type="button"
          class="mt-[19px] flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-100"
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme"
        >
          <svg v-if="isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
        </button>
      </div>
    </section>

    <section class="mb-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col gap-3 md:min-h-[640px]">
        <label class="grid gap-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">
          Stop search
          <div class="relative">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              v-model="stopQuery"
              type="search"
              name="stop-search"
              placeholder="Type stop name or code"
              autocomplete="off"
              class="h-11 w-full rounded-lg border border-slate-200 bg-white py-0 pl-9 pr-3.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:hover:border-neutral-700"
            />
          </div>
        </label>

        <div v-if="stopMatches.length > 0" class="grid max-h-[392px] gap-1.5 overflow-auto pr-0.5">
          <button
            v-for="stop in stopMatches"
            :key="stop.properties.stop_id"
            type="button"
            class="grid w-full cursor-pointer gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-blue-500 hover:bg-blue-50 active:scale-[0.99] dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-500 dark:hover:bg-blue-500/10"
            @click="chooseStop(stop)"
          >
            <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ stop.properties.stop_name }}</strong>
            <span class="text-[13px] text-slate-500 dark:text-neutral-400">Stop {{ stop.properties.stop_id }} · routes {{ publicRouteNames(stop.properties.route_ids).join(', ') }}</span>
          </button>
        </div>

        <div v-if="selectedStop" class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div class="grid gap-0.5">
            <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ selectedStop.properties.stop_name }}</strong>
            <span class="text-[13px] text-slate-500 dark:text-neutral-400">Stop {{ selectedStop.properties.stop_id }}</span>
          </div>
          <div class="grid gap-1.5">
            <button
              v-if="selectedStopRoutes.length > 1"
              type="button"
              class="cursor-pointer rounded-lg border px-2.5 py-2 text-left text-[13.5px] font-medium transition"
              :class="selectedStopRouteId === ''
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'"
              @click="selectedStopRouteId = ''"
            >
              All passing routes
            </button>
            <button
              v-for="route in selectedStopRoutes"
              :key="route.id"
              type="button"
              class="cursor-pointer rounded-lg border px-2.5 py-2 text-left text-[13.5px] font-medium transition"
              :class="selectedStopRouteId === route.id
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-400'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'"
              @click="chooseStopRoute(route.id)"
            >
              {{ route.linweb }} - {{ route.name }}
            </button>
          </div>
        </div>

        <div v-if="scheduleRouteIds.length > 0" class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-start justify-between gap-2.5">
            <div class="grid gap-0.5">
              <strong class="font-bold tracking-tight text-slate-900 dark:text-neutral-100">Departures</strong>
              <span class="text-[13px] text-slate-500 dark:text-neutral-400">from route origin</span>
            </div>
            <div class="relative">
              <select
                v-model="selectedScheduleDate"
                name="schedule-date"
                class="h-9 min-w-[120px] cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-7 text-sm text-slate-900 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700"
              >
                <option v-for="date in scheduleDates" :key="date" :value="date">
                  {{ formattedScheduleDate(date) }}
                </option>
              </select>
              <svg class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>

          <p class="m-0 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">
            These are official terminal departures, not arrival times at the selected stop.
          </p>

          <div v-if="scheduleGroups.length > 0" class="grid max-h-80 gap-3 overflow-auto pr-0.5">
            <section v-for="group in scheduleGroups" :key="group.key" class="grid gap-2 border-t border-slate-200 pt-3 dark:border-neutral-800">
              <header class="grid gap-0.5">
                <strong class="font-bold text-slate-900 dark:text-neutral-100">{{ group.route.linweb }}</strong>
                <span class="text-[13px] leading-tight text-slate-500 dark:text-neutral-400">{{ group.direction_label }} · to {{ group.headsign }}</span>
              </header>
              <div class="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5">
                <span
                  v-for="time in group.times"
                  :key="`${group.key}-${time}`"
                  class="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-center text-[12.5px] font-semibold tabular-nums text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >{{ time }}</span>
              </div>
            </section>
          </div>
          <p v-else class="m-0 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">No departures found for this date and direction.</p>
        </div>
      </aside>

      <section class="min-h-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-md md:min-h-[640px] dark:border-neutral-800 dark:bg-neutral-900">
        <div v-if="loadError" class="grid min-h-[400px] place-items-center p-6 text-center font-semibold text-red-600 md:min-h-[560px] dark:text-red-400">{{ loadError }}</div>
        <div v-else ref="mapEl" class="h-[min(72vh,760px)] min-h-[400px] w-full md:min-h-[640px]" aria-label="Torrevieja bus route map"></div>
      </section>
    </section>
  </main>
</template>
