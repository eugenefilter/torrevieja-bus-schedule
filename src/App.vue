<script setup>
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const stops = ref([])
const routes = ref([])
const transitData = ref(null)
const selectedRoute = ref('all')
const selectedDirection = ref('all')
const loadError = ref('')
const searchQuery = ref('')
const selectedStopId = ref('')
const selectedStopRouteId = ref('')
const selectedScheduleDate = ref('20260729')
const addressResults = ref([])
const addressLoading = ref(false)
const addressError = ref('')
const selectedLocation = ref(null)
const nearbyRadius = ref(500)
const suggestionsOpen = ref(false)
const locationExpanded = ref(true)
const stopExpanded = ref(true)
const mapEl = ref(null)
let map = null
let routeLayer = null
let stopLayer = null
let locationLayer = null
let stopMarkers = new Map()
let addressDebounceTimer = null
let addressAbortController = null

const TORREVIEJA_VIEWBOX = '-1.0,38.15,-0.4,37.75'

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

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.sqrt(a))
}

const selectedStop = computed(() => stops.value.find((stop) => stop.properties.stop_id === selectedStopId.value))

const selectedStopRouteIds = computed(() => new Set(selectedStop.value?.properties.route_ids ?? []))

const filteredRoutes = computed(() => {
  const stopRouteFilter = selectedStopRouteId.value
    ? new Set([selectedStopRouteId.value])
    : selectedStopId.value
      ? selectedStopRouteIds.value
      : selectedLocation.value
        ? new Set(nearbyStops.value.flatMap((entry) => entry.stop.properties.route_ids))
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
  if (selectedLocation.value) return nearbyStops.value.map((entry) => entry.stop)
  if (selectedRoute.value === 'all') return stops.value
  return stops.value.filter((stop) => stop.properties.route_ids.includes(selectedRoute.value))
})

const routeById = computed(() => {
  const byId = new Map()
  for (const route of routeOptions.value) byId.set(route.id, route)
  return byId
})

const stopMatches = computed(() => {
  const query = normalizeSearchText(searchQuery.value.trim())
  if (query.length < 2) return []
  return stops.value
    .filter((stop) => {
      const haystack = normalizeSearchText(`${stop.properties.stop_id} ${stop.properties.stop_code} ${stop.properties.stop_name}`)
      return haystack.includes(query)
    })
    .slice(0, 8)
})

const nearbyStops = computed(() => {
  if (!selectedLocation.value) return []
  const { lat, lon } = selectedLocation.value
  return stops.value
    .map((stop) => {
      const [stopLon, stopLat] = stop.geometry.coordinates
      return { stop, distance: haversineMeters(lat, lon, stopLat, stopLon) }
    })
    .filter((entry) => entry.distance <= nearbyRadius.value)
    .sort((a, b) => a.distance - b.distance)
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

const formattedScheduleDate = (date) => `${date.slice(6, 8)}.${date.slice(4, 6)}.${date.slice(0, 4)}`

const directionLabel = (directionId) => (Number(directionId) === 0 ? 'Ida' : 'Vuelta')

const calendarOpen = ref(false)
const calendarCursor = ref(new Date())
const scheduleDatePickerEl = ref(null)
const weekdayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const pad2 = (n) => String(n).padStart(2, '0')
const dateKeyFromParts = (year, month, day) => `${year}${pad2(month + 1)}${pad2(day)}`
const partsFromDateKey = (key) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(4, 6)) - 1, day: Number(key.slice(6, 8)) })

// The scraped data only contains one sample date per day-type (weekday / Saturday / Sunday).
// Those patterns repeat every week, so any calendar date is resolved to whichever sample matches its day of week.
const serviceIdByDayType = computed(() => {
  const services = transitData.value?.services ?? []
  const weekday = services.find((s) => s.monday || s.tuesday || s.wednesday || s.thursday || s.friday)
  const saturday = services.find((s) => s.saturday)
  const sunday = services.find((s) => s.sunday)
  return { weekday: weekday?.service_id, saturday: saturday?.service_id, sunday: sunday?.service_id }
})

