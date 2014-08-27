'use strict';
var request = require('request');
var config = require('../config');
var url = require('url');

/*
 * Constructor, takes configuration from either passed-in variables or the environment.
 *
 * @param {string} opts.host                    Hostname for Cleanspeak server
 * @param {string} opts.port                    Pork for Cleanspeak server
 * @param {string} opts.authToken               Auth token for Cleanspeak server (optional)
 * @param {string} opts.notificationHost        Hostname for the notification server. Used for accepting/rejecting moderation.
 * @param {string} opts.notificationUsername    Username for the notification server.
 * @param {string} opts.notificationPassword    Password for the notification server.
 */
function CleanSpeak(opts) {
  var host = opts.host || config.cleanSpeak.host;
  var port = opts.port || config.cleanSpeak.port;
  this.authToken = opts.authToken || config.cleanSpeak.authToken;
  this.host = host + ':' + port;
  this.databaseUrl = opts.databaseUrl || config.cleanSpeak.databaseUrl;
  this.notificationHost = opts.notificationHost || config.cleanSpeak.notificationHost;
  this.notificationUsername = opts.notificationUsername || config.cleanSpeak.notificationUsername;
  this.notificationPassword = opts.notificationPassword || config.cleanSpeak.notificationPassword;
  this.pg = opts.pg || require('pg'); // injected for testing
}

/*
 * Send content to Cleanspeak for filtering.
 *
 * @param {string} content              Text to filter
 * @param {callback} function           Function
 * @returns err                         Error message if error occurs, else null
 * @returns result.filtered             true if text was filtered, false if not
 * @returns result.replacement          Text with replaced words if filtered, original text if not
 *
 */
CleanSpeak.prototype.filter = function(content, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  var body = {
    content: content,
    filter: {
      blacklist: {
        enabled:true
      }
    }
  };
  var uri = url.resolve(this.host, '/content/item/filter');

  request.post(uri, {json: body}, function(err, response, body) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that.handleErrors(body));


    return callback(null, that.handleFilterResponse(body));
  });
};

/*
 * Sends content for moderation.
 *
 * @param {array} content               Array of parts that make up the item.
 * @param {string} content[x].name      Name of the content part (must be unique).
 * @param {string} content[x].content   The actual content for the part, such as text (for type 'text') or a URL
 *                                        (for type 'image').
 * @param {string} content[x].type      The type of the content part.
 *                                        Valid types: text, attribute, hyperlink, image, video, audio
 * @param {string} contentId            UUID for the content.
 * @param {string} userId               UUID for the user who owns the content.
 * @param {string} applicationId        UUID for the application the content is associated with (affects notifications).
 * @param {function} callback           Optional callback function (err)
 * @returns {string} err                Error message if an error occurs
 *
 * Example:
 * [
 *   {
 *     name: 'username',
 *     content: 'iamagirl',
 *     type: 'text'
 *   }
 * ]
 *
 */
CleanSpeak.prototype.moderate = function(content, contentId, userId, applicationId, callback) {
  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };
  var body = {
    content: {
      applicationId: applicationId,
      createInstant: new Date().valueOf(),
      parts: content,
      senderId: userId
    },
    moderation: 'requiresApproval'
  };
  var uri = url.resolve(this.host, '/content/item/moderate/' + contentId);

  request.post(uri, {headers: headers, body: JSON.stringify(body)}, function(err) {
    if (callback) {
      if (err) return callback(err);
      return callback(null);
    }
  });
};

/*
 * Creates a new application (with a new moderation queue) and attaches a notification server.
 *
 * @param {string} name                 Name for the application, as shown in Cleanspeak
 * @param {string} notificationPath     Path that the notification server will contact on moderation accept/reject
 * @param {callback} function           Callback when complete (err, result)
 * @returns {string} err                Error message if error occurs
 *
 */
CleanSpeak.prototype.createApplication = function(name, notificationPath, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  var headers = {
    Authentication: this.authToken
  };
  var body = {
    application: {
      name: name,
      moderationConfiguration: {
        storeContent: true,
        persistent: true
      }
    }
  };

  var uri = url.resolve(this.host, '/system/application');

  request.post(uri, {headers: headers, json: body}, function(err, response, body) {
    if (callback) {
      if (err) return callback(err);

      var applicationId = body.application.id;
      that._createNotificationServer(applicationId, notificationPath, function(err) {
        if (err) return callback(err);

        return callback(null, {id: applicationId});
      });
    }
  });
};

/*
 *
 */
CleanSpeak.prototype._createNotificationServer = function(applicationId, path, callback) {
  var that = this;

  this.pg.connect(this.databaseUrl, function(err, client) {
    var uri = url.resolve(that.notificationHost, path);
    if (err) return callback('error fetching client from pool', err);

    var query = 'INSERT INTO notification_servers (url, http_authentication_username, http_authentication_password) VALUES ($1, $2, $3) RETURNING id';
    var params = [uri, that.notificationUsername, that.notificationPassword];
    client.query(query, params, function(err, result) {
      if (err) return callback(err);

      var notificationId = result.rows[0].id;

      var query = 'INSERT INTO notification_servers_applications (notification_servers_id, applications_id) VALUES ($1, $2)';
      var params = [notificationId, applicationId];
      client.query(query, params, function(err) {
        if (err) return callback(err);

        return callback(null);
      });
    });
  });
};

/*
 * Parses the response from Cleanspeak and simplifies to a smaller result.
 *
 * @returns result.filtered     true if text was filtered, false if not
 * @returns result.replacement  filtered text if filtered, original text if not
 *
 */
CleanSpeak.prototype.handleFilterResponse = function(body) {
  if (body.matches) {
    return {filtered: true, replacement: body.replacement};
  } else {
    return {filtered: false, replacement: body.replacement};
  }
};

/*
 * Parses the response from Cleanspeak and pulls the error message
 *
 * @returns {string} result.message             Human-readable rrror message
 */
CleanSpeak.prototype.handleErrors = function(body) {
  return body.generalErrors[0].message;
};

module.exports = CleanSpeak;