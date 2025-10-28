/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
var NodeHelper = require('node_helper');
var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
    // Load NRK stations configuration
    try {
      const configPath = path.join(__dirname, 'nrk-stations.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.nrkStations = JSON.parse(configData).stations;
      console.log('NRK stations configuration loaded');
    } catch (err) {
      console.error('Error loading NRK stations configuration:', err);
      this.nrkStations = {};
    }
  },

  // Parse NRK timestamp format
  // Handles two formats:
  // 1. PSAPI: "Date(1761513879000+0100)" -> 1761513879000
  // 2. Livebuffer: "2025-10-26T21:03:00Z" -> milliseconds since epoch
  parseNrkTimestamp: function(timestamp) {
    if (!timestamp) return 0;

    // If already a number, return it
    if (typeof timestamp === 'number') return timestamp;

    if (typeof timestamp === 'string') {
      // Try format: "Date(1761513879000+0100)"
      const dateMatch = timestamp.match(/Date\((\d+)[+-]\d+\)/);
      if (dateMatch) {
        return parseInt(dateMatch[1], 10);
      }

      // Try ISO 8601 format: "2025-10-26T21:03:00Z"
      const isoDate = Date.parse(timestamp);
      if (!isNaN(isoDate)) {
        return isoDate;
      }

      // Try parsing as plain number string
      const num = parseInt(timestamp, 10);
      if (!isNaN(num)) return num;
    }

    return 0;
  },

  // Parse ISO 8601 duration (e.g., "PT3M13S" -> milliseconds)
  parseIsoDuration: function(duration) {
    if (!duration) return 0;

    const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!matches) return 0;

    const hours = parseInt(matches[1] || 0, 10);
    const minutes = parseInt(matches[2] || 0, 10);
    const seconds = parseFloat(matches[3] || 0);

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  },

  // Detect NRK station from Sonos URI
  detectNrkStation: function(uri) {
    if (!uri || typeof uri !== 'string' || !this.nrkStations) return null;

    // Iterate through configured stations and match against their Sonos URIs
    for (const stationId in this.nrkStations) {
      const station = this.nrkStations[stationId];
      if (station.sonosUri && uri.startsWith(station.sonosUri)) {
        return stationId;
      }
    }
    return null;
  },

  // Fetch program info from NRK livebuffer API (fallback)
  fetchNrkLivebuffer: function(stationId, callback) {
    const self = this;
    const station = this.nrkStations[stationId];
    if (!station || !station.livebufferUrl) {
      console.log(`NRK Livebuffer: No livebuffer URL configured for station ${stationId}`);
      callback(null);
      return;
    }

    const livebufferUrl = station.livebufferUrl;
    console.log(`NRK Livebuffer: Fetching from ${livebufferUrl}`);

    https.get(livebufferUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const livebufferData = JSON.parse(data);
            console.log(`NRK Livebuffer: Response received, data structure:`, JSON.stringify(livebufferData).substring(0, 200));

            // Check if response has channel.entries array
            if (!livebufferData.channel || !livebufferData.channel.entries || !Array.isArray(livebufferData.channel.entries)) {
              console.log('NRK Livebuffer: No channel.entries array in response');
              callback(null);
              return;
            }

            // Get current time
            const now = Date.now();
            console.log(`NRK Livebuffer: Current time: ${now}, looking for matching program`);
            console.log(`NRK Livebuffer: Found ${livebufferData.channel.entries.length} program entries`);

            // Find program where actualStart <= now < actualEnd
            let currentProgram = null;
            for (let i = 0; i < livebufferData.channel.entries.length; i++) {
              const program = livebufferData.channel.entries[i];
              const actualStart = self.parseNrkTimestamp(program.actualStart);
              const actualEnd = self.parseNrkTimestamp(program.actualEnd);

              console.log(`NRK Livebuffer: Checking program ${i}: "${program.title}"`);
              console.log(`  - actualStart (raw): ${program.actualStart}, (parsed): ${actualStart}`);
              console.log(`  - actualEnd (raw): ${program.actualEnd}, (parsed): ${actualEnd}`);
              console.log(`  - Match check: ${now} >= ${actualStart} && ${now} < ${actualEnd} = ${actualStart && actualEnd && now >= actualStart && now < actualEnd}`);

              if (actualStart && actualEnd && now >= actualStart && now < actualEnd) {
                currentProgram = program;
                console.log(`NRK Livebuffer: ✓ Found matching program: ${program.title}`);
                break;
              }
            }

            if (!currentProgram) {
              console.log('NRK Livebuffer: No program found matching current time');
              callback(null);
              return;
            }

            // Return only program title, no track details
            callback({
              programTitle: currentProgram.title || '',
              trackTitle: '',
              trackArtist: '',
              albumArtUri: ''
            });
          } catch (err) {
            console.error('NRK Livebuffer: Error parsing response:', err);
            callback(null);
          }
        } else {
          console.error(`NRK Livebuffer: Request failed. Status code: ${res.statusCode}`);
          callback(null);
        }
      });
    }).on('error', (err) => {
      console.error('NRK Livebuffer: Request error:', err);
      callback(null);
    });
  },

  // Fetch current track info from NRK API
  fetchNrkTrackInfo: function(stationId, callback) {
    const self = this;
    const station = this.nrkStations[stationId];
    if (!station) {
      console.log(`NRK PSAPI: No station configuration found for ${stationId}`);
      callback(null);
      return;
    }

    const apiUrl = station.apiUrl;
    console.log(`NRK PSAPI: Fetching from ${apiUrl}`);

    https.get(apiUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const tracks = JSON.parse(data);
            console.log(`NRK PSAPI: Response received with ${tracks.length} segments`);

            if (Array.isArray(tracks) && tracks.length > 0) {
              // Log all relativeTimeType values for debugging
              console.log('NRK PSAPI: Checking all relativeTimeType values:');
              const relativeTypes = tracks.map((seg, idx) => `[${idx}]: "${seg.relativeTimeType}"`).join(', ');
              console.log(`NRK PSAPI: ${relativeTypes}`);

              // Get current time
              const now = Date.now();
              console.log(`NRK PSAPI: Current time: ${now}`);

              // Find segment where relativeTimeType is "Present" AND time matches
              let currentSegment = null;
              let matchingIndex = -1;

              for (let i = 0; i < tracks.length; i++) {
                const segment = tracks[i];

                // First filter: must have relativeTimeType === "Present"
                if (segment.relativeTimeType === 'Present') {
                  const startTime = self.parseNrkTimestamp(segment.startTime);
                  const durationMs = self.parseIsoDuration(segment.duration);
                  const endTime = startTime + durationMs;

                  console.log(`NRK PSAPI: Checking "Present" segment at index ${i}:`);
                  console.log(`  - startTime (raw): ${segment.startTime}, (parsed): ${startTime}`);
                  console.log(`  - duration: ${segment.duration} (${durationMs}ms)`);
                  console.log(`  - endTime (calculated): ${endTime}`);
                  console.log(`  - Match check: ${now} >= ${startTime} && ${now} < ${endTime} = ${now >= startTime && now < endTime}`);

                  // Second filter: must be within time window
                  if (now >= startTime && now < endTime) {
                    currentSegment = segment;
                    matchingIndex = i;
                    console.log(`NRK PSAPI: ✓ Found matching segment at index ${i} - Program: "${segment.programTitle}", Track: "${segment.title}", Artist: "${segment.description}"`);
                    break;
                  }
                }
              }

              // If no matching segment found, fall back to livebuffer API
              if (!currentSegment) {
                console.log(`NRK PSAPI: No segment matched both "Present" and time criteria, trying livebuffer API`);
                self.fetchNrkLivebuffer(stationId, callback);
                return;
              }

              // Return the segment's data
              callback({
                programTitle: currentSegment.programTitle || '',
                trackTitle: currentSegment.title || '',
                trackArtist: currentSegment.description || '',
                albumArtUri: currentSegment.imageUrl || ''
              });
            } else {
              // No tracks in response, try livebuffer API
              console.log('NRK PSAPI: No segments in response, trying livebuffer API');
              self.fetchNrkLivebuffer(stationId, callback);
            }
          } catch (err) {
            console.error('NRK PSAPI: Error parsing response:', err);
            // Try livebuffer API on parse error
            self.fetchNrkLivebuffer(stationId, callback);
          }
        } else {
          console.error(`NRK PSAPI: Request failed. Status code: ${res.statusCode}`);
          // Try livebuffer API on request failure
          self.fetchNrkLivebuffer(stationId, callback);
        }
      });
    }).on('error', (err) => {
      console.error('NRK PSAPI: Request error:', err);
      // Try livebuffer API on request error
      self.fetchNrkLivebuffer(stationId, callback);
    });
  },

  // Process Sonos data and enrich with NRK track info
  processSonosData: function(zonesData) {
    const self = this;

    // Collect promises for all NRK stations
    const nrkPromises = [];
    const nrkZoneIndices = [];

    zonesData.forEach((zone, zoneIndex) => {
      if (zone.coordinator && zone.coordinator.state && zone.coordinator.state.currentTrack) {
        const playbackState = zone.coordinator.state.playbackState;
        const uri = zone.coordinator.state.currentTrack.uri;

        // Only enrich data for zones that are actually playing
        if (playbackState !== 'PLAYING') {
          console.log(`NRK Detection: Zone ${zoneIndex} playback state is "${playbackState}", skipping enrichment`);
          return;
        }

        const stationId = self.detectNrkStation(uri);

        if (stationId) {
          console.log(`NRK Detection: Detected NRK station "${stationId}" in zone ${zoneIndex} (URI: ${uri}, playbackState: ${playbackState})`);
          // Create a promise for fetching NRK track info
          const promise = new Promise((resolve) => {
            self.fetchNrkTrackInfo(stationId, (nrkTrackInfo) => {
              resolve({ zoneIndex, nrkTrackInfo });
            });
          });
          nrkPromises.push(promise);
          nrkZoneIndices.push(zoneIndex);
        }
      }
    });

    // Wait for all NRK API calls to complete
    if (nrkPromises.length > 0) {
      Promise.all(nrkPromises).then((results) => {
        // Merge NRK track info into zones data
        results.forEach((result) => {
          if (result.nrkTrackInfo) {
            const zone = zonesData[result.zoneIndex];
            const currentTrack = zone.coordinator.state.currentTrack;

            // Get station name from Sonos data
            const stationName = currentTrack.stationName || currentTrack.title || '';

            console.log(`NRK Data Enrichment: Applying NRK data to zone`);
            console.log(`  - Station Name (from Sonos): "${stationName}"`);
            console.log(`  - Program Title (from NRK): "${result.nrkTrackInfo.programTitle}"`);
            console.log(`  - Track Title (from NRK): "${result.nrkTrackInfo.trackTitle}"`);
            console.log(`  - Track Artist (from NRK): "${result.nrkTrackInfo.trackArtist}"`);

            // Artist: "Station Name - Program Name"
            const newArtist = stationName +
              (result.nrkTrackInfo.programTitle ? ' – ' + result.nrkTrackInfo.programTitle : '');
            console.log(`  - Final Artist field: "${newArtist}"`);
            currentTrack.artist = newArtist;

            // Track: "Track Title by Track Artist"
            let newTitle = '';
            if (result.nrkTrackInfo.trackTitle && result.nrkTrackInfo.trackArtist) {
              newTitle = result.nrkTrackInfo.trackTitle + ' – ' + result.nrkTrackInfo.trackArtist;
            } else if (result.nrkTrackInfo.trackTitle) {
              newTitle = result.nrkTrackInfo.trackTitle;
            } else if (result.nrkTrackInfo.trackArtist) {
              newTitle = result.nrkTrackInfo.trackArtist;
            }

            if (newTitle) {
              console.log(`  - Final Track field: "${newTitle}"`);
              currentTrack.title = newTitle;
            } else {
              console.log(`  - No track info from NRK, keeping Sonos title: "${currentTrack.title}"`);
            }

            // Update album art if available
            if (result.nrkTrackInfo.albumArtUri) {
              console.log(`  - Album art: ${result.nrkTrackInfo.albumArtUri}`);
              currentTrack.absoluteAlbumArtUri = result.nrkTrackInfo.albumArtUri;
            }
          } else {
            console.log(`NRK Data Enrichment: No NRK data available for zone ${result.zoneIndex}, using Sonos data`);
          }
        });

        // Send enriched data to frontend
        console.log('NRK Data Enrichment: Sending enriched data to frontend');
        self.sendSocketNotification('SONOS_DATA', zonesData);
      });
    } else {
      // No NRK stations, send data as-is
      console.log('NRK Data Enrichment: No NRK stations detected, sending Sonos data as-is');
      self.sendSocketNotification('SONOS_DATA', zonesData);
    }
  },

  // Subclass socketNotificationReceived.
  socketNotificationReceived: function(notification, targetUrl) {
    if (notification === 'SONOS_UPDATE') {
      const self = this;

      // Parse the URL to determine the protocol.
      const parsedUrl = new url.URL(targetUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      // Make the HTTP or HTTPS request.
      const req = protocol.get(targetUrl, (res) => {
        let data = '';

        // Accumulate data chunks.
        res.on('data', (chunk) => {
          data += chunk;
        });

        // Handle response end.
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const zonesData = JSON.parse(data);
              // Process and enrich with NRK data
              self.processSonosData(zonesData);
            } catch (err) {
              console.error('Error parsing JSON:', err);
            }
          } else {
            console.error(`Request failed. Status code: ${res.statusCode}`);
          }
        });
      });

      // Handle request errors.
      req.on('error', (err) => {
        console.error('Request error:', err);
      });

      // End the request.
      req.end();
    }
  }
});