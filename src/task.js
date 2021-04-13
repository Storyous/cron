'use strict';

class Task {

    /**
     * @param {string} taskId
     */
    constructor (taskId) {
        this.taskId = taskId;
    }

    *run () {
        throw new Error('Implement in subclass');
    }

    /**
     * @returns {Date}
     */
    getNextTime () {
        throw new Error('Implement in subclass');
    }

    /**
     * @returns {Date}
     */
    getNextTimeAfterFail () {
        return this.getNextTime();
    }

}

module.exports = Task;
