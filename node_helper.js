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

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
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
              self.sendSocketNotification('SONOS_DATA', JSON.parse(data));
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