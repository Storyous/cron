export = Task;
declare class Task {
    /**
     * @param {string} taskId
     */
    constructor(taskId: string);
    taskId: string;
    run(): void;
    /**
     * @returns {Date}
     */
    getNextTime(): Date;
    /**
     * @returns {Date}
     */
    getNextTimeAfterFail(): Date;
}
