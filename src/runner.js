'use strict';

/* eslint no-console: 0 */

const Task = require('./task');
const TaskDbModel = require('./taskDbModel');
const co = require('co');


class Runner {

    /**
     * @param {{
     *   collection: mongodb.Collection
     *   checkInterval: number
     *   runningLockTime?: number
     *   logInfo?: function
     *   logError?: function
     * }} options
     */
    constructor (options) {

        /**
         * @type {Object.<string, Task>}
         */
        this._tasks = [];

        this._intervalId = null;
        this._runningTaskPromise = null;
        this._lastProgresses = {};
        this._collection = options.collection;
        this._checkInterval = options.checkInterval;

        this._runningLockTime = 5 * 60 * 1000; // locks running task for 5 minutes
        if (typeof options.runningLockTime === 'number') {
            this._runningLockTime = options.runningLockTime;
        }
        this._minProgressWriteDelay = this._runningLockTime / 5;

        this.logInfo = options.logInfo || console.log.bind(console);
        this.logError = options.logError || console.error.bind(console);
    }

    /**
     * returns {Promise}
     */
    init () {
        return this._collection.createIndex({ priority: -1, runSince: 1, _id: 1 });
    }

    /**
     * @param {Task} task
     * @param {number} priority
     * @returns {Promise}
     */
    registerTask (task, priority) {
        if (!task.taskId) {
            throw new Error('taskId is missing in Task instance!');
        }

        this._checkTask(task);

        this._tasks[task.taskId] = task;

        return this._ensureTaskInCollection(task, priority);
    }

    /**
     * @returns {void}
     */
    startTriggeringTasks () {

        this.stopTriggeringTasks();

        this._intervalId = setInterval(this._runNext.bind(this), this._checkInterval);

        this._runNext();
    }

    stopTriggeringTasks () {
        if (this._intervalId !== null) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    /**
     * @param {Task} task
     * @param {number} priority
     * @returns {Promise}
     */
    _ensureTaskInCollection (task, priority) {
        const dbModel = this._factoryTaskDbModel(task, priority);

        return this._upsertTask(dbModel);
    }

    /**
     * @param {Task} task
     * @param priority
     */
    _factoryTaskDbModel (task, priority) {
        const dbModel = new TaskDbModel();
        dbModel._id = task.taskId;
        dbModel.priority = priority;
        dbModel.runSince = new Date();

        return dbModel;
    }

    /**
     * @param {TaskDbModel} task
     * @returns {Promise}
     */
    _upsertTask (task) {
        const query = { _id: task._id };
        const update = {
            $set: {
                priority: task.priority
            },
            $setOnInsert: {
                _id: task._id,
                runSince: task.runSince,
                lastRunAt: task.lastRunAt
            }
        };

        return this._collection.updateOne(query, update, { upsert: true });
    }

    /**
     * @returns {void}
     */
    _runNext () {
        const self = this;

        const isRunningAnother = self._runningTaskPromise !== null;
        const isTriggeringStopped = self._intervalId === null;

        if (isRunningAnother || isTriggeringStopped) {
            return;
        }

        this._runningTaskPromise = this._findNextTask()
            .then((task) => {

                if (!task) {
                    return false;
                }

                return self._runTask(task)
                    .then(function () {
                        return true;
                    });
            })
            .finally(() => {
                self._runningTaskPromise.catch(this.logError);
                self._runningTaskPromise = null;
            })
            .then((runNextImmediately) => {

                if (runNextImmediately) {
                    self._runNext();
                }
            });
    }

    /**
     * @param {TaskDbModel} dbTask
     */
    _runTask (dbTask) {
        const task = this._tasks[dbTask._id];

        if (task) {
            const self = this;
            let runPromise;

            this.logError('Starting task', { task: dbTask._id });

            let nextTimeWhenStart;
            try {
                nextTimeWhenStart = task.getNextTime();
                const progressCallback = () => {
                    this._onTaskProgress(dbTask._id);
                };
                runPromise = co.call(task, task.run, progressCallback);

            } catch (err) {
                runPromise = new Promise(function (resolve, reject) {
                    reject(err);
                });
            }

            return runPromise
                .then(() => {
                    self._finishTask(dbTask, nextTimeWhenStart);
                    this.logInfo('Task has finished', { task: dbTask._id });

                }, (err) => {
                    this.logError('Error while running task', { task: dbTask._id, err });
                    return self._onTaskFail(task)
                        .then(function () {
                            throw err;
                        });
                });
        }
    }

    _onTaskProgress (taskId) {
        const lastProgress = this._lastProgresses[taskId] || 0;
        const now = Date.now();

        if (now - lastProgress > this._minProgressWriteDelay) {
            // just some optimization - we don't need to update runSince
            // every time of 'progress' call...
            this._lastProgresses[taskId] = now;
            this._prolongTaskRunSince(taskId, this._runningLockTime).done();
        }
    }

    /**
     * @param {string} taskId
     * @param {number} byTime
     */
    _prolongTaskRunSince (taskId, byTime) {
        const query = { _id: taskId };

        const newRunSince = new Date(Date.now() + byTime);
        const update = {
            $set: { runSince: newRunSince }
        };

        return this._collection.updateOne(query, update)
            .catch(() => {});
    }

    /**
     * @param {TaskDbModel} task
     * @param {Date} nextTimeWhenStart
     */
    _finishTask (task, nextTimeWhenStart) {
        const prolongByTime = nextTimeWhenStart.getTime() - Date.now();

        if (prolongByTime > 0) {
            this._prolongTaskRunSince(task._id, prolongByTime).done();
        }
    }

    /**
     * @param {Task} task
     */
    _onTaskFail (task) {
        const prolongByTime = task.getNextTimeAfterFail().getTime() - Date.now();

        return this._prolongTaskRunSince(task.taskId, prolongByTime);
    }

    _findNextTask () {
        const now = new Date();

        const query = {
            _id: { $in: Object.keys(this._tasks) }, // choose only one of the tasks registered in this runner
            runSince: { $lte: now }
        };

        const lockTill = new Date(Date.now() + this._runningLockTime);
        const update = {
            $set: {
                runSince: lockTill,
                lastRunAt: now
            }
        };

        const sort = { priority: -1 };
        const fields = { _id: true, runSince: true, priority: true };
        const options = {
            sort,
            projection: fields
        };

        return this._collection.findOneAndUpdate(query, update, options)
            .then((res) => res.value || null);
    }

    /**
     * @param {Task} task
     */
    _checkTask (task) {
        if (!task instanceof Task) {
            throw Error('Task is not an instance of class Task!');
        }
    }
}

module.exports = Runner;