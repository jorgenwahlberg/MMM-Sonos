# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MMM-Sonos is a MagicMirror² module that displays currently playing Sonos music information. It polls the node-sonos-http-api to retrieve zone information and renders album art, artist, track, and room names. The module automatically hides when nothing is playing.

This is a fork that replaced the deprecated NPM "request" module with Node's built-in `http`/`https` modules to maintain compatibility with MagicMirror v2.16+ and Docker environments.

**NRK Radio Integration**: When playing NRK Radio stations on Sonos, the module automatically fetches real-time track information (artist, title, album art) from NRK's public API instead of using generic Sonos stream data.

## Architecture

The module follows MagicMirror's standard two-part architecture:

1. **Frontend Module** (`MMM-Sonos.js`): Runs in the browser, handles UI rendering and display logic
2. **Node Helper** (`node_helper.js`): Runs in Node.js backend, makes HTTP requests to Sonos API

Communication flow:
- Frontend sends `SONOS_UPDATE` notification with API URL to node helper
- Node helper fetches data from Sonos API using native `http`/`https` modules
- **NRK enrichment**: If NRK Radio station detected, node helper fetches current track info from NRK API and merges it into the zone data
- Node helper sends `SONOS_DATA` notification with enriched JSON back to frontend
- Frontend renders the data and auto-hides module when nothing is playing

## Key Files

- `MMM-Sonos.js`: Main module file with rendering logic, jQuery-based DOM manipulation
- `node_helper.js`: Backend HTTP client using Node's native `http`/`https` modules, includes NRK API integration
- `nrk-stations.json`: Configuration mapping NRK station IDs to API endpoints
- `sonos.css`: Base styling with text overflow ellipsis for long artist/track names
- `String.format.js`: Utility adding `.format()` method to String prototype for template rendering

## Development Setup

Install dependencies:
```bash
npm init
npm install request
```

Note: The `request` module is installed locally in this module's directory to avoid conflicts with MagicMirror v2.16+ which removed it as a global dependency.

## Dependencies

- **External**: node-sonos-http-api (must be installed and running separately)
- **Runtime**: jQuery 2.2.2 (loaded from CDN)
- **npm**: request module (deprecated but required for backward compatibility)

## Important Implementation Details

### Data Flow and Polling

The module polls the Sonos API every 30 seconds by default (`updateInterval: 0.5` minutes). The update interval is configured in minutes but converted to milliseconds in `start()` at MMM-Sonos.js:30.

### Rendering Logic

- Module only renders zones that are in `PLAYING` state (MMM-Sonos.js:94)
- Auto-hides entire module when no zones are playing (MMM-Sonos.js:73-75)
- Supports multi-zone grouping - displays comma-separated room names for grouped zones
- Zone exclusion via `config.exclude` array filters out specific room names
- DOM updates only occur when content actually changes (MMM-Sonos.js:67)

### Layout Adaptation

The module adapts its layout based on position:
- Left positions: Uses `.flip` class for reversed layout (MMM-Sonos.js:135)
- Other positions: Standard layout (MMM-Sonos.js:137)

### Special Track Handling

Several edge cases are handled in `renderRoom()`:
- If no artist/track/cover: displays "TV" as artist (line 79)
- Filters out `x-sonosapi-stream:` URIs (line 81-83)
- Treats "." as undefined track (line 84-86)
- When `track == uri`: clears track to avoid duplicate display (line 60-61)

## NRK Radio Integration

The module includes automatic track info fetching for Norwegian NRK Radio stations. This feature is implemented entirely server-side in node_helper.js.

### How It Works

1. **Station Detection** (node_helper.js:65): The `detectNrkStation()` method identifies NRK stations by iterating through configured stations in `nrk-stations.json` and checking if the Sonos URI starts with any of the configured `sonosUri` values

2. **API Fetching with Fallback Chain** (node_helper.js:155): The `fetchNrkTrackInfo()` method uses a three-tier fallback strategy:
   - **Primary**: Time-based matching with "Present" filter in PSAPI
     - Fetches from NRK PSAPI endpoint `https://psapi.nrk.no/channels/<stationId>/liveelements`
     - Filters segments where `relativeTimeType === "Present"`
     - Among "Present" segments, finds the one where: `currentTime >= startTime && currentTime < (startTime + duration)`
     - Parses timestamps using `parseNrkTimestamp()` (node_helper.js:30) to handle NRK's `"Date(1761513879000+0100)"` format
     - Parses ISO 8601 duration format using `parseIsoDuration()` (node_helper.js:51)
     - Returns program title, track title, artist, and album art from the matching segment
   - **Secondary**: If no PSAPI segment matches both criteria, calls `fetchNrkLivebuffer()` (node_helper.js:59)
     - Fetches from NRK livebuffer API `https://psapi.nrk.no/radio/channels/livebuffer/<channelId>`
     - Uses time-based matching to find current program
     - Returns only program title (displays as "Station Name - Program Name" with no track details)
   - **Tertiary**: If livebuffer also fails, returns null to use original Sonos data

