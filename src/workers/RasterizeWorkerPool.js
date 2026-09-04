/**
 * @fileoverview Small bounded worker pool for rasterizeGraphWorker.js. Queues
 * jobs beyond the pool size instead of spawning unbounded workers/canvases —
 * the same concern AutoGraphGenerator.jsx's CONCURRENT_RENDER_LIMIT addresses
 * for the main-thread SVG-generation phase, applied here to the rasterization
 * phase instead.
 *
 * Constructing a pool creates real Worker threads immediately; callers should
 * create one pool and reuse it (see script_manager's BatchGraphProcessor.jsx),
 * not construct one per job, and call `terminate()` when done with it.
 *
 * @module RasterizeWorkerPool
 */
export class RasterizeWorkerPool {
    /**
     * @param {number} [size=2] - Number of worker threads to keep alive.
     */
    constructor(size = 2) {
        this._nextId = 0;
        this._pending = new Map(); // jobId -> {resolve, reject}
        this._jobOfWorker = new Map(); // Worker -> jobId currently running on it
        this._queue = []; // {id, payload, transfer}
        this._free = [];
        this._workers = [];

        for (let i = 0; i < size; i++) {
            const worker = new Worker(new URL('./rasterizeGraphWorker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (event) => this._handleMessage(worker, event.data);
            worker.onerror = (event) => this._handleWorkerError(worker, event);
            this._workers.push(worker);
            this._free.push(worker);
        }
    }

    /**
     * Enqueues a rasterize job (the payload shape rasterizeGraphJob.js
     * produces) and resolves with the resulting PNG ArrayBuffer.
     *
     * @param {object} payload
     * @param {Transferable[]} [transfer]
     * @returns {Promise<ArrayBuffer>}
     */
    run(payload, transfer = []) {
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            this._pending.set(id, { resolve, reject });
            this._queue.push({ id, payload, transfer });
            this._pump();
        });
    }

    _pump() {
        while (this._free.length > 0 && this._queue.length > 0) {
            const worker = this._free.pop();
            const job = this._queue.shift();
            this._jobOfWorker.set(worker, job.id);
            worker.postMessage({ id: job.id, ...job.payload }, job.transfer);
        }
    }

    _handleMessage(worker, data) {
        const { id, buffer, error } = data;
        this._jobOfWorker.delete(worker);
        this._free.push(worker);

        const entry = this._pending.get(id);
        this._pending.delete(id);
        if (entry) {
            if (error) entry.reject(new Error(error));
            else entry.resolve(buffer);
        }

        this._pump();
    }

    _handleWorkerError(worker, event) {
        // The worker script itself threw outside rasterizeGraphWorker.js's own
        // try/catch (a syntax/load error, or something the worker couldn't even
        // report structuredly). Reject whatever job was in flight on it, then
        // replace the worker so the pool keeps functioning at full size.
        const jobId = this._jobOfWorker.get(worker);
        this._jobOfWorker.delete(worker);

        const index = this._workers.indexOf(worker);
        if (index !== -1) this._workers.splice(index, 1);
        const freeIndex = this._free.indexOf(worker);
        if (freeIndex !== -1) this._free.splice(freeIndex, 1);
        worker.terminate();

        if (jobId !== undefined) {
            const entry = this._pending.get(jobId);
            this._pending.delete(jobId);
            if (entry) {
                entry.reject(new Error(`Rasterize worker crashed: ${event?.message || 'unknown error'}`));
            }
        }

        const replacement = new Worker(new URL('./rasterizeGraphWorker.js', import.meta.url), { type: 'module' });
        replacement.onmessage = (e) => this._handleMessage(replacement, e.data);
        replacement.onerror = (e) => this._handleWorkerError(replacement, e);
        this._workers.push(replacement);
        this._free.push(replacement);

        this._pump();
    }

    /** Terminates every worker. Any jobs still queued or in flight are left unresolved. */
    terminate() {
        for (const worker of this._workers) worker.terminate();
        this._workers = [];
        this._free = [];
        this._jobOfWorker.clear();
    }
}
