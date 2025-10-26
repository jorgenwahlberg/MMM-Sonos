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

  // Fetch current track info from NRK API
  fetchNrkTrackInfo: function(stationId, callback) {
    const station = this.nrkStations[stationId];
    if (!station) {
      callback(null);
      return;
    }

    const apiUrl = station.apiUrl;

    https.get(apiUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const tracks = JSON.parse(data);
            if (Array.isArray(tracks) && tracks.length > 0) {
              // Find the segment where relativeTimeType is "Present"
              let currentSegment = null;
              for (let i = 0; i < tracks.length; i++) {
                const segment = tracks[i];
                if (segment.relativeTimeType === 'Present') {
                  currentSegment = segment;
                  break;
                }
              }

              // If no matching segment found, return null (use Sonos data)
              if (!currentSegment) {
                console.log('NRK: No segment with relativeTimeType "Present" found');
                callback(null);
                return;
              }

              // Return the matching segment's data
              callback({
                programTitle: currentSegment.programTitle || '',
                trackTitle: currentSegment.title || '',
                trackArtist: currentSegment.description || '',
                albumArtUri: currentSegment.imageUrl || ''
              });
            } else {
              callback(null);
            }
          } catch (err) {
            console.error('Error parsing NRK API response:', err);
            callback(null);
          }
        } else {
          console.error(`NRK API request failed. Status code: ${res.statusCode}`);
          callback(null);
        }
      });
    }).on('error', (err) => {
      console.error('NRK API request error:', err);
      callback(null);
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
        const uri = zone.coordinator.state.currentTrack.uri;
        const stationId = self.detectNrkStation(uri);

        if (stationId) {
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

            // Artist: "Station Name - Program Name"
            currentTrack.artist = stationName +
              (result.nrkTrackInfo.programTitle ? ' - ' + result.nrkTrackInfo.programTitle : '');

            // Track: "Track Title by Track Artist"
            if (result.nrkTrackInfo.trackTitle && result.nrkTrackInfo.trackArtist) {
              currentTrack.title = result.nrkTrackInfo.trackTitle + ' by ' + result.nrkTrackInfo.trackArtist;
            } else if (result.nrkTrackInfo.trackTitle) {
              currentTrack.title = result.nrkTrackInfo.trackTitle;
            } else if (result.nrkTrackInfo.trackArtist) {
              currentTrack.title = result.nrkTrackInfo.trackArtist;
            }

            // Update album art if available
            if (result.nrkTrackInfo.albumArtUri) {
              currentTrack.absoluteAlbumArtUri = result.nrkTrackInfo.albumArtUri;
            }
          }
        });

        // Send enriched data to frontend
        self.sendSocketNotification('SONOS_DATA', zonesData);
      });
    } else {
      // No NRK stations, send data as-is
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