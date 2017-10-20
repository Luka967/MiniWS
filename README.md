# MiniWS Documentation

## Incompatibilies

- No integrated support TLS/SSL for both client sockets and server.
- No permessage-deflate.
- Minimum node.js version is v6.4.0 - it uses classes and rest parameters.
- `Socket.onmessage` has either a `Buffer` and a `String` as the message.
- It's built only for the RFC6455 protocol specification.

```js
const MiniWS = require("miniws");
```

## `MiniWS.Server`

The WebSocket server implementation that accepts incoming HTTP connections. Uses the `http` module internally unless specified as the option during construction.

### Echo server implementation

```js
const MiniWS = require("miniws");
const echoServer = new MiniWS.Server({
    port: 1337
});
echoServer.on("connection", function(ws) {
    ws.on("message", function(data) {
        console.log(`Server got "${data}"`);
        ws.send(data);
    });
});
echoServer.start();
```

### `new`

```js
const myServer = new MiniWS.Server({
    host: "0.0.0.0",
    port: 80,
    backlog: 511,
    httpServer: undefined,
    verifyConnection: function(remoteAddress, origin, extensions, subprotocols, request) {
        // Your magic goes here
        return true;
    },
    getSubprotocol: function(subprotocols, extensions, remoteAddress, origin, request) {
        // Your magic goes here
        return subprotocols[0] || null;
    }
});
```

- `options` (`Object`)
    - `options.host` (`String?`) The bind address for the HTTP server. Defaults to `0.0.0.0`.
    - `options.port` (`Number?`) The bind port for the HTTP server. Defaults to `80`.
    - `options.backlog` (`Number?`) The maximum count of pending connections. Defaults to `511`.
    - `options.httpServer` (`http.Server` or `https.Server`) The object to use as the HTTP server. If unspecified an internal default `http.Server` is used.
    - `options.verifyConnection` (`Function?` returning `Boolean`) If specified, it's synchronously called after checking the headers of the incoming request. If it returns `false`, the response is a 400 Bad Request, thereby saving a little in bandwidth.
        - `remoteAddress` (`String`) Remote address of the incoming connection.
        - `origin` (`String`) The origin given in the headers, if any.
        - `extensions` (`ExtensionObject`) The extensions given.
        - `subprotocols` (`String[]`) An array consisting of requested subprotocols.
        - `request` (`http.IncomingMessage`) The request itself.
    - `options.getSubProtocol` (`Function?` returning `String`) If specifed, it's called after `options.verifyConnection` in case a subprotocol was requested. Note that it has the same arguments as `options.verifyConnection` albeit in a different order.
- `callback` (`Function?`) Optional. Internally calls `.start(callback)` immediately after finishing construction.

#### The extensions object

An example `mux; max-channels=4; flow-control, deflate-stream, application-extension; version="1.1.4"` is in this form:

```js
{
    "application-extension": {
        "version": "1.1.4"
    },
    "deflate-stream": { },
    "mux": {
        "max-channels": 4,
        "flow-control": true
    }
}
```

### `.start`

```js
myServer.start(function() {
    console.log("Listening");
    // Your magic goes here
});
```

- `callback` (`Function?`) Optional. Called when the underlying HTTP server fully opens.

Starts the underlying HTTP server.

### `.stop`

- `callback` (`Function?`) Optional. Called when the underlying HTTP server fully closes.

Stops the underlying HTTP server.

### Event `connection`

Arguments:

- `newSocket` (`MiniWS.Socket`) The new upgraded connection.

Called on a successful WebSocket upgrade.

## `MiniWS.Socket`

### Local connection example with the `response` Event

```js
var connection = MiniWS.createClient("ws://127.0.0.1:80");
connection.on("response", function(response) {
    // Check for an useless header, why the heck not!
    if (response.headers["x-wantstoconnectwithsomeone"] !== "yes")
        connection.abort();
});
connection.on("open", function() {
    connection.send("I don't want to connect with you");
    connection.close(1006, "So goodbye");
});
```

### Event `response`

Available only on client-side connections.

```js
connection.on("response", function(response) {
    if (somethingChanged)
        // .abort() signals the request to be destroyed.
        connection.abort();
});
```

- `response` (`http.IncomingMessage`) The response the remote HTTP server sent.

