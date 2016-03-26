# MagicMirror-Sonos-Module

This is an extraction of the Sonos Monitor from [MagicMirror Sonos Module](https://github.com/Vaggan/MagicMirror/tree/sonos-module/modules/sonos-module) by [Vaggan](https://github.com/Vaggan).



## Usage

_Prerequisites_

- install and run [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api)
- use the new MagicMirror module system

To use this module, copy 

### Installarion

To use this module, just create a new folder in the __modules__ folder of your MagicMirror, name it 'sonos' and copy the content of the repository into this folder. You also need to add some [config entries](#configuration) to your config.js file. After that the content will be added to your mirror.

### Configucation

To run the module properly, you need to add the following data to your config.js file.

```
{
	module: 'sonos',
	position: 'top_right', // you may choose any location
	config: {}
}
```

You also can set some options to hide different parts of the module. 
- Use `showStoppedRoom: false` to hide a room if it plays no musik.
- Use `showAlbumArt: false` to hide the album art.
- Use `showRoomName: false` to hide the room name.

```
	config: {
		showStoppedRoom: true,
		showAlbumArt: true,
		showRoomName: true
	}
```

### Known Issues

The module may not be able to access the data of the sonos API due to a Cross-Origin Resource Sharing (CORS) issue. This could be solved by adding the following lines to the `sonos-http-api.js` just before `res.write(new Buffer(jsonResponse));` in the sonos api. Remember to restart the service after the change.

```
  res.setHeader("Access-Control-Allow-Origin", "http://localhost");
	res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
```