3. **Data Enrichment** (node_helper.js:237): The `processSonosData()` method:
   - Iterates through all zones to detect NRK stations
   - **Only enriches zones with `playbackState === "PLAYING"`** - skips paused or stopped zones to avoid unnecessary API calls
   - Makes parallel API calls using Promise.all for multiple playing NRK stations
   - Merges NRK track info into the zone's currentTrack data:
     - **Artist field**: Combines station name (from Sonos) with program title (from NRK) as "Station Name - Program Name"
     - **Track field**: Combines track title and artist (from NRK) as "Track Title by Artist Name"
     - **Album art**: Uses imageUrl from NRK API

### Configuration

Station mappings are defined in `nrk-stations.json`:

```json
{
  "stations": {
    "mp3": {
      "name": "NRK mP3",
      "apiUrl": "https://psapi.nrk.no/channels/mp3/liveelements",
      "livebufferUrl": "https://psapi.nrk.no/radio/channels/livebuffer/mp3",
      "sonosUri": "x-sonosapi-hls:live%3amp3"
    }
  }
}
```

**Adding New Stations**: Edit `nrk-stations.json` to add more NRK stations. Required fields:
- `name`: Display name of the station
- `apiUrl`: NRK PSAPI endpoint for the channel's live elements (primary data source)
- `livebufferUrl`: NRK livebuffer API endpoint (fallback for program title)
- `sonosUri`: The base Sonos URI (without query parameters) used to detect this station

No code changes required when adding stations.

### NRK API Response

**PSAPI (Primary)**: Returns an array of track/segment objects. The module uses a two-step filter to find the current segment. Key fields used:
- `relativeTimeType`: First filter - must be "Present" (not "Past" or "Future")
- `startTime`: Timestamp in NRK's format `"Date(1761513879000+0100)"` - parsed to extract milliseconds
- `duration`: ISO 8601 duration format (e.g., "PT3M13S" = 3 minutes 13 seconds)
- Second filter: current time must be within `[startTime, startTime + duration)`
- `programTitle`: Program name (e.g., "Helgen er best") - combined with station name for Artist display
- `title`: Track/song title - used in Track display
- `description`: Artist name(s) - used in Track display
- `imageUrl`: Album artwork URL

**Livebuffer API (Fallback)**: Returns a channel object with program entries. The module uses time-based matching to find the current program. Key fields:
- `channel.entries`: Array of program objects
- Each entry contains:
  - `title`: Program name - combined with station name for Artist display
  - `actualStart`: ISO 8601 timestamp `"2025-10-26T21:03:00Z"` - parsed to milliseconds
  - `actualEnd`: ISO 8601 timestamp - parsed to milliseconds

**Timestamp Parsing**: NRK APIs use different timestamp formats:
- **PSAPI**: Custom format `"Date(1761513879000+0100)"` where the number before the timezone is the Unix timestamp in milliseconds
- **Livebuffer**: Standard ISO 8601 format `"2025-10-26T21:03:00Z"`

The `parseNrkTimestamp()` function (node_helper.js:34) handles both formats automatically using pattern matching and `Date.parse()` for proper time calculations.

**Fallback Strategy**:
1. Module filters PSAPI segments where `relativeTimeType === "Present"`, then among those finds one where:
   - `currentTime >= startTime`
   - `currentTime < (startTime + duration)` (duration is parsed from ISO 8601 format)
   - If match found: Returns full track info (program, track title, artist, album art)
2. If no PSAPI segment matches both criteria, fetches from livebuffer API:
   - Iterates through `channel.entries` array
   - Finds program where `currentTime >= actualStart && currentTime < actualEnd`
   - Returns only program title (no track details)
3. If livebuffer API also fails (no matching program or API errors), falls back to original Sonos data

**Debugging**: The module logs detailed information about:
- Which station is detected and from which URI
- Which API is being used (PSAPI or livebuffer)
- What data is returned from each API
- How the final display fields are constructed

### Display Format for NRK Stations

When playing NRK Radio stations:

**With PSAPI data (full track info)**:
- **Artist line**: Shows "NRK mP3 - Helgen er best" (station name + program title)
- **Track line**: Shows "Superhero by Rat City + Isak Heim" (track title + artist from description)

**With livebuffer fallback (program only)**:
- **Artist line**: Shows "NRK mP3 - [Program Name]" (station name + program title from livebuffer)
- **Track line**: No track details displayed (original Sonos data may show if available)

## Testing with Sonos API

The module expects the node-sonos-http-api to be running at `http://localhost:5005/zones` by default. To test:

1. Ensure node-sonos-http-api is installed and running
2. Verify API accessibility: `curl http://localhost:5005/zones`
3. If CORS issues occur, add headers to `sonos-http-api.js` (see README.md:149-154)

## Common Customizations

Users typically customize via `custom.css` to:
- Make album art circular with borders
- Adjust font sizes for room/artist/track
- Set fixed widths for text overflow handling
- Add padding/margins for specific layouts

See README.md lines 113-145 for common custom CSS patterns.
