// we can only communicate with java using this queue, can't call anything directly
// the java side will poll for events in a separate thread
//
// Changed from upstream freej2me-web: the original only returned queued events
// immediately when more than one was waiting, so a single leftover event
// (typically a key release) stayed stuck until the next input arrived.
export class EventQueue {
    resolvePromise = null;
    started = false;
    queue = [];

    queueEvent(evt, skipIfExists=null) {
        if (!this.started) return;
        if (skipIfExists && this.queue.some(skipIfExists)) {
            return;
        }
        this.queue.push(evt);
        if (this.resolvePromise) {
            const resolve = this.resolvePromise;
            this.resolvePromise = null;
            resolve();
        }
    }

    async waitForEvent() {
        this.started = true;
        while (this.queue.length === 0) {
            await new Promise(r => { this.resolvePromise = r; });
        }
        return this.queue.shift();
    }
}
