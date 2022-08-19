'use strict';

var debug = true;

var logPrefix = "[Snapmeta-Provider] : ";

var libQ = require('kew');
var fs = require('fs-extra');
var config = new (require('v-conf'))();
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;

// websocket to volumio
var io = require('socket.io-client');

// tcp sever for snapserver
var net = require('net');

// jsonrpc parser/serializer
const jrs = require('jsonrpc-serializer');


module.exports = snapmeta_provider;
function snapmeta_provider(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

snapmeta_provider.prototype.onVolumioStart = function() {
	var self = this;
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	this.serverHost = this.config.get('serverHost');
	this.serverPort = this.config.get('serverPort');
    this.baseURL = this.config.get('baseURL');

	return libQ.resolve();
}

snapmeta_provider.prototype.onStart = function() {
	var self = this;
	var defer = libQ.defer();

    this.doServerStart();

	// Once the Plugin has successfull started resolve the promise
	defer.resolve();

	return defer.promise;
};

snapmeta_provider.prototype.onStop = function() {
	var self = this;
	var defer = libQ.defer();

    this.doServerStop();

	// Once the Plugin has successfull stopped resolve the promise
	defer.resolve();

	return libQ.resolve();
};

snapmeta_provider.prototype.onRestart = function() {
	var self = this;

    this.doServerRestart();

	// Optional, use if you need it
};

snapmeta_provider.prototype.doServerStart = function() {
    var self = this;

    this.webSocket = io('http://localhost:3000');
    this.webSocket.on('connect', function() {
        if (debug) self.logger.info(logPrefix + "internal websocket connected");
    });
    this.webSocket.on('disconnect', function() {
        if (debug) self.logger.info(logPrefix + "internal websocket disconnected");
    });
    this.webSocket.connect();

    this.server = new net.Server();
    this.clients = [];
    this.server.on('connection', function(socket) {
        self.clients.push(socket);
        if (debug) self.logger.info(logPrefix + "client connected, count: " + self.clients.length);
        socket.on('close', function() {
            self.clients.splice(self.clients.indexOf(socket), 1);
            if (debug) self.logger.info(logPrefix + "client disconnected, count: " + self.clients.length);
        });
        socket.snapcastStreamplayer = new SnapcastStreamplayer(self.webSocket, socket, self.baseURL, self.logger);
    });
    this.server.on('error', (e) => {
        self.logger.error(logPrefix + "error listening on tcp://" + self.serverHost + ":" + self.serverPort + ", error is " + e.toString());
    });

    if (debug) this.logger.info(logPrefix + "setting up server on tcp://" + this.serverHost + ":" + this.serverPort);
    this.server.listen(this.serverPort, this.serverHost, () => {
        if (debug) self.logger.info(logPrefix + 'listening on tcp://' + self.server.address().address + ":" + self.server.address().port + " for snapserver");
    });
};

snapmeta_provider.prototype.doServerStop = function() {
    var self = this;

    if (this.webSocket !== undefined) {
        this.webSocket.disconnect();
    }

    for (var i in this.clients) {
        this.clients[i].destroy();
    }
    if (this.server !== undefined) {
        this.server.close( () => {
            if (debug) self.logger.info(logPrefix + "snapserver metadata provider server shut down");
        });
    }
};

snapmeta_provider.prototype.doServerRestart = function() {
    this.doServerStop();
    this.doServerStart();
};


// Configuration Methods -----------------------------------------------------------------------------


snapmeta_provider.prototype.saveNetworkSettings = function(data, avoidBroadcastUiConfig) {
    var self = this;
    var defer = libQ.defer();

    var needRestart = false;

    if (data.serverHost !== undefined) {
        if (this.serverHost != data.serverHost) {
            this.serverHost = data.serverHost;
            self.config.set('serverHost', data.serverHost);
            needRestart = true;
        }
    }
    if (data.serverPort !== undefined) {
        if (this.serverPort != data.serverPort) {
            this.serverPort = data.serverPort;
            self.config.set('serverPort', data.serverPort);
            needRestart = true;
        }
    }
    if (data.baseURL !== undefined) {
        if (this.baseURL != data.baseURL) {
            this.baseURL = data.baseURL;
            self.config.set('baseURL', data.baseURL);
        }
    }

    if (needRestart) {
        this.doServerRestart();
    }
    this.commandRouter.pushToastMessage('success', 'Snapcast Metadata Provider', 'Network configuration updated');

    return defer.promise;
};

snapmeta_provider.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            uiconf.sections[0].content[0].value = self.config.get('serverHost');
            uiconf.sections[0].content[1].value = self.config.get('serverPort');
            uiconf.sections[0].content[2].value = self.config.get('baseURL');

            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

snapmeta_provider.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}

