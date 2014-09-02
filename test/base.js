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
  });

  describe('createApplication', function() {
    beforeEach(function() {
      var fakeClient = {
        query: function(query, params, callback) {
          return callback(null, {
            rows: [ {id: 4}]
          });
        }
      };
      var fakePg = {
        connect: function(url, callback) {
          return callback(null, fakeClient);
        }
      };
      var options = defaultOptions;
      options.pg = fakePg;
      cleanSpeak = new CleanSpeak(options);
    });

    it('returns the application ID', function(done) {
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
            persistent: true,
            storeContent: true },
          name: name }
        });

      cleanSpeak.createApplication(name, {notificationPath: '/contests/' + id + '/moderate'}, function(err, result) {
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
            persistent: true,
            storeContent: true },
          name: name }
        });

      cleanSpeak.createApplication(name, {notificationPath: '/contests/' + id + '/moderate', id: id}, function(err, result) {
        expect(result.id).to.equal(id);

        done();
        mockRequest.done();
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

      cleanSpeak.moderate(content, contentId, senderId, applicationId, {requiresApproval: true}, function(err) {
        expect(err).to.be.null;

        done();
        mockRequest.done();
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
      mockRequest = nock('http://cleanspeak.example.com:8001')
        .post('/content/user/' + userId, {
          user: {
            createInstant: new Date().valueOf()
          }
        })
        .reply(200, {});
    });

    it('runs without error', function(done) {
      cleanSpeak.addUser(userId, function(err) {
        expect(err).to.not.exist;

        done();
        mockRequest.done();
      });
    });
  });
});
