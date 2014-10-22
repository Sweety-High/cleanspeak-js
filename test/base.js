'use strict';

var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');

var sinonChai = require('sinon-chai');
chai.use(sinonChai);

var uuid = require('uuid');
var CleanSpeak = require('../index');
var chance = require('chance').Chance();
var nock = require('nock');
nock.disableNetConnect();
var _ = require('lodash');

describe('CleanSpeak', function() {
  var cleanSpeak, mockRequest, content, defaultOptions;

  beforeEach(function() {
    defaultOptions = {
      host: 'http://cleanspeak.example.com:8001',
      authToken: 'abc123',
      databaseUrl: 'https://user:pass@postgres.example.com/fesafewa',
      notificationHost: 'http://api.example.com',
      notificationUsername: 'user',
      notificationPassword: 'pass'
    };
  });

  describe('constructor', function() {
    describe('enabled', function() {
      it('sets to true by default', function() {
        cleanSpeak = new CleanSpeak(defaultOptions);
        expect(cleanSpeak.enabled).to.be.true;
      });

      it('sets to false if specified', function() {
        defaultOptions.enabled = false;
        cleanSpeak = new CleanSpeak(defaultOptions);
        expect(cleanSpeak.enabled).to.be.false;
      });
    });

    describe('queue options', function() {
      it('sets default attempts and priority', function() {
        defaultOptions.queue = {};
        cleanSpeak = new CleanSpeak(defaultOptions);
        expect(cleanSpeak.queueOpts.attempts).to.equal(5);
        expect(cleanSpeak.queueOpts.priority).to.equal('normal');
      });

      it('allows attempt and priority overrides', function() {
        defaultOptions.queue = {};
        defaultOptions.queueOpts = { attempts: 10, priority: 'high' };
        cleanSpeak = new CleanSpeak(defaultOptions);
        expect(cleanSpeak.queueOpts.attempts).to.equal(10);
        expect(cleanSpeak.queueOpts.priority).to.equal('high');
      });
    });
  });

  describe('filter', function() {
    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
    });

    describe('when the content is not filtered', function() {
      beforeEach(function() {
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/content/item/filter')
          .reply(200, {replacement: 'fine'});
      });

      it('returns filtered: false', function(done) {
        cleanSpeak.filter('fine', function(err, result) {
          expect(result.filtered).to.be.false;
          expect(result.replacement).to.equal('fine');

          done();
          mockRequest.done();
        });
      });
    });

    describe('when the content is filtered', function() {
      beforeEach(function() {
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/content/item/filter')
          .reply(200, { matches:
            [ { length: 4,
              locale: 'en',
              matched: 'dirty',
              quality: 1,
              root: 'dirty',
              severity: 'severe',
              start: 0,
              tags: [],
              type: 'blacklist' } ],
            replacement: '*****' });
      });

      it('returns filtered: true with the replaced text', function(done) {
        cleanSpeak.filter('dirty', function(err, result) {
          expect(result.filtered).to.be.true;
          expect(result.replacement).to.equal('*****');

          done();
          mockRequest.done();
        });
      });
    });

    describe('when enabled is false', function() {
      it('returns filtered: false with the original text', function(done) {
        cleanSpeak.enabled = false;
        cleanSpeak.filter('dirty', function(err, result) {
          expect(result.filtered).to.be.false;
          expect(result.replacement).to.equal('dirty');

          done();
        });
      });
    });
  });

  describe('application methods', function() {
    beforeEach(function() {
      var fakeClient = {
        query: function(query, params, callback) {
          return callback(null, {
            rows: [ {id: 4}]
          });
        }
      };
      var done = function() {};
      var fakePg = {
        connect: function(url, callback) {
          return callback(null, fakeClient, done);
        }
      };
      var options = defaultOptions;
      options.pg = fakePg;
      cleanSpeak = new CleanSpeak(options);
    });

    describe('createApplication', function() {
      it('does not send the application ID', function(done) {
        var id = uuid();
        var name = chance.string({length: 10});
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/system/application')
          .reply(200, { application:
          { id: id,
            moderationConfiguration:
            { archiveConfiguration: [{}],
              contentDeletable: false,
              contentEditable: false,
              contentUserActionsEnabled: false,
              defaultActionIsQueueForApproval: false,
              emailOnAlerts: false,
              emailOnContentFlagged: false,
              emailOnUserFlagged: false,
              persistent: false,
              storeContent: false },
            name: name }
          });

        cleanSpeak.createApplication(name, {notificationPath: '/contests/' + id + '/moderate'}, function(err, result) {
          expect(result.id).to.equal(id);

          done();
          mockRequest.done();
        });
      });

      it('sends truthy options', function(done) {
        var modOpts = {
          contentDeletable: true,
          contentEditable: true,
          contentUserActionsEnabled: true,
          defaultActionIsQueueForApproval: true,
          persistent: true,
          storeContent: true
        };
        var id = uuid();
        var name = chance.string({length: 10});
        var expectedOpts = JSON.stringify({
          application: {
            name: name,
            moderationConfiguration: modOpts
          }
        });
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/system/application', expectedOpts)
          .reply(200, {application: {id: id}});

        cleanSpeak.createApplication(name, _.merge(modOpts, {notificationPath: '/contests/' + id + '/moderate'}), function() {
          done();
          mockRequest.done();
        });
      });

      it('sends falsy options', function(done) {
        var modOpts = {
          contentDeletable: false,
          contentEditable: false,
          contentUserActionsEnabled: false,
          defaultActionIsQueueForApproval: false,
          persistent: false,
          storeContent: false
        };
        var id = uuid();
        var name = chance.string({length: 10});
        var expectedOpts = JSON.stringify({
          application: {
            name: name,
            moderationConfiguration: modOpts
          }
        });
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/system/application', expectedOpts)
          .reply(200, {application: {id: id}});

        cleanSpeak.createApplication(name, _.merge(modOpts, {notificationPath: '/contests/' + id + '/moderate'}), function() {
          done();
          mockRequest.done();
        });
      });

      it('filters out unknown options', function(done) {
        var id = uuid();
        var name = chance.string({length: 10});
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/system/application', JSON.stringify({
            application: {
              name: name,
              moderationConfiguration: {}
            }
          }))
          .reply(200, {application: {id: id}});

        cleanSpeak.createApplication(name, {notificationPath: '/contests/' + id + '/moderate', pork: 'pork'}, function(err, result) {
          expect(err).to.not.exist;
          expect(result.id).to.equal(id);

          done();
          mockRequest.done();
        });
      });

      it('overrides the application ID', function(done) {
        var id = uuid();
        var name = chance.string({length: 10});
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/system/application/' + id)
          .reply(200, { application:
          { id: id,
            moderationConfiguration:
            { archiveConfiguration: [{}],
              contentDeletable: false,
              contentEditable: false,
              contentUserActionsEnabled: false,
              defaultActionIsQueueForApproval: false,
              emailOnAlerts: false,
              emailOnContentFlagged: false,
              emailOnUserFlagged: false,
              persistent: false,
              storeContent: false },
            name: name }
          });

        cleanSpeak.createApplication(name, {notificationPath: '/contests/' + id + '/moderate', id: id}, function(err, result) {
          expect(result.id).to.equal(id);

          done();
          mockRequest.done();
        });
      });

      describe('when enabled is false', function() {
        it('does nothing', function(done) {
          cleanSpeak.enabled = false;
          cleanSpeak.createApplication('app', function(err, result) {
            expect(err).to.not.exist;
            expect(result).to.not.exist;

            done();
          });
        });
      });
    });

    describe('deleteApplication', function() {
      beforeEach(function() {
        cleanSpeak = new CleanSpeak(defaultOptions);
      });

      it('sends a delete request', function(done) {
        var id = uuid();
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .delete('/system/application/' + id)
          .reply(200);
        cleanSpeak.deleteApplication(id, {notificationPath: '/'}, function(err, result) {
          expect(err).to.not.exist;
          expect(result).to.not.exist;

          done();
        });
      });

      it('deletes the associated notification server', function() {

      });
    });
  });

  describe('updateApplication', function() {
    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
    });

    it('sends an update for the application', function(done) {
      var id = uuid();
      var name = chance.string({length: 10});
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .put('/system/application/' + id, {
          application: {
            name: name
          }
        })
        .reply(200, {});

      cleanSpeak.updateApplication(id, {name: name}, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });

    describe('when enabled is false', function() {
      it('does nothing', function(done) {
        cleanSpeak.enabled = false;
        cleanSpeak.updateApplication(uuid(), function(err, result) {
          expect(err).to.not.exist;
          expect(result).to.not.exist;

          done();
        });
      });
    });
  });

  describe('moderate', function() {
    var clock;

    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
      var timestamp = new Date().valueOf();
      clock = sinon.useFakeTimers(timestamp, 'Date');
    });
    afterEach(function() {
      clock.restore();
    });

    it('completes without error', function(done) {
      var contentId = uuid();
      var applicationId = uuid();
      var senderId = uuid();
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/item/moderate/' + contentId, {
          content: {
            applicationId: applicationId,
            createInstant: new Date().valueOf(),
            parts: [
              {
                name: 'username',
                content: 'iamagirl',
                type: 'text'
              }
            ],
            senderId: senderId
          },
          moderation: 'requiresApproval'
        })
        .reply(200, {
          content: {
            id: contentId
          },
          contentAction: 'queuedForApproval',
          moderationAction: 'requiresApproval',
          stored: true
        });
      content = [
        {
          name: 'username',
          content: 'iamagirl',
          type: 'text'
        }
      ];

      cleanSpeak.moderate(content, {contentId: contentId, userId: senderId, applicationId: applicationId, requiresApproval: true}, function(err) {
        expect(err).to.be.null;

        done();
        mockRequest.done();
      });
    });

    it('sends a PUT call with update: true', function(done) {
      var contentId = uuid();
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .put('/content/item/moderate/' + contentId)
        .reply(200, {});
      content = [
        {
          name: 'username',
          content: 'iamagirl',
          type: 'text'
        }
      ];

      cleanSpeak.moderate(content, {contentId: contentId, userId: uuid(), applicationId: uuid(), update: true}, function(err) {
        expect(err).to.be.null;

        done();
        mockRequest.done();
      });
    });

    describe('when enabled is false', function() {
      it('does nothing', function(done) {
        cleanSpeak.enabled = false;
        cleanSpeak.moderate([], function(err, result) {
          expect(err).to.not.exist;
          expect(result).to.not.exist;

          done();
        });
      });
    });

    describe('when a queue is available', function() {
      var queueSpy;

      beforeEach(function() {
        cleanSpeak = new CleanSpeak(_.merge(defaultOptions, { queue: {} }));
        queueSpy = sinon.stub(cleanSpeak, '_addQueue', function(queue, data, callback) {
          callback(null);
        });
      });

      it('adds the request to the queue', function(done) {
        var contentId = uuid();
        content = [
          {
            name: 'username',
            content: 'iamagirl',
            type: 'text'
          }
        ];
        cleanSpeak.moderate(content, {contentId: contentId}, function() {
          expect(queueSpy.args[0][0]).to.equal('moderate');
          expect(queueSpy.args[0][1]).to.eql({ content: content, opts: {contentId: contentId}});

          done();
        });
      });
    });
  });

  describe('flagContent', function() {
    var clock;

    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
      var timestamp = new Date().valueOf();
      clock = sinon.useFakeTimers(timestamp, 'Date');
    });
    afterEach(function() {
      clock.restore();
    });

    it('completes without error', function(done) {
      var contentId = uuid();
      var reporterId = uuid();
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/item/flag/' + contentId, {
          flag: {
            reporterId: reporterId,
            createInstant: new Date().valueOf()
          }
        })
        .reply(200, {});

      cleanSpeak.flagContent(contentId, reporterId, function(err) {
        expect(err).to.be.null;

        done();
        mockRequest.done();
      });
    });

    it('sends optional reason and comment', function(done) {
      var contentId = uuid();
      var reporterId = uuid();
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/item/flag/' + contentId, {
          flag: {
            reporterId: reporterId,
            createInstant: new Date().valueOf(),
            reason: 'offensive',
            comment: 'this thing is a jerk!'
          }
        })
        .reply(200, {});

      cleanSpeak.flagContent(contentId, reporterId, {reason: 'offensive', comment: 'this thing is a jerk!'}, function(err) {
        expect(err).to.be.null;

        done();
        mockRequest.done();
      });
    });

    describe('when enabled is false', function() {
      it('does nothing', function(done) {
        cleanSpeak.enabled = false;
        cleanSpeak.flagContent(uuid(), uuid(), function(err, result) {
          expect(err).to.not.exist;
          expect(result).to.not.exist;

          done();
        });
      });
    });

    describe('when a queue is available', function() {
      var queueSpy;

      beforeEach(function() {
        cleanSpeak = new CleanSpeak(_.merge(defaultOptions, { queue: {} }));
        queueSpy = sinon.stub(cleanSpeak, '_addQueue', function(queue, data, callback) {
          callback(null);
        });
      });

      it('adds the request to the queue', function(done) {
        var contentId = uuid();
        var reporterId = uuid();
        cleanSpeak.flagContent(contentId, reporterId, function() {
          expect(queueSpy.args[0][0]).to.equal('flagContent');
          expect(queueSpy.args[0][1]).to.eql({ contentId: contentId, reporterId: reporterId, opts: {}});

          done();
        });
      });
    });
  });

  describe('addUser', function() {
    var clock, userId;

    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
      var timestamp = new Date().valueOf();
      clock = sinon.useFakeTimers(timestamp, 'Date');
    });
    afterEach(function() {
      clock.restore();
    });

    beforeEach(function() {
      userId = uuid();
    });

    it('runs without error', function(done) {
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/user/' + userId, {
          user: {
            createInstant: new Date().valueOf()
          }
        })
        .reply(200, {});
      cleanSpeak.addUser(userId, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });

    it('coverts lastLoginInstant if given a date object', function(done) {
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/user/' + userId, {
          user: {
            createInstant: new Date().valueOf(),
            lastLoginInstant: new Date().valueOf()
          }
        })
        .reply(200, {});
      cleanSpeak.addUser(userId, { lastLoginInstant: new Date() }, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });

    it('does not covert lastLoginInstant if given an integer', function(done) {
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/user/' + userId, {
          user: {
            createInstant: new Date().valueOf(),
            lastLoginInstant: new Date().valueOf()
          }
        })
        .reply(200, {});
      cleanSpeak.addUser(userId, { lastLoginInstant: new Date().valueOf() }, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });

    it('updates an existing user', function(done) {
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .put('/content/user/' + userId, {
          user: {
            createInstant: new Date().valueOf(),
            displayNames: ['name1', 'name2']
          }
        })
        .reply(200, {});
      cleanSpeak.addUser(userId, {update: true, displayNames: ['name1', 'name2']}, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });

    describe('when enabled is false', function() {
      it('does nothing', function(done) {
        cleanSpeak.enabled = false;
        cleanSpeak.addUser(uuid(), function(err, result) {
          expect(err).to.not.exist;
          expect(result).to.not.exist;

          done();
        });
      });
    });
  });

  describe('optional queue', function() {
    var createSpy, attemptsSpy, prioritySpy, saveSpy, userId;

    beforeEach(function() {
      userId = uuid();
      var fakeQueue = { create: function() {} };
      var fakeSave = { save: function() {} };
      var fakeAttempts = { attempts: function() {} };
      var fakePriority = { priority: function() {} };
      createSpy = sinon.stub(fakeQueue, 'create').returns(fakeAttempts);
      attemptsSpy = sinon.stub(fakeAttempts, 'attempts').returns(fakePriority);
      prioritySpy = sinon.stub(fakePriority, 'priority').returns(fakeSave);
      saveSpy = sinon.stub(fakeSave, 'save', function(callback) {
        return callback(null);
      });
      var options = _.merge(defaultOptions, {
        queue: fakeQueue,
        queueOpts: {
          attempts: 10,
          priority: 'high'
        }
      });
      cleanSpeak = new CleanSpeak(options);
    });

    it('writes to the queue', function(done) {
      cleanSpeak.addUser(userId, function(err) {
        expect(err).to.not.exist;

        expect(createSpy).to.have.been.calledWith('addUser', {userId: userId, opts: {}});
        expect(attemptsSpy).to.have.been.calledWith(10);
        expect(prioritySpy).to.have.been.calledWith('high');
        expect(saveSpy).to.have.been.called;

        done();
      });
    });
  });

  describe('errors', function() {
    beforeEach(function() {
      cleanSpeak = new CleanSpeak(defaultOptions);
    });

    describe('when the server returns an error in JSON format', function() {
      it('returns the error in a standard format', function() {
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/content/item/filter')
          .reply(400, JSON.stringify({
            generalErrors: [
              {
                code: '[invalid]',
                message: 'Your JSON was invalid'
              }
            ]
          }));
        cleanSpeak.filter('error', function(err) {
          expect(err).to.eql({
            statusCode: 400,
            message: {
              generalErrors: [
                {
                  code: '[invalid]',
                  message: 'Your JSON was invalid'
                }
              ]
            }
          });
        });
      });
    });

    describe('when the server returns a non-JSON error', function() {
      it('returns the error in a standard format', function() {
        mockRequest = nock('http://cleanspeak.example.com:8001')
          .post('/content/item/filter')
          .reply(400, 'There was a problem, contact Inversoft');
        cleanSpeak.filter('error', function(err) {
          expect(err).to.eql({
            statusCode: 400,
            message: 'There was a problem, contact Inversoft'
          });
        });
      });
    });
  });
});
