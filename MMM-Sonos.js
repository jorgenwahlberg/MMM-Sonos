/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
 Module.register('MMM-Sonos', {
	defaults: {
		showStoppedRoom: true,
		showAlbumArt: true,
		preRoomText: 'Zone: ',
		preArtistText: 'Artist: ',
		preTrackText: 'Track: ',
		preTypeText: 'Source: ',
		showRoomName: true,
		animationSpeed: 1000,
		updateInterval: 0.5, // every 0.5 minutes
		apiBase: 'http://localhost',
		apiPort: 5005,
		apiEndpoint: 'zones',
 		exclude: [],
 		showRooms: [] // if set, only these rooms will be shown
	},
	start: function() {
		Log.info('Starting module: ' + this.name);
		this.loaded = false;
		this.rooms = [];
		this.update();
		// refresh every x minutes
		setInterval(
			this.update.bind(this),
			this.config.updateInterval * 60 * 1000);
	},
	getTemplate: function() {
		return 'MMM-Sonos.njk';
	},
	getTemplateData: function() {
		return {
			loading: !this.loaded,
			flip: this.data.position.endsWith("left"),
			rooms: this.rooms
		};
	},
	update: function(){
		this.sendSocketNotification('SONOS_UPDATE',this.config.apiBase + ":" + this.config.apiPort + "/" + this.config.apiEndpoint);
	},
	shouldShowRoom: function(roomName) {
		// Check if room is excluded
		if (this.config.exclude.indexOf(roomName) !== -1) {
			return false;
		}
		// If showRooms is configured, only show rooms in that list
		if (this.config.showRooms && this.config.showRooms.length > 0) {
			return this.config.showRooms.indexOf(roomName) !== -1;
		}
		// Otherwise show all rooms (that aren't excluded)
		return true;
	},
	render: function(data){
		var rooms = [];
		var self = this;

		data.forEach(function(item) {
			var roomName = '';
			var isGroup = item.members.length > 1;
			if(isGroup){
				item.members.forEach(function(member) {
					var shouldShow = self.shouldShowRoom(member.roomName);
					roomName += shouldShow?(member.roomName + ', '):'';
				});
				roomName = roomName.replace(/, $/,"");
			}else{
				roomName = item.coordinator.roomName;
				var shouldShow = self.shouldShowRoom(roomName);
				roomName = shouldShow?roomName:'';
			}
			if(roomName !== ''){
				var state = item.coordinator.state.playbackState;
				var currentTrack = item.coordinator.state.currentTrack;
				var artist = currentTrack.artist;
				var track = currentTrack.title;
				var cover = currentTrack.absoluteAlbumArtUri;

				// Handle special cases
				if (!artist && !track && !cover) {
					artist = "TV";
				}
				if (track && track.indexOf("x-sonosapi-stream:") == 0) {
					track = undefined;
				}
				if (track === ".") {
					track = undefined;
				}
				if(track == currentTrack.uri) {
					track = '';
				}

				artist = artist?artist:"";
				cover = cover?cover:"";

				// Only add room if PLAYING
				if(state === 'PLAYING') {
					rooms.push({
						state: state,
						artist: artist,
						track: track,
						cover: cover,
						roomName: roomName,
						showAlbumArt: self.config.showAlbumArt,
						showRoomName: self.config.showRoomName,
						showStoppedRoom: self.config.showStoppedRoom
					});
				}
			}
		});

		this.loaded = true;
		this.rooms = rooms;

		// Update DOM
		this.updateDom(this.config.animationSpeed);

		// Show/hide module based on playing rooms
		if(rooms.length > 0){
			this.show();
		} else {
			this.hide(this.config.animationSpeed);
		}
	},
	getStyles: function() {
		return ['sonos.css'];
	},
	socketNotificationReceived: function(notification, payload) {
	if (notification === 'SONOS_DATA') {
		//Log.info('received SONOS_DATA');
		this.render(payload);
      }
  }
});