const serviceIdForDateKey = (key) => {
  const { year, month, day } = partsFromDateKey(key)
  const dayOfWeek = new Date(year, month, day).getDay()
  if (dayOfWeek === 0) return serviceIdByDayType.value.sunday
  if (dayOfWeek === 6) return serviceIdByDayType.value.saturday
  return serviceIdByDayType.value.weekday
}

const calendarMonthLabel = computed(() =>
  calendarCursor.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
)

const calendarDays = computed(() => {
  const year = calendarCursor.value.getFullYear()
  const month = calendarCursor.value.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = (firstOfMonth.getDay() + 6) % 7
  const startDate = new Date(year, month, 1 - startOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + index)
    const key = dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate())
    return {
      key,
      dayNumber: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
    }
  })
})

const calendarShiftMonth = (delta) => {
  calendarCursor.value = new Date(calendarCursor.value.getFullYear(), calendarCursor.value.getMonth() + delta, 1)
}

const openCalendar = () => {
  const { year, month } = partsFromDateKey(selectedScheduleDate.value)
  calendarCursor.value = new Date(year, month, 1)
  calendarOpen.value = true
}

const toggleCalendar = () => {
  if (calendarOpen.value) calendarOpen.value = false
  else openCalendar()
}

const selectCalendarDate = (key) => {
  selectedScheduleDate.value = key
  calendarOpen.value = false
}

const handleDocumentClick = (event) => {
  if (calendarOpen.value && scheduleDatePickerEl.value && !scheduleDatePickerEl.value.contains(event.target)) {
    calendarOpen.value = false
  }
}

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
    if (trip.service_id !== serviceIdForDateKey(selectedScheduleDate.value)) continue
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

const now = ref(new Date())
const todayKey = computed(() => now.value.toISOString().slice(0, 10).replaceAll('-', ''))
const isScheduleToday = computed(() => selectedScheduleDate.value === todayKey.value)
const currentTimeLabel = computed(() => now.value.toTimeString().slice(0, 5))

const nextDepartureByGroup = computed(() => {
  const nextByGroup = new Map()
  if (!isScheduleToday.value) return nextByGroup
  for (const group of scheduleGroups.value) {
    const next = group.times.find((time) => time >= currentTimeLabel.value)
    if (next) nextByGroup.set(group.key, next)
  }
  return nextByGroup
})

const isNextDeparture = (group, time) => nextDepartureByGroup.value.get(group.key) === time

const asLatLng = ([lon, lat]) => [lat, lon]

const popupContent = (stop) => {
  const routesText = publicRouteNames(stop.properties.route_ids).join(', ')
  return `<strong>${stop.properties.stop_name}</strong><br><span>Stop ${stop.properties.stop_id}</span><br><span>Routes: ${routesText}</span>`
}

const chooseStop = (stop) => {
  selectedStopId.value = stop.properties.stop_id
  selectedStopRouteId.value = ''
  searchQuery.value = stop.properties.stop_name
  suggestionsOpen.value = false
  stopExpanded.value = true
  addressResults.value = []
  addressError.value = ''
  selectedLocation.value = null
  updateLocationMarker()
  const [lat, lon] = asLatLng(stop.geometry.coordinates)
  if (map) map.setView([lat, lon], 16)
  updateSelectedStopMarker()
  stopMarkers.get(stop.properties.stop_id)?.openPopup()
}

const chooseStopRoute = (routeId) => {
  selectedStopRouteId.value = routeId
  renderMapData({ preserveView: true })
}

const clearStopSelection = () => {
  selectedStopId.value = ''
  selectedStopRouteId.value = ''
  searchQuery.value = ''
  suggestionsOpen.value = false
  updateSelectedStopMarker()
}