Called immediately after the response has been received. It allows a final, synchronous check `

### Event `open`

Available only on client-side connections.

```js
connection.on("open", function() {
    console.log("I'm connected");
    // Your magic goes here
});
```

Emitted when the upgrade finishes.

### Event `error`

Available in both types of connections.

```js
connection.on("error", function(err) {
    connection.close(1001, "Plz no gib errors");
});
```

Emitted either when the upgrade gets rejected or an unavoidable protocol error gets caught. If no event handler is set the error gets thrown and will not be caught internally.

### Event `close`

Available in both types of connections.

```js
connection.on("open", function(info) {
    console.log(`I'm disconnected (code ${event.code} reason ${event.reason}`);
    // Your magic goes here
});
```

- `info` (`Object`)
    - `info.code` (`Number`) The specified close code.
    - `info.reason` (`String`) If any, the close reason.

Emitted when a FIN-ended close message is received. If the implementation isn't the one who sent the close frame first, it will immediately attempt echoing the close code after the event has been processed. Any write attempts (`.ping`, `.send` and `.close`) will throw an error.

### Event `message`

Available in both types of connections.

```js
connection.on("message", function(message) {
    // Your magic goes here
});
```

- `message` (`String` or `Buffer`) The message itself. In the case of a `Buffer`, it is not cloned.

Emitted when a FIN-ended text or binary message is received. If it's a text message, it's turned into a `String`.

### Event `ping`

Available in both types of connections.

```js
connection.on("ping", function(message) {
    console.log("I was pinged");
});
```

- `message` (`Buffer`) The payload of the message. If none, it is a zero-length `Buffer`.

Emitted when a FIN-ended ping message is received. The implementation will immediately attempt sending a pong frame after this event has been processed.

### Event `pong`

Available in both types of connections.

```js
var pingedOn = Date.now();
connection.ping();
connection.on("pong", function(message) {
    var latency = Date.now() - pingedOn;
    console.log(`My latency is ${latency}ms`);
});
```

- `message` (`Buffer`) The message sent with `.ping`, echoed. If none, it is a zero-length `Buffer`.

Emitted when a FIN-ended pong message is received.

### `.ping`

Available in both types of connections.

```js
connection.ping(Buffer.from("Extra data", "utf-8"));
```

- `data` (`Buffer?`) An optional message payload to send.

Sends a ping frame to the remote end.

### `.send`

Available in both types of connections.

```js
connection.on("open", function() {
    connection.send("Test");
});
```

- `data` (`Buffer`, a typed array, `ArrayBuffer` or `String`) The data to send.

Sends a text or binary frame to the remote end, depending on the argument type.

### `.close`

Available in both types of connections.

```js
connection.on("message", function(data) {
    if (typeof data === "string")
        connection.close(4000, "String message is not accepted");
});
```

- `code` (`Number?`) The close code. Defaults to 1000.
- `reason` (`String?`) The close reason. Defaults to an empty string.

Sends a close frame to the remote end.

This does not end the readable side of the socket, and so the `close` event will not be called immediately. The state will still be `OPEN` until the remote end echoes the close code back, however any write attempts (`.ping`, `.send` and repeating `.close`) will throw an error.

### `.abort`

Available only on client-side connections.

```js
connection.on("response", function(response) {
    if (!isValidResponse(response))
        connection.abort();
});
```

If the state is `CONNECTING`, it signals the underlying HTTP request to not create a connection and to close the connection.

### Using `MiniWS.Socket`

This class is exposed along with `MiniWS.Server`, however it has no actual functionality by itself. It's merely a wrapper for a `net.Socket`. It must be fed with a socket *after* constructing it to get it working. It can be used for wrapping sockets got by different connection handshakes. Although I do not endorse that I will give out help for using the class separately. The basics are:

```js
var explicitWebSocket = new MiniWS.Socket();
/*
    The default state for it is CLOSED.
    Both send and close operations throw errors.
    HOWEVER, if you preemptively return the object and it's client-side,
    setting _state to MiniWS.Socket.CONNECTING enables calling .abort().
    .abort() sets the state back to CLOSED so it can be checked for later
    if connecting gets cancelled.
*/
explicitWebSocket._state = MiniWS.Socket.CONNECTING;
/*
    Enable send and close operations, and with that data transmit by calling _open.
    After calling ._open(), the .abort() method will throw.
*/
explicitWebSocket._open(/* net.Socket */, /* surpress emitting onOpen */, /* first data buffer, if any */);
/*
    If necessary, set _writer_mask to true to send masked data.
    This is disabled by default too.
*/
explicitWebSocket._writer_mask = true;
/*
    If you need to close the socket without using the WebSocket protocol,
    call ._close(null, true).
*/
explicitWebSocket._close(null, true);
```

## `MiniWS.createClient`

### Connecting to the Echo server example

```js
var client = MiniWS.createClient("ws://127.0.0.1:80/");
client.on("open", function() {
    client.on("message", function(data) {
        console.log(`Client got "${data}"`);
        client.close(1000);
    })
    client.send("Test");
})
```

- `url` (`String`) The URL to connect to.
- `options` (`Object`)
    - `subprotocols` (`String[]?`) The subprotocols to request.
    - `headers` (`Object?`) Additional headers to add to the request, if any.
    - `localAddress` (`String?`) The local interface to connect from.
    - `family` (`Number?`) IP address family to use. If unspecified both will be used.
- Returns `MiniWS.Socket`

This function creates an HTTP GET request and returns a WebSocket in `CONNECTING` state. If the request gets rejected with any other status code other than `101 Switching Protocols` an error gets thrown (see [the error event](#event-error)). Otherwise it switches to `OPEN` state and the `open` event gets emitted.