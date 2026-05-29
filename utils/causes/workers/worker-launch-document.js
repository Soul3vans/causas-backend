"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkerDocument = runWorkerDocument;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
function runWorkerDocument(documents, issue, mode) {
    return new Promise((resolve, reject) => {
        const worker = new node_worker_threads_1.Worker(node_path_1.default.resolve(__dirname, "./worker.js"));
        console.log("Init worker...");
        worker.postMessage({ documents, issue, mode });
        worker.on("message", (message) => {
            if (message.status === "success") {
                resolve();
            }
            else {
                reject(new Error(message.error));
            }
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
            if (code !== 0) {
                reject(new Error(`Worker exited with code ${code}`));
            }
        });
    });
}
