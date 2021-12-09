export = Runner;
declare class Runner {
    /**
     * @param {{
     *   collection: mongodb.Collection
     *   checkInterval: number
     *   runningLockTime?: number
     *   logInfo?: function
     *   logError?: function
     *   newTasksDelay?: number
     * }} options
     */
    constructor(options: {
        collection: mongodb.Collection;
        checkInterval: number;
        runningLockTime?: number;
        logInfo?: Function;
        logError?: Function;
        newTasksDelay?: number;
    });
    /**
     * @type {Map.<string, Task>}
     */
    _tasks: Map<string, Task>;
    _intervalId: NodeJS.Timer;
    _runningTaskPromise: any;
    _lastProgresses: {};
    _collection: mongodb.Collection;
    _checkInterval: number;
    _runningLockTime: number;
    _minProgressWriteDelay: number;
    _logInfo: Function;
    _logError: Function;
    _newTasksDelay: number;
    /**
     * returns {Promise}
     */
    init(): any;
    /**
     * @param {Task} task
     * @param {number} priority
     * @returns {Promise}
     */
    registerTask(task: Task, priority: number): Promise<any>;
    /**
     * @returns {Task[]}
     */
    getTasks(): Task[];
    /**
     * @returns {void}
     */
    startTriggeringTasks(): void;
    stopTriggeringTasks(): any;
    /**
     * @param {Task} task
     * @param {number} priority
     * @returns {Promise}
     */
    _ensureTaskInCollection(task: Task, priority: number): Promise<any>;
    /**
     * @param {Task} task
     * @param priority
     */
    _factoryTaskDbModel(task: Task, priority: any): TaskDbModel;
    /**
     * @param {TaskDbModel} task
     * @returns {Promise}
     */
    _upsertTask(task: TaskDbModel): Promise<any>;
    /**
     * @returns {void}
     */
    _runNext(): void;
    /**
     * @param {TaskDbModel} dbTask
     */
    _runTask(dbTask: TaskDbModel): any;
    _onTaskProgress(taskId: any): void;
    /**
     * @param {string} taskId
     * @param {number} byTime
     */
    _prolongTaskRunSince(taskId: string, byTime: number): any;
    /**
     * @param {TaskDbModel} task
     * @param {Date} nextTimeWhenStart
     */
    _finishTask(task: TaskDbModel, nextTimeWhenStart: Date): void;
    /**
     * @param {Task} task
     */
    _onTaskFail(task: Task): any;
    _findNextTask(): any;
    /**
     * @param {Task} task
     */
    _checkTask(task: Task): void;
}
declare namespace Runner {
    export { INFO_STARTING_TASK as INFO_TASK_STARTED };
    export { INFO_TASK_FINISHED };
}
import Task = require("cronious/src/task");
import TaskDbModel = require("cronious/src/taskDbModel");
declare const INFO_STARTING_TASK: "INFO_STARTING_TASK";
declare const INFO_TASK_FINISHED: "INFO_TASK_FINISHED";
