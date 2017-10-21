const HeaderParser = require("./HeaderParser");
const Constants = require("./Constants");
const Socket = require("./Socket");
const http = require("http");
const crypto = require("crypto");
function noop() { }

class WebSocketServer {
    constructor(options, callback) {
        this.options = options = Object.assign({
            host: "0.0.0.0",
            port: 80,
            backlog: 511,
            httpServer: null,
            verifyConnection: null,
            getSubprotocol: null
        }, options);

        this._resetEvents();

        this.httpServer = options.httpServer || http.createServer(defaultResponse);
        this.httpServer.on("upgrade", this._onUpgrade.bind(this));


        if (callback instanceof Function)
            this.start(callback);
    }

    set onconnection(fn) { this._setEvent("connection", fn); }

    _resetEvents() {
        this._onconnection = noop;
    }
    _getEvent(name) {
        if (!this.hasOwnProperty(`_on${name}`))
            throw new Error("Unknown event name");
        return this[`_on${name}`];
    }
    _setEvent(name, fn) {
        if (!this.hasOwnProperty(`_on${name}`))
            throw new Error("Unknown event name");
        this[`_on${name}`] = fn ? fn : noop;
    }
    emit(name, ...args) {
        if (!this.hasOwnProperty(`_on${name}`))
            throw new Error("Unknown event name");
        this[`_on${name}`](...args);
        if (name === "error" && this._onerror === noop)
            throw args[0];
    }
    on(name, fn) {
        this._setEvent(name, fn);
        return this;
    }
    once(name, fn) {
        if (this._getEvent(name) !== noop)
            throw new Error("Cannot register multiple events to this WebSocket");
        this._setEvent(name, function(...args) {
            this._setEvent(name, noop);
            fn(...args);
        });
        return this;
    }
    removeAllListeners(name) {
        if (name) this._setEvent(name, noop);
        else this._resetEvents();
        return this;
    }
    removeListener(name, fn) {
        if (this._getEvent(name) === fn)
            this._setEvent(name, noop);
        return this;
    }

    start(callback) {
        this.httpServer.listen(this.options.port, this.options.host, this.options.backlog, callback);
    }

    stop(callback) {
        this.httpServer.close(callback);
    }

    _onUpgrade(req, socket, head) {
        var connectionHeaderValid = req.headers["connection"] == "Upgrade";
        var secWebSocketKey = req.headers["sec-websocket-key"];
        var origin = req.headers["origin"];
        var extensions = HeaderParser.parseExtensions(req.headers["sec-websocket-extensions"]);
        var protocolVersion = parseInt(req.headers["sec-websocket-version"]);
        var subProtocols = HeaderParser.parseProtocols(req.headers["sec-websocket-protocol"]);

        if (!connectionHeaderValid)
            return failUpgdRequest(socket, null, null, false, null);
        if (secWebSocketKey == null)
            return failUpgdRequest(socket, null, null, false, null);
        if (extensions === false)
            return failUpgdRequest(socket, null, null, false, null);
        if (protocolVersion !== 13)
            return failUpgdRequest(socket, null, null, true, null);
        if (subProtocols === false)
            return failUpgdRequest(socket, null, null, false, null);

        if (this.options.verifyConnection) {
            var functionArgs = [socket.address().address, origin, extensions, subProtocols, req];
            if (!this.options.verifyConnection.apply(null, functionArgs))
                return failUpgdRequest(socket, null, null, false, null);
        }

        var acceptKey = crypto.createHash("sha1").update(secWebSocketKey + Constants.GUIDKey).digest("base64");
        var headers = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: upgrade",
            "Sec-WebSocket-Version: 13",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "Server: miniws"
        ];
        if (subProtocols.length > 0 && this.options.getSubprotocol) {
            var functionArgs = [subProtocols, extensions, socket.address().address, origin, req];
            var usingSubprotocol = this.options.getSubprotocol.apply(null, functionArgs);
            if (usingSubprotocol) headers.push(`Sec-WebSocket-Protocol: ${usingSubprotocol}`);   
        }

        socket.write(headers.join("\r\n") + "\r\n\r\n");
        var newSocket = new Socket();
        newSocket._open(socket, true, head);
        this.emit("connection", newSocket);
    }
}

function defaultResponse(req, res) {
    res.writeHead(426, "Upgrade Required", {
        "Content-Length": "18",
        "Content-Type": "text/plain",
        "Upgrade": "websocket",
        "Server": "miniws"
    });
    res.end("Upgrade required\r\n");
}
function failUpgdRequest(socket, code, reason, sendVersion, extensions) {
    var headers = [
        `HTTP/1.1 ${code || 400} ${reason || "Bad Request"}`,
        `Content-Length: 0`,
    ];
    if (sendVersion) headers.push("Sec-WebSocket-Version: 13");
    if (extensions) headers.push("Sec-WebSocket-Extensions: " + HeaderParser.stringifyExtensions(extensions));
    socket.end(headers.join("\r\n") + "\r\n\r\n");
}

module.exports = WebSocketServer;