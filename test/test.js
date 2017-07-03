'use strict';

const mocha = require('mocha');
const describe = mocha.describe;
const it = mocha.it;
const afterEach = require('mocha').afterEach;
const beforeEach = require('mocha').beforeEach;
const assert = require('assert');
const sinon = require('sinon');
const Runner = require('../src/index').Runner;
const MongoClient = require('mongodb').MongoClient;
const Q = require('q');

let uniquenessCounter = 0;
const getMockTask = function (nextTimeDelay) {
    var task = {
        taskId: `testTask_${uniquenessCounter++}_${Date.now()}`,
        getNextTime: sinon.spy(() => {
                return new Date(Date.now() + (nextTimeDelay || 1500));
            }
        ),
        getNextTimeAfterFail: sinon.spy(() => {
            return new Date(Date.now() + 60)
        }),
        run: sinon.spy(function () {
            const call = {start: Date.now()};
            this.calls.push(call);
            return Q.delay(300).then(() => {
                call.end = Date.now();
                return 1;
            });
        }),
        calls: []
    };
    return task;
};


describe('Runner', function () {

    this.timeout(3600);

    let collection;
    beforeEach((done) => {
        MongoClient.connect('mongodb://127.0.0.1:27017/cronTest', {promiseLibrary: Q.Promise})
            .then((db) => {
                collection = db.collection('testTasks');
            })
            .nodeify(done);
    });

    function getRunner(runningLockTime) {
        const options = {
            collection,
            checkInterval: 50,
            runningLockTime: (runningLockTime || 100)
        };
        return new Runner(options);
    }

    let runner;
    beforeEach(() => {
        runner = getRunner();
        runner.init();
    });

    afterEach((done) => {
        runner.stopTriggeringTasks();
        done();
    });


    it('should work with no registered task', (done) => {
        runner.startTriggeringTasks();
        setTimeout(done, 500);
    });

    it('should trigger registered task', () => {
        const task = getMockTask();
        return runner.registerTask(task, 1)
            .delay(1500)
            .then(() => {
                runner.startTriggeringTasks();
            })
            .delay(60)
            .then(() => {
                assert.equal(task.run.callCount, 1);
            });
    });

    it('should get run tasks in sequence one by one ordered by priority', () => {

        const task1 = getMockTask();
        const task2 = getMockTask();
        const task3 = getMockTask();

        return Q.all([
                runner.registerTask(task1, 2),
                runner.registerTask(task2, 3),
                runner.registerTask(task3, 1)
            ])
            .delay(1500)
            .then(() => {
                runner.startTriggeringTasks();
            })
            .delay(750)
            .then(() => {
                runner.stopTriggeringTasks();

                assert.equal(task1.run.callCount, 1);
                assert.equal(task2.run.callCount, 1);
                assert.equal(task3.run.callCount, 1);

                assert(task2.calls[0].end <= task1.calls[0].start);
                assert(task1.calls[0].end <= task3.calls[0].start);
            });
    });

    it('should trigger task at least 3 times when there is enough time', () => {
        const task = getMockTask(500);

        return runner.registerTask(task, 1)
            .delay(500)
            .then(() => {
                runner.startTriggeringTasks();
            })
            .delay(1100) // 0, 500, 1000...
            .then(() => {
                assert.equal(task.run.callCount, 3);
            });
    });

    it('should call the task again when the first run fails', () => {
        const task = getMockTask();
        task.getNextTime = sinon.spy(() => new Date(Date.now() + 600));

        let cnt = 0;
        task.run = sinon.spy(() => {
            return Q.delay(300).then(function () {
                if (1 === ++cnt) {
                    throw new Error('someError');
                }
            });
        });

        return runner.registerTask(task, 1)
            .delay(1500)
            .then(() => {
                runner.startTriggeringTasks();
            })
            .delay(960) // nextTime is after | 300 + 60 | 600 | = 1060,
            .then(() => {
                assert.equal(task.getNextTimeAfterFail.callCount, 1);
                assert.equal(task.run.callCount, 2);
            });
    });

    it('should not call the "run" method next time, nor concurrent runners while the first one emitting progress', function () {

        this.timeout(3000);
        const runner = getRunner(500);
        const runner2 = getRunner(500);
        const runner3 = getRunner(500);

        const task = getMockTask();
        task.run = sinon.spy(function (progress) {
            const def = Q.defer();

            setTimeout(progress, 400);
            setTimeout(progress, 800);
            setTimeout(progress, 1200);
            setTimeout(progress, 1600);
            setTimeout(progress, 2000);
            setTimeout(progress, 2400);
            setTimeout(progress, 2800);

            return def.promise.delay(2900);
        });
        task.getNextTime = sinon.spy(() => new Date(Date.now() + 500));

        return Q.all([
                runner.registerTask(task, 1),
                runner2.registerTask(task, 1),
                runner3.registerTask(task, 1)
            ])
            .then(() => {
                runner.startTriggeringTasks();
                runner2.startTriggeringTasks();
                runner3.startTriggeringTasks();
            })
            .delay(2890)
            .then(() => {
                assert.equal(task.run.callCount, 1);
            });

    });

});
