export = TaskDbModel;
declare class TaskDbModel {
    /**
     * @type {string}
     * @public
     */
    public _id: string;
    /**
     * @type {Date}
     */
    runSince: Date;
    /**
     * Higher is more important
     * @type {number}
     */
    priority: number;
    /**
     * @type {Date}
     */
    lastRunAt: Date;
}
