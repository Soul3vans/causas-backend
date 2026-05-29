"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventService = void 0;
const events_1 = require("events");
class EventService extends events_1.EventEmitter {
    constructor() {
        super();
    }
}
exports.EventService = EventService;
