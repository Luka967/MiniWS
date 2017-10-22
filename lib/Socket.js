const randomBytes = require("crypto").randomBytes;
const Constants = require("./Constants");
function noop() { }

class WebSocket {
    constructor() {
        this.socket = null;
        this._state = Constants.States.CLOSED;
        this._sentClose = false;

        this._resetEvents();

        this._reader_queuedLen = 0;
        this._reader_queued = [];
        this._reader_queuedType = 0;
        this._reader_incoming = { };
        this._reader_incomingState = 0;

        this._writer_queued = [];
        this._writer_queuedLen = 0;
        this._writer_sendQueued = false;
        this._writer_mask = false;
        this._writer_sendBind = this._writer_send.bind(this);
    }

    set onresponse(fn) { this._setEvent("response", fn); }
    set onmessage(fn) { this._setEvent("message", fn); }
    set onclose(fn) { this._setEvent("close", fn); }
    set onerror(fn) { this._setEvent("error", fn); }
    set onopen(fn) { this._setEvent("open", fn); }
    set onping(fn) { this._setEvent("ping", fn); }
    set onpong(fn) { this._setEvent("pong", fn); }

    static get CLOSED() { return Constants.States.CLOSED; }
    static get CONNECTING() { return Constants.States.CONNECTING; }
    static get OPEN() { return Constants.States.OPEN; }
    get state() { return this._state; }

