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

    getNextTime () {
        throw new Error('Implement in subclass');
    }

    getNextTimeAfterFail () {
        return this.getNextTime();
    }

}

module.exports = Task;