const updateLocationMarker = () => {
  if (!map) return
  if (locationLayer) locationLayer.remove()
  if (!selectedLocation.value) return

  const { lat, lon, label } = selectedLocation.value
  locationLayer = L.layerGroup()
  L.circle([lat, lon], {
    radius: nearbyRadius.value,
    color: '#d1495b',
    weight: 1,
    fillOpacity: 0.05,
  }).addTo(locationLayer)
  L.circleMarker([lat, lon], {
    radius: 8,
    color: '#d1495b',
    weight: 3,
    fillColor: '#ffffff',
    fillOpacity: 1,
  })
    .bindPopup(label)
    .addTo(locationLayer)
  locationLayer.addTo(map)
}

const fitToNearbyStops = () => {
  if (!map || !selectedLocation.value) return
  const bounds = L.latLngBounds([[selectedLocation.value.lat, selectedLocation.value.lon]])
  for (const { stop } of nearbyStops.value) bounds.extend(asLatLng(stop.geometry.coordinates))
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
}

const searchAddress = async (query) => {
  addressAbortController?.abort()
  addressAbortController = new AbortController()
  addressLoading.value = true
  addressError.value = ''
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('format', 'json')
    url.searchParams.set('q', query)
    url.searchParams.set('viewbox', TORREVIEJA_VIEWBOX)
    url.searchParams.set('bounded', '1')
    url.searchParams.set('limit', '6')
    const response = await fetch(url, { signal: addressAbortController.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('Address search failed.')
    addressResults.value = await response.json()
  } catch (error) {
    if (error.name !== 'AbortError') {
      addressError.value = 'Could not search that address. Please try again.'
      addressResults.value = []
    }
  } finally {
    addressLoading.value = false
  }
}

const chooseAddressResult = (result) => {
  selectedLocation.value = { lat: Number(result.lat), lon: Number(result.lon), label: result.display_name }
  searchQuery.value = result.display_name
  suggestionsOpen.value = false
  locationExpanded.value = true
  addressResults.value = []
  addressError.value = ''
  selectedStopId.value = ''
  selectedStopRouteId.value = ''
  updateLocationMarker()
  fitToNearbyStops()
}

const clearAddressSearch = () => {
  searchQuery.value = ''
  suggestionsOpen.value = false
  addressResults.value = []
  addressError.value = ''
  selectedLocation.value = null
  updateLocationMarker()
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
        searchQuery.value = stop.properties.stop_name
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
    selectedScheduleDate.value = todayKey.value
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
  document.addEventListener('click', handleDocumentClick)
})

const nowInterval = setInterval(() => {
  now.value = new Date()
}, 30000)
onUnmounted(() => {
  clearInterval(nowInterval)
  document.removeEventListener('click', handleDocumentClick)
})