snapmeta_provider.prototype.setUIConfig = function(data) {
	var self = this;
	//Perform your installation tasks here
};

snapmeta_provider.prototype.getConf = function(varName) {
	var self = this;
	//Perform your installation tasks here
};

snapmeta_provider.prototype.setConf = function(varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};


// Implemetation -------------------------------------------------------------------------------------


function propertyValueStore(storeProps) {
    Object.defineProperty(this, 'storeProps', { enumerable: false, value: storeProps });
    Object.defineProperty(this, 'values', { enumerable: false, value: {} });
    Object.defineProperty(this, 'isNew', { enumerable: false, value: {} });

    for (const prop in this.storeProps) {
        Object.defineProperty(this, prop, {
            enumerable: true,
            configurable: true,
            get() {
                return this.values[prop];
            },
            set(newValue) {
                if (newValue != this.values[prop]) {
                    if (typeof newValue === 'object' && newValue !== null) {
                        this.values[prop] = new propertyValueStore(newValue);
                    } else {
                        this.values[prop] = newValue;
                    }
                    this.isNew[prop] = true;
                }
            }
        });
        this[prop] = storeProps[prop];
    }
}

propertyValueStore.prototype.getNew = function() {
    var result = {};
    var resultRecurse = null;
    for (const prop in this.storeProps) {
        if (typeof this.values[prop] === 'object' && this.values[prop] !== null) {
            resultRecurse = this.values[prop].getNew();
            if (resultRecurse !== null && Object.keys(resultRecurse).length !== 0) {
                result[prop] = resultRecurse;
            }
        } else if (this.isNew[prop]) {
            result[prop] = this.values[prop];
        }
    }
    if (Object.keys(result).length !== 0) {
        return result;
    } else {
        return null;
    }
}

propertyValueStore.prototype.resetNew = function(value = false) {
    for (const prop in this.storeProps) {
        if (typeof this.values[prop] === 'object' && this.values[prop] !== null) {
            this.values[prop].resetNew(value);
        } else {
            this.isNew[prop] = value;
        }
    }
}


const playerProperties = {
    'playbackStatus': 'stopped',
    'loopStatus': 'none',
    'shuffle': false,
    'volume': 100,
    'position': 0,
    'metadata': {
        'title': '',
        'artist': '',
        'album': '',
        'artUrl': '',
        'duration': '',
        'trackId': ''
    }
};

const defaultCapabilities = {
    'canGoNext': true,
    'canGoPrevious': true,
    'canPlay': true,
    'canPause': true,
    'canSeek': true,
    'canControl': true
};

const playerInternalProperties = {
    'service': '',
    'stream': false
};


function SnapcastStreamplayer(webSocket, tcpSocket, baseURL, logger) {
	var self = this;

    this.playerProps = new propertyValueStore(playerProperties);
    this.playerCapabilities = Object.assign({}, defaultCapabilities);
    this.playerInternalProps = Object.assign({}, playerInternalProperties);

    var statusUpdateScheduled = false;

    this.webSocket = webSocket;
    this.tcpSocket = tcpSocket;
    this.baseURL = baseURL;
    this.logger = logger;

    this.webSocketListener = function(data) { self.VolRecv(data); };
    this.tcpSocketListener = function(data) { self.SnapRecv(data); };
    this.webSocket.on('pushState', this.webSocketListener);
    this.tcpSocket.on('data', this.tcpSocketListener);
    this.tcpSocket.on('close', function() {
        self.tcpSocket.off('data', self.tcpSocketListener);
        self.webSocket.off('pushState', self.webSocketListener);
    });

    this.playerProps.resetNew(true);
    this.VolSendCommand('getState');
    this.SnapSendMessage(jrs.notification('Plugin.Stream.Ready'));
}

