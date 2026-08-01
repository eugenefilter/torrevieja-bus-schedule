# Torrevieja Bus Data Agent Plan

## Plan

1. Confirm the official data sources and inspect the AVANZA API responses for every new route.
2. Build a repeatable data collection pipeline that saves raw responses, screenshots, timestamps, checksums, and source metadata.
3. Normalize the collected data into routes, directions, stops, ordered route stops, services, trips, stop times, headways, and shapes.
4. Validate data quality with strict checks for coordinates, route structure, schedules, references, and missing fields.
5. Export the normalized dataset to JSON, GeoJSON, and GTFS Static.
6. Add an update workflow that compares new snapshots with previous data and blocks unsafe production overwrites.
7. Create a simple map view in the Vue app to visually verify routes, directions, and stops.
8. Document incomplete data, source coverage, warnings, and validation results.

## Checklist

- [x] Source discovery
- [x] Raw data collection
- [x] Normalization
- [x] Validation
- [x] JSON export
- [x] GeoJSON export
- [x] GTFS export
- [x] Update and diff workflow
- [x] Demo map
- [x] Source report and warnings
- [ ] Final verification

## Checklist Steps

### 1. Source discovery

- [x] List all target route IDs: `071`, `081`, `082`, `083`, `084`, `085`, `086`, `087`, `088`, `091`, `092`, `093`.
- [x] Request each official `apiLineDetail` URL.
- [x] Save one raw sample per route in `data/raw/`.
- [x] Inspect response structure for stops, directions, schedules, coordinates, and geometry.
- [x] Use Playwright only where API responses are incomplete or require browser-side interaction.
- [x] Record discovered endpoints in `data/source-report.json`.
- [x] Record fixed `linweb` to `linsae` mapping in `src/transit/routes.js`.

### 2. Raw data collection

- [x] Create scraper scripts under `src/transit/`.
- [x] Save raw API responses with route ID, source URL, timestamp, and checksum.
- [ ] Capture screenshots after page hydration when Playwright is used.
- [x] Store failed requests without hiding errors.
- [x] Make scraping idempotent so repeated runs do not corrupt previous data.

### 3. Normalization

- [x] Create route records for all C, 01-08, N1-N3 lines.
- [x] Create separate direction records when official API returns them.
- [x] Normalize stops with official codes, names, lat/lon, source, and verification status.
- [x] Build ordered route stop lists per route and direction.
- [x] Normalize exact terminal-departure trips and stop times when official times exist.
- [x] Store headways separately from exact trips.
- [x] Mark missing or unavailable data explicitly instead of inventing values.

### 4. Validation

- [x] Validate coordinate bbox for Torrevieja.
- [x] Detect swapped latitude/longitude values.
- [x] Reject `0,0` coordinates.
- [x] Check duplicate stop IDs and suspicious duplicate coordinates.
- [x] Check route stop sequences are strictly increasing.
- [x] Verify both directions exist for every route.
- [x] Verify weekday, weekend, public holiday, high season, and night-line handling.
- [x] Produce a validation report with warnings and blocking errors.

### 5. JSON export

- [x] Export normalized files to `data/normalized/`.
- [x] Export the combined dataset JSON with metadata.
- [x] Include source URLs and generated timestamp.
- [x] Ensure all references between routes, directions, stops, trips, and stop times are valid.

### 6. GeoJSON export

- [x] Export `data/geojson/stops.geojson`.
- [x] Export `data/geojson/routes.geojson`.
- [x] Use `[longitude, latitude]` coordinate order.
- [x] Mark route geometry as `official_api`, `official_gtfs`, `official_map`, or `router_derived`.
- [x] Do not output straight-line route geometry as official data.

### 7. GTFS export

- [x] Export required GTFS files under `data/gtfs/`.
- [x] Create `agency.txt` with timezone `Europe/Madrid`.
- [x] Use `route_type = 3`.
- [x] Handle night-line times after midnight with GTFS-compatible values.
- [x] Create a GTFS ZIP.
- [ ] Validate the feed with MobilityData GTFS Validator.

### 8. Update and diff workflow

- [x] Add `npm run update`.
- [x] Save every new scrape as a snapshot.
- [ ] Compare snapshots for added or removed stops.
- [ ] Compare route stop order changes.
- [ ] Compare trip, headway, and geometry changes.
- [x] Block production overwrite on critical validation failure.

### 9. Demo map

- [x] Add a map view to the Vue app.
- [x] Load exported stops and route GeoJSON.
- [x] Show each route direction separately.
- [x] Show stop markers with names and route IDs.
- [ ] Use the map to visually inspect every route.

### 10. Source report and warnings

- [x] Generate `data/source-report.json`.
- [x] Record source URL, scrape timestamp, endpoints, and response status per route.
- [x] Record counts for directions, stops, trips, and geometry.
- [x] Add warnings for missing official data.
- [x] Mark every value source as official, derived, inferred, or missing.

### 11. Final verification

- [x] Confirm all 12 routes are present.
- [ ] Confirm both directions are present for every route.
- [x] Confirm stops are ordered.
- [x] Confirm coordinates are present or explicitly marked missing.
- [x] Confirm schedules and headways are not mixed.
- [x] Confirm JSON and GeoJSON exports exist.
- [ ] Confirm GTFS ZIP exists and passes validation.
- [x] Confirm demo map loads routes and stops.
- [x] Confirm no coordinates, stop times, or route shapes were invented.