watch([filteredRoutes, filteredStops], () => renderMapData({ preserveView: Boolean(selectedStopId.value) }))
watch(selectedStopId, updateSelectedStopMarker)
watch(selectedRoute, () => {
  selectedStopId.value = ''
  selectedStopRouteId.value = ''
  searchQuery.value = ''
  suggestionsOpen.value = false
})
watch(searchQuery, (value) => {
  clearTimeout(addressDebounceTimer)
  if (!suggestionsOpen.value) {
    addressResults.value = []
    addressError.value = ''
    return
  }
  const query = value.trim()
  if (query.length < 3) {
    addressResults.value = []
    addressError.value = ''
    return
  }
  addressDebounceTimer = setTimeout(() => searchAddress(query), 600)
})
watch(nearbyRadius, () => {
  updateLocationMarker()
  fitToNearbyStops()
})
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

    <section class="content-grid mb-4 grid items-start gap-4">
      <aside class="[grid-area:search] flex min-h-0 flex-col gap-3">
        <label class="grid gap-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">
          Search stops, addresses or places
          <div class="relative">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              v-model="searchQuery"
              type="search"
              name="search"
              placeholder="Type a stop name, code, address or place"
              autocomplete="off"
              class="h-11 w-full rounded-lg border border-slate-200 bg-white py-0 pl-9 pr-3.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:hover:border-neutral-700"
              @input="suggestionsOpen = true"
            />
          </div>
        </label>

        <div v-if="suggestionsOpen && stopMatches.length > 0" class="grid max-h-[280px] gap-1.5 overflow-auto pr-0.5">
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

        <p v-if="suggestionsOpen && addressLoading" class="m-0 text-[13px] text-slate-500 dark:text-neutral-400">Searching places…</p>
        <p v-if="suggestionsOpen && addressError" class="m-0 text-[13px] font-medium text-red-600 dark:text-red-400">{{ addressError }}</p>

        <div v-if="suggestionsOpen && addressResults.length > 0" class="grid gap-1.5">
          <p class="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Places</p>
          <div class="grid max-h-[280px] gap-1.5 overflow-auto pr-0.5">
            <button
              v-for="result in addressResults"
              :key="result.place_id"
              type="button"
              class="grid w-full cursor-pointer gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-blue-500 hover:bg-blue-50 active:scale-[0.99] dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-500 dark:hover:bg-blue-500/10"
              @click="chooseAddressResult(result)"
            >
              <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ result.display_name.split(',')[0] }}</strong>
              <span class="text-[13px] text-slate-500 dark:text-neutral-400">{{ result.display_name }}</span>
            </button>
          </div>
        </div>

        <div v-if="selectedLocation" class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-start justify-between gap-2.5">
            <button
              type="button"
              class="grid flex-1 cursor-pointer grid-cols-[1fr_auto] items-start gap-2 text-left"
              @click="locationExpanded = !locationExpanded"
            >
              <span class="grid gap-0.5">
                <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ selectedLocation.label.split(',')[0] }}</strong>
                <span class="text-[13px] text-slate-500 dark:text-neutral-400">{{ nearbyStops.length }} stop(s) within {{ nearbyRadius }} m</span>
              </span>
              <svg
                class="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-neutral-500"
                :class="{ 'rotate-180': locationExpanded }"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              ><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <button
              type="button"
              class="cursor-pointer text-[13px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
              @click="clearAddressSearch"
            >
              Clear
            </button>
          </div>

          <template v-if="locationExpanded">
            <label class="grid gap-1.5 text-xs font-semibold text-slate-500 dark:text-neutral-400">
              Search radius
              <div class="relative">
                <select
                  v-model.number="nearbyRadius"
                  name="nearby-radius"
                  class="h-9 w-full min-w-[110px] cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-7 text-sm text-slate-900 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700"
                >
                  <option :value="250">250 m</option>
                  <option :value="500">500 m</option>
                  <option :value="1000">1000 m</option>
                  <option :value="1500">1500 m</option>
                </select>
                <svg class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
            </label>

            <div v-if="nearbyStops.length > 0" class="grid max-h-[280px] gap-1.5 overflow-auto pr-0.5">
              <button
                v-for="entry in nearbyStops"
                :key="entry.stop.properties.stop_id"
                type="button"
                class="grid w-full cursor-pointer gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-blue-500 hover:bg-blue-50 active:scale-[0.99] dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-500 dark:hover:bg-blue-500/10"
                @click="chooseStop(entry.stop)"
              >
                <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ entry.stop.properties.stop_name }}</strong>
                <span class="text-[13px] text-slate-500 dark:text-neutral-400">{{ Math.round(entry.distance) }} m · routes {{ publicRouteNames(entry.stop.properties.route_ids).join(', ') }}</span>
              </button>
            </div>
            <p v-else class="m-0 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">No stops within {{ nearbyRadius }} m. Try a larger radius.</p>
          </template>
        </div>

        <div v-if="selectedStop" class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-start justify-between gap-2.5">
            <button
              type="button"
              class="grid flex-1 cursor-pointer grid-cols-[1fr_auto] items-start gap-2 text-left"
              @click="stopExpanded = !stopExpanded"
            >
              <span class="grid gap-0.5">
                <strong class="font-semibold text-slate-900 dark:text-neutral-100">{{ selectedStop.properties.stop_name }}</strong>
                <span class="text-[13px] text-slate-500 dark:text-neutral-400">Stop {{ selectedStop.properties.stop_id }}</span>
              </span>
              <svg
                class="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform dark:text-neutral-500"
                :class="{ 'rotate-180': stopExpanded }"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              ><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <button
              type="button"
              class="cursor-pointer text-[13px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
              @click="clearStopSelection"
            >
              Clear
            </button>
          </div>
          <div v-if="stopExpanded" class="grid gap-1.5">
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
      </aside>

      <section class="[grid-area:map] min-h-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-md md:min-h-[640px] dark:border-neutral-800 dark:bg-neutral-900">
        <div v-if="loadError" class="grid min-h-[400px] place-items-center p-6 text-center font-semibold text-red-600 md:min-h-[560px] dark:text-red-400">{{ loadError }}</div>
        <div v-else ref="mapEl" class="h-[min(72vh,760px)] min-h-[400px] w-full md:min-h-[640px]" aria-label="Torrevieja bus route map"></div>
      </section>

      <div v-if="scheduleRouteIds.length > 0" class="[grid-area:departures] grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-start justify-between gap-2.5">
          <div class="grid gap-0.5">
            <strong class="font-bold tracking-tight text-slate-900 dark:text-neutral-100">Departures</strong>
            <span class="text-[13px] text-slate-500 dark:text-neutral-400">from route origin</span>
          </div>
          <div class="relative" ref="scheduleDatePickerEl">
            <button
              type="button"
              name="schedule-date"
              @click="toggleCalendar"
              :aria-expanded="calendarOpen"
              class="flex h-9 min-w-[120px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white py-0 pl-3 pr-2.5 text-sm text-slate-900 shadow-sm transition hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-700"
            >
              <svg class="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              <span>{{ formattedScheduleDate(selectedScheduleDate) }}</span>
            </button>

            <div
              v-if="calendarOpen"
              class="absolute right-0 top-[calc(100%+6px)] z-10 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div class="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  @click="calendarShiftMonth(-1)"
                  class="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <strong class="text-[13px] font-semibold text-slate-900 dark:text-neutral-100">{{ calendarMonthLabel }}</strong>
                <button
                  type="button"
                  @click="calendarShiftMonth(1)"
                  class="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>

              <div class="mb-1 grid grid-cols-7 gap-1 text-center text-[10.5px] font-medium text-slate-400 dark:text-neutral-500">
                <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
              </div>

              <div class="grid grid-cols-7 gap-1">
                <button
                  v-for="day in calendarDays"
                  :key="day.key"
                  type="button"
                  @click="selectCalendarDate(day.key)"
                  class="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-[12px] tabular-nums transition"
                  :class="[
                    day.inCurrentMonth ? 'text-slate-900 dark:text-neutral-100' : 'text-slate-300 dark:text-neutral-700',
                    day.key === selectedScheduleDate
                      ? 'bg-blue-600 font-semibold text-white shadow-sm dark:bg-blue-500'
                      : 'hover:bg-blue-50 dark:hover:bg-neutral-800',
                  ]"
                >{{ day.dayNumber }}</button>
              </div>
            </div>
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
                class="rounded-md border px-1.5 py-1.5 text-center text-[12.5px] font-semibold tabular-nums transition"
                :class="isNextDeparture(group, time)
                  ? 'border-blue-500 bg-blue-600 text-white shadow-sm dark:border-blue-500 dark:bg-blue-500'
                  : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'"
              >{{ time }}</span>
            </div>
          </section>
        </div>
        <p v-else class="m-0 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">No departures found for this date and direction.</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.content-grid {
  grid-template-columns: 1fr;
  grid-template-areas: 'search' 'map' 'departures';
}

@media (min-width: 768px) {
  .content-grid {
    grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
    grid-template-areas: 'search map' 'departures map';
  }
}
</style>
