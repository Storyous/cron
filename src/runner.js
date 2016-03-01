'use strict';

/* eslint no-console: 0 */

const Task = require('./task');
const TaskDbModel = require('./taskDbModel');
const Q = require('q');
const co = require('co');
const _ = require('lodash');


class Runner {

    /**
     * @param {{
     *   collection: Collection
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

        this.logInfo = options.logInfo || (() => {});
        this.logError = options.logError || (() => {});
    }

    /**
     * returns {Promise}
     */
    init () {
        return this._collection.createIndex({ priority: -1, runSince: 1, _id: 1 })
            .thenResolve(this._collection);
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

        const self = this;
        this._intervalId = setInterval(() => {
            self._runNext();
        }, this._checkInterval);

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
            $setOnInsert: _.omit(task, 'priority')
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

                return self._runTask(task).thenResolve(true);
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
            let procedurePromise;

            this.logError('Starting task', { task: dbTask._id });

            let nextTimeWhenStart;
            try {
                nextTimeWhenStart = task.getNextTime();
                const fnc = function () {
                    self._onTaskProgress(dbTask._id);
                };
                procedurePromise = co(function* (val) {
                    return yield task.run(fnc);
                });
            } catch (err) {
                procedurePromise = Q.reject(err);
            }

            return procedurePromise
                .then(() => {
                    self._finishTask(dbTask, nextTimeWhenStart);
                    this.logInfo('Task has finished', { task: dbTask._id });

                }, (err) => {
                    this.logError('Error while running task', { task: dbTask._id, err });
                    return self._onTaskFail(task).thenReject(err);
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
            .catch(() => {
            });
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

Runner.PROGRESS_TASK_IN_PROGRESS = 'PROGRESS_TASK_IN_PROGRESS';

module.exports = Runner;
