"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wait = wait;
exports.waitForFunction = waitForFunction;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFunction(page, predicate, timeout = 30000, interval = 500) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        try {
            const result = await page.evaluate(predicate);
            if (result) {
                return true;
            }
        } catch (e) {
            // Ignorar errores
        }
        await wait(interval);
    }
    
    throw new Error(`waitForFunction timeout after ${timeout}ms`);
}