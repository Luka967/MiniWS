const HeaderParser = require("./lib/HeaderParser");
const Constants = require("./lib/Constants");
const Server = require("./lib/Server");
const Socket = require("./lib/Socket");
const crypto = require("crypto");
const http = require("http");
const url = require("url");

module.exports = {
    Server: Server,
    Socket: Socket,
    createClient: function createClientWebSocket(path, options) {
        options = Object.assign({
            // Request options
            subprotocols: [],
            headers: { },
            localAddress: undefined,
            family: undefined,
            httpHandshakeTimeout: 15
        }, options);
    
        var parsedPath = url.parse(path);
        if (parsedPath.protocol === "wss:")
            throw new Error("Secure WebSockets are not yet supported");
        if (parsedPath.protocol !== "ws:")
            throw new Error("Invalid path protocol");
        
        var requestOptions = {
            port: parsedPath.port || 80,
            host: parsedPath.hostname,
            path: parsedPath.href,
            headers: Object.assign({
                "Connection": "Upgrade",
                "Upgrade": "websocket",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": crypto.pseudoRandomBytes(16).toString("base64")
            }, options.headers),
            localAddress: options.localAddress,
            family: options.family
        };
        if (options.subprotocols.length > 0)
            requestOptions.headers = HeaderParser.stringifyProtocols(options.subprotocols);
        
        var request = http.get(requestOptions);
        var webSocket = new Socket();
        webSocket.state = Constants.States.CONNECTING;
        webSocket._writer_mask = true;

        if (request.httpHandshakeTimeout > 0)
            request.setTimeout(options.httpHandshakeTimeout, function() {
                request.abort();
                request.removeAllListeners("error");
                webSocket.emit("error", new Error("HTTP handshake timeout"));
                webSocket.state = Constants.States.DISCONNECTED;
            });
        
        request.on("error", function(e) {
            // Propagate error
            webSocket.emit("error", e);
        });

        request.on("response", function(res) {
            var error = Object.assign(new Error(`Unexpected response code ${res.statusCode}`), {
                response: res
            });
            request.abort();
            webSocket.emit("error", error);
            webSocket.state = Constants.States.DISCONNECTED;
        });

        request.on("upgrade", function(res, socket, head) {
            webSocket.emit("response", res);

            if (webSocket.state === Constants.States.DISCONNECTED)
                // The abort function has been called
                return request.destroy();

            var expectedAcceptKey = crypto.createHash("sha1")
                .update(requestOptions.headers["Sec-WebSocket-Key"] + Constants.GUIDKey)
                .digest("base64");
            if (res.headers["sec-websocket-accept"] != expectedAcceptKey)
                return destroyWebSocket("Given Sec-Websocket-Accept doesn't match expected result", request, webSocket);

            var subprotocol = HeaderParser.parseProtocols(res.headers["sec-websocket-protocol"]);
            if (subprotocol === false)
                return destroyWebSocket("Given Sec-Websocket-Protocol has an invalid format", request, webSocket);
            if (subprotocol[0] !== undefined && options.subprotocols.indexOf(subprotocol[0]) === -1)
                return destroyWebSocket("Given subprotocol wasn't requested", request, webSocket);
            
            webSocket._open(socket, false, head);
        });

        return webSocket;
    }
};
function destroyWebSocket(errorMessage, request, webSocket, info) {
    request.destroy();
    var error = new Error(errorMessage);
    if (info) Object.assign(error, info);
    webSocket.emit("error", error);
    webSocket.state = Constants.States.DISCONNECTED;
}