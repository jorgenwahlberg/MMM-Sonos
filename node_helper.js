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
var winston = require('winston');

// Configure logger
var logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [MMM-Sonos] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

module.exports = NodeHelper.create({
  start: function () {
    logger.info('Sonos helper started');
    // Load NRK stations configuration
    try {
      const configPath = path.join(__dirname, 'nrk-stations.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.nrkStations = JSON.parse(configData).stations;
      logger.info('NRK stations configuration loaded');
    } catch (err) {
      logger.error('Error loading NRK stations configuration: ' + err.message);
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
      logger.debug(`No livebuffer URL configured for station ${stationId}`);
      callback(null);
      return;
    }

    const livebufferUrl = station.livebufferUrl;
    logger.info(`Fetching track info from NRK Livebuffer API for ${station.name}`);

    https.get(livebufferUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const livebufferData = JSON.parse(data);
            logger.debug(`Livebuffer response structure: ${JSON.stringify(livebufferData).substring(0, 200)}`);

            // Check if response has channel.entries array
            if (!livebufferData.channel || !livebufferData.channel.entries || !Array.isArray(livebufferData.channel.entries)) {
              logger.debug('No channel.entries array in livebuffer response');
              callback(null);
              return;
            }

            // Get current time and adjust for stream delay
            const streamDelay = station.streamDelay || 0;
            const now = Date.now() - streamDelay;
            logger.debug(`Current time: ${now} (adjusted by ${streamDelay}ms stream delay)`);
            logger.debug(`Found ${livebufferData.channel.entries.length} program entries in livebuffer`);

            // Find program where actualStart <= now < actualEnd
            let currentProgram = null;
            for (let i = 0; i < livebufferData.channel.entries.length; i++) {
              const program = livebufferData.channel.entries[i];
              const actualStart = self.parseNrkTimestamp(program.actualStart);
              const actualEnd = self.parseNrkTimestamp(program.actualEnd);

              logger.debug(`Checking program ${i}: "${program.title}"`);
              logger.debug(`  actualStart: ${program.actualStart} (${actualStart}ms), actualEnd: ${program.actualEnd} (${actualEnd}ms)`);
              logger.debug(`  Match: ${now} >= ${actualStart} && ${now} < ${actualEnd} = ${actualStart && actualEnd && now >= actualStart && now < actualEnd}`);

              if (actualStart && actualEnd && now >= actualStart && now < actualEnd) {
                currentProgram = program;
                logger.info(`Found program from Livebuffer: "${program.title}"`);
                break;
              }
            }

            if (!currentProgram) {
              logger.debug('No program found matching current time in livebuffer');
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
            logger.error('Error parsing livebuffer response: ' + err.message);
            callback(null);
          }
        } else {
          logger.error(`Livebuffer request failed with status code: ${res.statusCode}`);
          callback(null);
        }
      });
    }).on('error', (err) => {
      logger.error('Livebuffer request error: ' + err.message);
      callback(null);
    });
  },

  // Fetch current track info from NRK API
  fetchNrkTrackInfo: function(stationId, callback) {
    const self = this;
    const station = this.nrkStations[stationId];
    if (!station) {
      logger.debug(`No station configuration found for ${stationId}`);
      callback(null);
      return;
    }

    const apiUrl = station.apiUrl;
    logger.info(`Fetching track info from NRK PSAPI for ${station.name}`);

    https.get(apiUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const tracks = JSON.parse(data);
            logger.debug(`PSAPI response received with ${tracks.length} segments`);

            if (Array.isArray(tracks) && tracks.length > 0) {
              // Log all relativeTimeType values for debugging
              const relativeTypes = tracks.map((seg, idx) => `[${idx}]: "${seg.relativeTimeType}"`).join(', ');
              logger.debug(`RelativeTimeType values: ${relativeTypes}`);

              // Get current time and adjust for stream delay
              const streamDelay = station.streamDelay || 0;
              const now = Date.now() - streamDelay;
              logger.debug(`Current time: ${now} (adjusted by ${streamDelay}ms stream delay)`);

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

                  logger.debug(`Checking "Present" segment at index ${i}:`);
                  logger.debug(`  startTime: ${segment.startTime} (${startTime}ms), duration: ${segment.duration} (${durationMs}ms)`);
                  logger.debug(`  endTime: ${endTime}, Match: ${now >= startTime && now < endTime}`);

                  // Second filter: must be within time window
                  if (now >= startTime && now < endTime) {
                    currentSegment = segment;
                    matchingIndex = i;
                    logger.info(`Found track from PSAPI: "${segment.title}" by ${segment.description} (Program: "${segment.programTitle}")`);
                    break;
                  }
                }
              }

              // If no matching segment found, fall back to livebuffer API
              if (!currentSegment) {
                logger.debug('No PSAPI segment matched both "Present" and time criteria, trying livebuffer API');
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
              logger.debug('No segments in PSAPI response, trying livebuffer API');
              self.fetchNrkLivebuffer(stationId, callback);
            }
          } catch (err) {
            logger.error('Error parsing PSAPI response: ' + err.message);
            // Try livebuffer API on parse error
            self.fetchNrkLivebuffer(stationId, callback);
          }
        } else {
          logger.error(`PSAPI request failed with status code: ${res.statusCode}`);
          // Try livebuffer API on request failure
          self.fetchNrkLivebuffer(stationId, callback);
        }
      });
    }).on('error', (err) => {
      logger.error('PSAPI request error: ' + err.message);
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
          logger.debug(`Zone ${zoneIndex} playback state is "${playbackState}", skipping enrichment`);
          return;
        }

        const stationId = self.detectNrkStation(uri);

        if (stationId) {
          const stationName = self.nrkStations[stationId].name;
          logger.info(`Detected NRK station: ${stationName}`);
          logger.debug(`Station ID: ${stationId}, Zone: ${zoneIndex}, URI: ${uri}`);
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

            logger.debug(`Enriching zone ${result.zoneIndex} with NRK data:`);
            logger.debug(`  Station: "${stationName}", Program: "${result.nrkTrackInfo.programTitle}"`);
            logger.debug(`  Track: "${result.nrkTrackInfo.trackTitle}", Artist: "${result.nrkTrackInfo.trackArtist}"`);

            // Artist: "Station Name - Program Name"
            const newArtist = stationName +
              (result.nrkTrackInfo.programTitle ? ' – ' + result.nrkTrackInfo.programTitle : '');
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
              currentTrack.title = newTitle;
            }

            // Update album art if available
            if (result.nrkTrackInfo.albumArtUri) {
              logger.debug(`  Album art: ${result.nrkTrackInfo.albumArtUri}`);
              currentTrack.absoluteAlbumArtUri = result.nrkTrackInfo.albumArtUri;
            }

            logger.info(`Enriched display: "${newArtist}" / "${newTitle}"`);
          } else {
            logger.debug(`No NRK data available for zone ${result.zoneIndex}, using Sonos data`);
          }
        });

        // Send enriched data to frontend
        logger.debug('Sending enriched data to frontend');
        self.sendSocketNotification('SONOS_DATA', zonesData);
      });
    } else {
      // No NRK stations, send data as-is
      logger.debug('No NRK stations detected, sending Sonos data as-is');
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

      logger.debug(`Fetching Sonos data from ${targetUrl}`);

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
              logger.debug(`Received Sonos data for ${zonesData.length} zone(s)`);
              // Process and enrich with NRK data
              self.processSonosData(zonesData);
            } catch (err) {
              logger.error('Error parsing Sonos JSON response: ' + err.message);
            }
          } else {
            logger.error(`Sonos API request failed with status code: ${res.statusCode}`);
          }
        });
      });

      // Handle request errors.
      req.on('error', (err) => {
        logger.error('Sonos API request error: ' + err.message);
      });

      // End the request.
      req.end();
    }
  }
});