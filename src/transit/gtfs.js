import { writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { ensureDir } from './io.js'
import { NETWORK } from './routes.js'

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function writeCsv(path, rows, headers) {
  await ensureDir(dirname(path))
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n')
  await writeFile(path, `${body}\n`, 'utf8')
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { time, date: dosDate }
}

export async function writeZip(path, files) {
  await ensureDir(dirname(path))
  const localParts = []
  const centralParts = []
  let offset = 0
  const { time, date } = dosDateTime()

  for (const file of files) {
    const name = Buffer.from(file.name)
    const content = Buffer.from(file.content)
    const crc = crc32(content)

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(time),
      writeUInt16(date),
      writeUInt32(crc),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name,
    ])

    localParts.push(localHeader, content)

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(time),
      writeUInt16(date),
      writeUInt32(crc),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name,
    ])
    centralParts.push(centralHeader)
    offset += localHeader.length + content.length
  }

  const central = Buffer.concat(centralParts)
  const local = Buffer.concat(localParts)
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(central.length),
    writeUInt32(local.length),
    writeUInt16(0),
  ])

  await writeFile(path, Buffer.concat([local, central, end]))
}

export function gtfsRows(dataset) {
  const agency = [
    {
      agency_id: 'avanza-torrevieja',
      agency_name: NETWORK.agencyName,
      agency_url: NETWORK.agencyUrl,
      agency_timezone: NETWORK.agencyTimezone,
      agency_lang: 'es',
    },
  ]

  const routes = dataset.routes.map((route) => ({
    route_id: route.id,
    agency_id: 'avanza-torrevieja',
    route_short_name: route.short_name,
    route_long_name: route.long_name,
    route_type: 3,
  }))

  const stops = dataset.stops.map((stop) => ({
    stop_id: stop.id,
    stop_code: stop.code,
    stop_name: stop.name,
    stop_lat: stop.lat ?? '',
    stop_lon: stop.lon ?? '',
    wheelchair_boarding: '',
  }))

  const trips = dataset.trips.map((trip) => ({
    route_id: trip.route_id,
    service_id: trip.service_id,
    trip_id: trip.trip_id,
    trip_headsign: trip.headsign,
    direction_id: trip.direction_id,
    shape_id: `${trip.route_id}-${trip.direction_id}`,
  }))

  const stopTimes = dataset.stop_times.map((time) => ({
    trip_id: time.trip_id,
    arrival_time: time.arrival_time ?? '',
    departure_time: time.departure_time ?? '',
    stop_id: time.stop_id,
    stop_sequence: time.stop_sequence,
  }))

  const calendar = dataset.services.map((service) => ({
    service_id: service.service_id,
    monday: service.monday ? 1 : 0,
    Tuesday: service.tuesday ? 1 : 0,
    wednesday: service.wednesday ? 1 : 0,
    thursday: service.thursday ? 1 : 0,
    friday: service.friday ? 1 : 0,
    saturday: service.saturday ? 1 : 0,
    sunday: service.sunday ? 1 : 0,
    start_date: service.valid_from.replaceAll('-', ''),
    end_date: service.valid_to.replaceAll('-', ''),
  }))

  const tripIds = new Set(dataset.trips.map((trip) => trip.trip_id))
  const frequencies = dataset.headways.filter((headway) => tripIds.has(headway.representative_trip_id)).map((headway) => ({
    trip_id: headway.representative_trip_id,
    start_time: headway.start_time,
    end_time: headway.end_time,
    headway_secs: headway.headway_minutes * 60,
    exact_times: 0,
  }))

  const shapes = []
  for (const shape of dataset.shapes) {
    let sequence = 1
    for (const coordinate of shape.coordinates) {
      shapes.push({
        shape_id: `${shape.route_id}-${shape.direction_id}`,
        shape_pt_lat: coordinate[1],
        shape_pt_lon: coordinate[0],
        shape_pt_sequence: sequence,
      })
      sequence += 1
    }
  }

  const calendarDates = (dataset.calendar_dates ?? []).map((item) => ({
    service_id: item.service_id,
    date: item.date.replaceAll('-', ''),
    exception_type: item.exception_type,
  }))

  const feedInfo = [
    {
      feed_publisher_name: NETWORK.agencyName,
      feed_publisher_url: NETWORK.agencyUrl,
      feed_lang: 'es',
      feed_start_date: NETWORK.networkStartDate.replaceAll('-', ''),
      feed_version: dataset.metadata.generated_at,
    },
  ]

  return {
    'agency.txt': { headers: ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'], rows: agency },
    'routes.txt': { headers: ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], rows: routes },
    'stops.txt': { headers: ['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon', 'wheelchair_boarding'], rows: stops },
    'trips.txt': { headers: ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], rows: trips },
    'stop_times.txt': { headers: ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], rows: stopTimes },
    'calendar.txt': { headers: ['service_id', 'monday', 'Tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], rows: calendar },
    'calendar_dates.txt': { headers: ['service_id', 'date', 'exception_type'], rows: calendarDates },
    'frequencies.txt': { headers: ['trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times'], rows: frequencies },
    'shapes.txt': { headers: ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], rows: shapes },
    'feed_info.txt': { headers: ['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_version'], rows: feedInfo },
  }
}

export async function exportGtfs(dataset, outDir) {
  const specs = gtfsRows(dataset)
  const zipFiles = []
  for (const [fileName, spec] of Object.entries(specs)) {
    const path = join(outDir, fileName)
    await writeCsv(path, spec.rows, spec.headers)
    const content = await import('node:fs/promises').then((fs) => fs.readFile(path))
    zipFiles.push({ name: basename(path), content })
  }
  await writeZip(join(outDir, 'torrevieja-gtfs.zip'), zipFiles)
}
