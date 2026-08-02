# Geocoded Stop Search Plan

## Plan

1. Add a Nominatim-based address/POI search alongside the existing stop-name search, scoped to the Torrevieja bounding box.
2. Debounce and rate-limit geocoding requests to respect Nominatim's usage policy (max ~1 req/sec, custom identifying header).
3. On selecting a geocoded result, compute the great-circle distance (Haversine) from that point to every stop already loaded in `stops.geojson`.
4. Filter stops to a configurable radius (default 1000m) and sort by distance.
5. Render the searched location as a distinct marker and list the nearby stops with distance, reusing the existing stop-selection flow to show routes and schedules.
6. Handle empty results, geocoding failures, and offline/API-error states without breaking the existing stop-code search.

## Checklist

- [ ] Nominatim search integration
- [ ] Distance calculation
- [ ] Nearby stops UI
- [ ] Map marker for searched location
- [ ] Error and edge case handling
- [ ] Manual verification

## Checklist Steps

### 1. Nominatim search integration

- [ ] Add a search input (or extend the existing one) for free-text address/POI queries, separate from the stop-code filter.
- [ ] Debounce input (e.g. 500ms) before firing a request.
- [ ] Call `https://nominatim.openstreetmap.org/search` with `format=json`, `viewbox` set to Torrevieja's bounding box, `bounded=1`.
- [ ] Set a descriptive `User-Agent`/`Referer` per Nominatim's usage policy.
- [ ] Show a dropdown of results (display name + address) as the user types.
- [ ] Handle no-results and request-failure states in the dropdown.

### 2. Distance calculation

- [ ] Implement a Haversine distance helper (pure function, no external dependency).
- [ ] On result selection, compute distance from the selected coordinates to every stop in the already-loaded `stops.geojson`.
- [ ] Sort stops by ascending distance.

### 3. Nearby stops UI

- [ ] Add a radius control (default 1000m, adjustable) to limit which stops are shown.
- [ ] Render the filtered/sorted list of nearby stops with distance (e.g. "Calle X — 240 m").
- [ ] Clicking a nearby stop reuses the existing stop-selection logic (routes + schedule panel).
- [ ] Show an empty state when no stops fall within the radius.

### 4. Map marker for searched location

- [ ] Add a distinct marker/icon for the geocoded search result, separate from stop markers.
- [ ] Pan/zoom the map to fit the searched location and its nearby stops.
- [ ] Clear the marker when the search is cleared or a new search is made.

### 5. Error and edge case handling

- [ ] Handle Nominatim rate-limit/HTTP errors gracefully (inline message, no crash).
- [ ] Handle queries outside the Torrevieja bounding box (no relevant results).
- [ ] Keep the existing stop-name/code search fully functional and unaffected.

### 6. Manual verification

- [ ] Test with a known address in Torrevieja.
- [ ] Test with a POI name (e.g. a supermarket or landmark).
- [ ] Test with an ambiguous/ no-result query.
- [ ] Verify behavior on mobile viewport (per existing responsive UI).
