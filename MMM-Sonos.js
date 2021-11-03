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
 		exclude: []
	},
	start: function() {
		Log.info('Starting module: ' + this.name);
		this.update();
		// refresh every x minutes
		setInterval(
			this.update.bind(this),
			this.config.updateInterval * 60 * 1000);
	},
	update: function(){
		this.sendSocketNotification('SONOS_UPDATE',this.config.apiBase + ":" + this.config.apiPort + "/" + this.config.apiEndpoint);
	},
	render: function(data){
		var text = '';
		$.each(data, function (i, item) {
			var room = '';
			var isGroup = item.members.length > 1;
			if(isGroup){
				$.each(item.members, function (j, member) {
					var isExcluded = this.config.exclude.indexOf(member.roomName) !== -1;
					room += isExcluded?'':(member.roomName + ', ');
				}.bind(this));
				room = room.replace(/, $/,"");
			}else{
				room = item.coordinator.roomName;
				var isExcluded = this.config.exclude.indexOf(room) !== -1;
				room = isExcluded?'':room;
			}
			if(room !== ''){
				var state = item.coordinator.state.playbackState;
<<<<<<< HEAD:MMM-Sonos.js
				var currentTrack = item.coordinator.state.currentTrack;
				var artist = currentTrack.artist;
				var track = currentTrack.title;
				var cover = currentTrack.absoluteAlbumArtUri;
				var streamInfo = currentTrack.streamInfo;
				var type = currentTrack.type;

				if(track == currentTrack.uri)
					track = '';
				text += this.renderRoom(state, artist, track, cover, room);
=======
				var artist = item.coordinator.state.currentTrack.artist;
				var track = item.coordinator.state.currentTrack.title;
				var cover = item.coordinator.state.currentTrack.absoluteAlbumArtUri;
//				var streamInfo = item.coordinator.state.currentTrack.streamInfo;
				var type = item.coordinator.state.currentTrack.type;
				var preroom = this.config.preRoomText;
				var preartist = this.config.preArtistText;
				var pretrack = this.config.preTrackText;
				var pretype = this.config.preTypeText;
				var prestream = this.config.preStreamText;
				text += this.renderRoom(state, pretype, type, preroom, room, preartist, artist, pretrack, track, cover);
>>>>>>> 211d706417dc89305e370b743a62290bb2e9d117:sonos.js
			}
		}.bind(this));
		this.loaded = true;
		// only update dom if content changed
		if(this.dom !== text){
			this.show();
			this.dom = text;
			this.updateDom(this.config.animationSpeed);
		}
		// Hide module if not playing.
		if(text == ''){
			this.hide(this.config.animationSpeed);
		}
	},
<<<<<<< HEAD:MMM-Sonos.js
	renderRoom: function(state, artist, track, cover, roomName) {
		if (!artist && !track && !cover) {
			artist = "TV";
		}
		if (track && track.indexOf("x-sonosapi-stream:") == 0) {
			track = undefined;
		}
		if (track && track.length > 44) {
			track = track.substring(0, 40) + "&nbsp;...";
		}
		if (track === (".")) {
			track = undefined;
		}
=======
	renderRoom: function(state, pretype, type, preroom, roomName, preartist, artist, pretrack, track, cover) {
>>>>>>> 211d706417dc89305e370b743a62290bb2e9d117:sonos.js
		artist = artist?artist:"";
		//track = track?track:"";
		cover = cover?cover:"";
		var room = '';
<<<<<<< HEAD:MMM-Sonos.js


		// show song if PLAYING
		if(state === 'PLAYING') {
			room += this.html.song.format(
=======
		// show room name if 'showRoomName' is set and PLAYING or 'showStoppedRoom' is set
		if(this.config.showRoomName && (state === 'PLAYING' || this.config.showStoppedRoom)) {
			room += this.html.room.format(preroom, roomName);
		}	
		// if Sonos Playbar is in TV mode, no title is provided and therefore the room should not be displayed
		var isEmpty = (artist && artist.trim().length) == 0
			&& (track && track.trim().length) == 0
			&& (cover && cover.trim().length) == 0;
		// show song if PLAYING
		if(state === 'PLAYING' && !isEmpty) {
			room += this.html.type.format(pretype, type.charAt(0).toUpperCase() + type.slice(1));
			room += this.html.song.format(
				this.html.name.format(preartist, artist, pretrack, track)+
>>>>>>> 211d706417dc89305e370b743a62290bb2e9d117:sonos.js
				// show album art if 'showAlbumArt' is set
				(this.config.showAlbumArt
					?this.html.art.format(cover)
					:''
<<<<<<< HEAD:MMM-Sonos.js
				)+				
				this.html.artistBlock.format(
					(track ? this.html.artistAndTrack.format(artist, track) : this.html.artist.format(artist, track))
					
				+ (this.config.showRoomName && (state === 'PLAYING' || this.config.showStoppedRoom) ? this.html.room.format(roomName) : ""
				//+"<span>"+streamInfo+"</span>"
				))
			);
		}
		return  this.html.roomWrapper.format(room);
	},
	html: {
		loading: '<div class="dimmed light small">Loading music ...</div>',
		roomWrapper: '<li>{0}</li>',
		room: '<div class="room xsmall">{0}</div>',
		song: '<div>{0}</div>',
		artistBlock: '<div class="name normal medium">{0}</div>',
		artist: '<div>{0}</div>',
		artistAndTrack: '<div>{0}</div><div>{1}</div>',
		art: '<div class="art"><img src="{0}"/></div>'
=======
				)
			);
		}
		return this.html.roomWrapper.format(room);
	},
	html: {
		loading: '<div class="dimmed light small">Loading music ...</div>',
		roomWrapper: '{0}',
		room: '<div class="room xsmall">{0}{1}</div>',
		song: '<div class="song">{0}</div>',
		type: '<div class="type normal small">{0}{1}</div>',
		name: '<div class="name normal small"><div>{0}{1}</div><div>{2}{3}</div></div>',
		art: '<div class="art"><img src="{0}"/></div>',
	},
	capitalize: function() {
		return this.charAt(0).toUpperCase() + this.slice(1);
>>>>>>> 211d706417dc89305e370b743a62290bb2e9d117:sonos.js
	},
	getScripts: function() {
		return [
			'String.format.js',
			'//cdnjs.cloudflare.com/ajax/libs/jquery/2.2.2/jquery.js'
		];
	},
	getStyles: function() {
		return ['sonos.css'];
	},
	getDom: function() {
		var content = '';
		if (!this.loaded) {
			content = this.html.loading;
		}else if(this.data.position.endsWith("left")){
			content = '<ul class="flip">'+this.dom+'</ul>';
		}else{
			content = '<ul>'+this.dom+'</ul>';
		}
		return $('<div class="sonos">'+content+'</div>')[0];
	},
	socketNotificationReceived: function(notification, payload) {
	if (notification === 'SONOS_DATA') {
		//Log.info('received SONOS_DATA');
		this.render(payload);
      }
  }
});