SnapcastStreamplayer.prototype.VolSendCommand = function(cmd, param) {
	if ((null !== this.webSocket) || (undefined !== this.webSocket)) {
		if (undefined === param) {
			this.webSocket.emit(cmd);
		} else {
			this.webSocket.emit(cmd, param);
		}
		return true;
	} else return false;
};

SnapcastStreamplayer.prototype.SnapSendMessage = function(msg) {
	this.tcpSocket.write(msg + '\n');
};

SnapcastStreamplayer.prototype.VolRecv = function(data) {

    function validURL(str) {
        var pattern = new RegExp('^(https?:\\/\\/)?' +           // protocol
            '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
            '((\\d{1,3}\\.){3}\\d{1,3}))' +                      // OR ip (v4) address
            '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' +                  // port and path
            '(\\?[;&a-z\\d%_.~+=-]*)?' +                         // query string
            '(\\#[-a-z\\d_]*)?$', 'i'                            // fragment locator
        );
        return !!pattern.test(str);
    }

    function completeURL(URLstring, baseURL) {
        if (!validURL(URLstring)) {
            if ((typeof baseURL !== 'undefined') && (baseURL !== null) && ("" !== baseURL)) {
                return baseURL + URLstring;
            }
        }
        return URLstring;
    }

    var self = this;

	if (data.status === 'play') {
        this.playerProps.playbackStatus = 'playing';
        if (!this.statusUpdateScheduled) {
            this.statusUpdateScheduled = true;
            setTimeout(function() {
                self.statusUpdateScheduled = false;
                self.VolSendCommand('getState');
            }, 1000);
        }
	} else if (data.status === "pause") {
        this.playerProps.playbackStatus = 'paused';
    } else if (data.status === "stop") {
        this.playerProps.playbackStatus = 'stopped';
    }

    this.playerProps.position = (data.seek / 1000).toFixed(2);

    this.playerProps.shuffle = Boolean(data.random);

    if (this.playerInternalProps.service != 'webradio') {
        if (Boolean(data.repeatSingle)) {
            this.playerProps.loopStatus = 'track';
        } else if (Boolean(data.repeat)) {
            this.playerProps.loopStatus = 'playlist';
        } else {
            this.playerProps.loopStatus = 'none';
        }
    }

    this.playerProps.volume = data.volume;

    this.playerInternalProps.stream = data.stream;
    this.playerInternalProps.service = data.service;

    this.playerProps.metadata.duration = data.duration;
    this.playerProps.metadata.artist = data.artist;
    this.playerProps.metadata.album = data.album;
    this.playerProps.metadata.title = data.title;
    this.playerProps.metadata.trackId = data.uri;
    this.playerProps.metadata.artUrl = completeURL(data.albumart, this.baseURL);

    var returnObj = this.playerProps.getNew();
    if (null !== returnObj) {
        this.SnapSendMessage(jrs.notification('Plugin.Stream.Player.Properties', Object.assign({}, this.playerCapabilities, returnObj)));
    }
    this.playerProps.resetNew();
};

SnapcastStreamplayer.prototype.SnapRecv = function(data) {
	try {
		var result = true;
		var errMsg = 'unknown method';

		var rpcobj = jrs.deserialize(data);
		var id = rpcobj.payload.id;
		var method = rpcobj.payload.method;

		if (method === 'Plugin.Stream.Player.Control') {
			this.Control(id, rpcobj.payload.params);
		} else if (method === 'Plugin.Stream.Player.SetProperty') {
			this.SetProperty(id, rpcobj.payload.params);
		} else if (method === 'Plugin.Stream.Player.GetProperties') {
			this.GetProperties(id);
		} else {
			result = false;
		}
	} catch (e) {
		result = false;
		errMsg = e.message;
	} finally {
		if (false === result) {
			this.logger.error(logPrefix + "Error in SnapcastStreamplayer.SnapRecv(): " + errMsg);
		}
	}
};

