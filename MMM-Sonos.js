/* Magic Mirror
 * Module: MagicMirror-Sonos-Module
 *
 * By Christopher Fenner https://github.com/CFenner
 * MIT Licensed.
 */
 Module.register('MMM-Sonos', {
	defaults: {
		showStoppedRoom: true,
		showAlbumArt: true,
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
		this.sendSocketNotification(
			'SONOS_UPDATE',
			this.config.apiBase + ":" + this.config.apiPort + "/" + this.config.apiEndpoint);
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
				var currentTrack = item.coordinator.state.currentTrack;
				var artist = currentTrack.artist;
				var track = currentTrack.title;
				var cover = currentTrack.absoluteAlbumArtUri;
				var streamInfo = currentTrack.streamInfo;
				var type = currentTrack.type;

				if(track == currentTrack.uri)
					track = '';
				text += this.renderRoom(state, artist, track, cover, room);
			}
		}.bind(this));
		this.loaded = true;
		// only update dom if content changed
		if(this.dom !== text){
			this.dom = text;
			this.updateDom(this.config.animationSpeed);
		}
	},
	renderRoom: function(state, artist, track, cover, roomName) {
		if (!artist && !track && !cover) {
			artist = "TV";
		}
		if (track && track.indexOf("x-sonosapi-stream:") == 0) {
			track = undefined;
		}
		if (track.length > 44) {
			track = track.substring(0, 40) + "&nbsp;...";
		}
		artist = artist?artist:"";
		//track = track?track:"";
		cover = cover?cover:"";
		var room = '';


		// show song if PLAYING
		if(state === 'PLAYING') {
			room += this.html.song.format(
				// show album art if 'showAlbumArt' is set
				(this.config.showAlbumArt
					?this.html.art.format(cover)
					:''
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
          Log.info('received SONOS_DATA');
					this.render(payload);
      }
  }
});
