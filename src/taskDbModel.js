'use strict';

class TaskDbModel {

    constructor () {

        /**
         * @type {string}
         * @public
         */
        this._id = null;

        /**
         * @type {Date}
         */
        this.runSince = null;

        /**
         * Higher is more important
         * @type {number}
         */
        this.priority = null;

        /**
         * @type {Date}
         */
        this.lastRunAt = null;
    }
}

module.exports = TaskDbModel;