SnapcastStreamplayer.prototype.GetProperties = function(id) {
	this.SnapSendMessage(jrs.success(id, Object.assign(this.playerCapabilities, this.playerProps)));
};

SnapcastStreamplayer.prototype.SetProperty = function(id, params) {
	try {
		var result = false;
        var returnMessage = '';
		var errMsg = 'unsupported property';

		if (params.hasOwnProperty('loopStatus')) {
			if (params.loopStatus === 'none') {
				result = this.VolSendCommand('setRepeat', { value: false, repeatSingle: false });
			} else if (params.loopStatus === 'track') {
				result = this.VolSendCommand('setRepeat', { value: true, repeatSingle: true });
			} else if (params.loopStatus === 'playlist') {
				result = this.VolSendCommand('setRepeat', { value: true, repeatSingle: false });
			} else {
                errMsg = 'unsupported loopStatus parameter';
            }
		} else if (params.hasOwnProperty('shuffle')) {
			result = this.VolSendCommand('setRandom', { value: params.shuffle });
		} else if (params.hasOwnProperty('volume')) {
			result = this.VolSendCommand('volume', params.volume);
		} else if (params.hasOwnProperty('rate')) {
			// unsupported
		}
	} catch (e) {
		result = false;
		errMsg = e.message;
	} finally {
		if (true === result) {
			returnMessage = jrs.success(id, 'ok');
		} else {
			returnMessage = jrs.error(id, new jrs.err.InvalidParamsError(errMsg));
			this.logger.error(logPrefix + "Error in SnapcastStreamplayer.SetProperty(): " + errMsg);
		}
		this.SnapSendMessage(returnMessage);
	}
};

SnapcastStreamplayer.prototype.Control = function(id, params) {
	try {
		var result = false;
        var returnMessage = '';
		var errMsg = 'unsupported control command';

		if (params.command === 'play') {
			result = this.VolSendCommand('play');
		} else if (params.command === 'pause') {
			if (this.playerProps.playbackStatus === 'playing') {
				if (this.playerInternalProps.service != 'webradio') {
					result = this.VolSendCommand('pause');
				} else {
					result = this.VolSendCommand('stop');
				}
			}
		} else if (params.command === 'playPause') {
			if (this.playerProps.playbackStatus === 'playing') {
				if (this.playerInternalProps.service != 'webradio') {
					result = this.VolSendCommand('pause');
				} else {
					result = this.VolSendCommand('stop');
				}
			} else {
				result = this.VolSendCommand('play');
			}
		} else if (params.command === 'stop') {
			result = this.VolSendCommand('stop');
		} else if (params.command === 'next') {
			result = this.VolSendCommand('next');
		} else if (params.command === 'previous') {
			result = this.VolSendCommand('prev');
		} else if (params.command === 'seek') {
            var newSeekPos = parseFloat(this.playerProps.position) + parseFloat(params.params.offset);
            if ( 0 >= newSeekPos ) { newSeekPos = 0; }
            result = this.VolSendCommand('seek', newSeekPos);
		} else if (params.command === 'setPosition') {
			result = this.VolSendCommand('seek', Number(params.params.position));
		}
	} catch (e) {
		result = false;
		errMsg = e.message;
	} finally {
		if (true === result) {
			returnMessage = jrs.success(id, 'ok');
		} else {
			returnMessage = jrs.error(id, new jrs.err.InvalidParamsError(errMsg));
			this.logger.error(logPrefix + "Error in SnapcastStreamplayer.Control(): " + errMsg);
		}
		this.SnapSendMessage(returnMessage);
	}
};