    _resetEvents() {
        this._onresponse = noop;
        this._onmessage = noop;
        this._onclose = noop;
        this._onerror = noop;
        this._onopen = noop;
        this._onping = noop;
        this._onpong = noop;
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

    _open(socket, surpressOpen, head) {
        this._state = Constants.States.OPEN;
        this.socket = socket;
        this._sentClose = false;
        if (!surpressOpen) this.emit("open");
        if (head && head.length) this._reader_read(head);
        this.socket.on("data", this._reader_read.bind(this));
        this.socket.on("end", this._close.bind(this, null, true));
    }

    _close(data, finFromSocket) {
        if (finFromSocket && this.state === Constants.States.CLOSED)
            return;
        this._state = Constants.States.CLOSED;
        this.socket.removeAllListeners();
        if (finFromSocket && !this._sentClose) {
            this.emit("close", { code: 1005, reason: "(Termiated with TCP FIN and no close frame was sent)" });
            if (!this._writer_sendQueued)
                // FIN won't be sent asynchronously - send it now
                this.socket.end();
        } else {
            var code = (data.length >= 2) ? data.readUInt16BE(0, true) : 1005;
            var reason = !data.length ? "(No close code has been sent)" : (data.length >= 2) ? data.slice(2).toString("utf-8") : "";
            this.emit("close", { code: code, reason: reason });
        }
        if (!this._sentClose) {
            this._sentClose = true;
            this._writer_write(0x08, data);
        }
    }

    _reader_read(buffer) {
        var frame = this._reader_incoming;
        var offset = 0, length = buffer.length;
        while (offset < length || (this._reader_incomingState === 4 && frame.payloadIndex === frame.payloadLen)) {
            switch (this._reader_incomingState) {
                case 0: // Head byte 1
                    var byte = buffer[offset++];
                    frame.fin = !!(byte & 0x80);
                    frame.rsv1 = !!(byte & 0x40);
                    frame.rsv2 = !!(byte & 0x20);
                    frame.rsv3 = !!(byte & 0x10);
                    frame.opcode = byte -
                        frame.fin * 0x80 -
                        frame.rsv1 * 0x40 -
                        frame.rsv2 * 0x20 -
                        frame.rsv3 * 0x10;
                    this._reader_incomingState = 1;
                    break;
                case 1: // Head byte 2
                    byte = buffer[offset++];
                    if ((frame.masked = !!(byte & 0x80))) {
                        frame.mask = Buffer.allocUnsafe(4);
                        frame.maskIndex = 0;
                    }
                    var len = byte - frame.masked * 0x80;
                    if (len >= 0x7E) {
                        frame.payloadLenLen = len === 0x7F ? 8 : 2;
                        frame.payloadLenBuf = Buffer.allocUnsafe(frame.payloadLenLen);
                        frame.payloadLenIndex = 0;
                        this._reader_incomingState = 2;
                    } else {
                        frame.payloadLen = len;
                        frame.payload = Buffer.allocUnsafe(frame.payloadLen);
                        frame.payloadIndex = 0;
                        this._reader_incomingState = frame.masked ? 3 : 4;
                    }
                    break;
                case 2: // Extended payload length
                    var copied = fillFrom(buffer, frame.payloadLenBuf,
                        offset, frame.payloadLenIndex,
                        length, frame.payloadLenLen);
                    offset += copied;
                    frame.payloadLenIndex += copied;
                    if (frame.payloadLenIndex < frame.payloadLenLen) break;
                    var realLength;
                    if (frame.payloadLenLen === 8) {
                        var high = frame.payloadLenBuf.readUInt32BE(0, true);
                        var low = frame.payloadLenBuf.readUInt32BE(4, true);
                        realLength = high * 4294967296 + low;
                    } else realLength = frame.payloadLenBuf.readUInt16BE(0, true);
                    delete frame.payloadLenBuf;
                    delete frame.payloadLenIndex;
                    delete frame.payloadLenLen;
                    frame.payloadLen = realLength;
                    frame.payload = Buffer.allocUnsafe(frame.payloadLen);
                    frame.payloadIndex = 0;
                    this._reader_incomingState = frame.masked ? 3 : 4;
                    break;
                case 3: // Mask
                    copied = fillFrom(buffer, frame.mask,
                        offset, frame.maskIndex, length, 4);
                    offset += copied;
                    frame.maskIndex += copied;
                    if (frame.maskIndex < 4) break;
                    delete frame.maskIndex;
                    this._reader_incomingState = 4;
                    break;
                case 4: // Payload
                    copied = fillFrom(buffer, frame.payload,
                        offset, frame.payloadIndex, length, frame.payloadLen);
                    offset += copied;
                    frame.payloadIndex += copied;
                    if (frame.payloadIndex < frame.payloadLen) break;
                    delete frame.payloadIndex;
                    this._reader_appendFrame(frame);
                    for (var i in this._reader_incoming)
                        delete this._reader_incoming[i];
                    this._reader_incomingState = 0;
                    break;
            }
        }
    }

    _reader_appendFrame(frame) {
        if (frame.rsv1 || frame.rsv2 || frame.rsv3)
            this.emit("error", new Error("One or more reserved flags are set"));
        if (Constants.KnownOpcodes.indexOf(frame.opcode) === -1)
            this.emit("error", new Error("Unknown frame opcode"));
        if (frame.opcode === 0 && this._reader_queuedType === 0)
            this.emit("error", new Error("Got continuation frame without getting the message opcode"));
        if (frame.opcode !== 0 && this._reader_queuedType !== 0)
            this.emit("error", new Error("Got non-continuation frame whilst waiting for FIN of the pending message"));
        
        if (frame.masked) {
            var payload = frame.payload, payloadLen = frame.payloadLen, mask = frame.mask;
            for (var i = 0; i < payloadLen; i++) payload[i] ^= mask[i & 3];
        }
        
        this._reader_queued.push(frame.payload);
        this._reader_queuedLen += frame.payloadLen;
        this._reader_queuedType = frame.opcode || this._reader_queuedType;
        if (!frame.fin) return;
        var message;
        if (this._reader_queued.length === 1)
            // Avoid creating a new buffer to concat only one frame payload
            message = this._reader_queued[0];
        else message = Buffer.concat(this._reader_queued, this._reader_queuedLen);

        switch (this._reader_queuedType) {
            case 0x01: this.emit("message", message.toString("utf-8")); break;
            case 0x02: this.emit("message", message); break;
            case 0x08: this._close(message, false); break;
            case 0x09:
                this.emit("ping", message); 
                this._writer_write(0x0A, message);
                break;
            case 0x0A:
                this.emit("pong", message);
                break;
        }
        this._reader_queued.splice(0, this._reader_queued.length);
        this._reader_queuedLen = 0;
        this._reader_queuedType = 0;
    }

    _writer_write(opcode, payload) {
        var mask = this._writer_mask ? randomBytes(4) : null;
        this._writer_appendFrame(true, opcode, mask, payload);
        if (this._writer_sendQueued) return;
        process.nextTick(this._writer_sendBind);
        this._writer_sendQueued = true;
    }
    _writer_appendFrame(fin, opcode, mask, payload) {
        var payloadLen = payload.length;
        var writtenLen = (payloadLen > 65535 ? 0x7F : payloadLen > 125 ? 0x7E : payloadLen);
        // Head
        this._writer_queued.push(Buffer.from([fin * 0x80 + opcode, !!mask * 0x80 + writtenLen]));
        // Extended length
        if (writtenLen === 0x7F) {
            var ext = Buffer.allocUnsafe(8);
            ext.writeUInt32BE(Math.floor(payloadLen / 4294967296), 0, true);
            ext.writeUInt32BE(payloadLen % 4294967296, 4, true);
            this._writer_queued.push(ext);
            this._writer_queuedLen++;
        } else if (writtenLen === 0x7E) {
            var ext = Buffer.allocUnsafe(2);
            ext.writeUInt16BE(payloadLen, 0, true);
            this._writer_queued.push(ext);
            this._writer_queuedLen++;
        }
        // Mask
        if (!!mask) {
            for (var i = 0; i < payloadLen; i++)
                payload[i] ^= mask[i & 3];
            this._writer_queued.push(mask);
            this._writer_queuedLen++;
        }
        this._writer_queued.push(payload);
        this._writer_queuedLen += 2; // Head + payload
    }
    _writer_send() {
        if (this._writer_queuedLen > 0 && this.state === Constants.States.OPEN) {
            for (var i = 0; i < this._writer_queuedLen - 1; i++)
                this.socket.write(this._writer_queued[i]);
            if (this._sentClose) this.socket.end(this._writer_queued[i]);
            else this.socket.write(this._writer_queued[i]);
        }
        this._writer_queued.splice(0, this._writer_queuedLen);
        this._writer_queuedLen = 0;
        this._writer_sendQueued = false;
    }

    send(data) {
        if (this._state !== Constants.States.OPEN || this._sentClose)
            throw new Error("WebSocket is not open");
        if (typeof data === "string")
            this._writer_write(0x01, Buffer.from(data, "utf-8"));
        else this._writer_write(0x02, data instanceof Buffer ? data : Buffer.from(data));
    }

    ping(data) {
        if (this._state !== Constants.States.OPEN || this._sentClose)
            throw new Error("WebSocket is not open");
        this._writer_write(0x09, data ? Buffer.from(data) : Buffer.allocUnsafe(0));
    }

    close(code, reason) {
        if (this._state !== Constants.States.OPEN || this._sentClose)
            throw new Error("WebSocket is not open");
        var reasonBuf = Buffer.from(reason || "", "utf-8");
        var payload = Buffer.concat([Buffer.allocUnsafe(2), reasonBuf], 2 + reasonBuf.length);
        payload.writeInt16BE(code || 1000, 0, true);
        this._writer_write(0x08, payload);
        this._sentClose = true;
    }

    abort() {
        if (this._state !== Constants.States.CONNECTING)
            throw new Error("WebSocket is not connecting");
        this._state = Constants.States.CLOSED;
    }
}
module.exports = WebSocket;

function fillFrom(src, dst, srcIndex, dstIndex, srcSize, dstSize) {
    var copyLen = Math.min(srcSize - srcIndex, dstSize - dstIndex);
    src.copy(dst, dstIndex, srcIndex, srcIndex + copyLen);
    return copyLen;
}