'use strict';
var request = require('request');
var url = require('url');

/*
 * Constructor, takes configuration from either passed-in variables or the environment.
 *
 * @param {string} opts.host                    Hostname for Cleanspeak server, including port
 * @param {string} opts.authToken               Auth token for Cleanspeak server (optional)
 * @param {string} opts.notificationHost        Hostname for the notification server. Used for accepting/rejecting moderation.
 * @param {string} opts.notificationUsername    Username for the notification server.
 * @param {string} opts.notificationPassword    Password for the notification server.
 */
function CleanSpeak(opts) {
  this.host = opts.host;
  this.authToken = opts.authToken;
  this.databaseUrl = opts.databaseUrl;
  this.notificationHost = opts.notificationHost;
  this.notificationUsername = opts.notificationUsername;
  this.notificationPassword = opts.notificationPassword;
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

  var headers = {
    Authentication: this.authToken
  };
  var body = {
    content: content
  };
  var uri = url.resolve(this.host, '/content/item/filter');

  request.post(uri, {json: body, headers: headers}, function(err, response, responseBody) {
    if (err) return callback(err);
    if (response.statusCode == 401) return callback("API token missing or incorrect");
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    return callback(null, that._convertFilterResponse(responseBody));
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
 * @param {bool} opts.requiresApproval  Whether or not the content is sent to the queue even if no filter is hit
 * @param {bool} opts.generatesAlert    Whether or not the content is sent to the alert queue
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
CleanSpeak.prototype.moderate = function(content, contentId, userId, applicationId, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }

  var method = opts.update ? 'PUT' : 'POST';

  var queueOption = null;
  if (opts.generatesAlert) {
    queueOption = 'generatesAlert';
  } else if (opts.requiresApproval) {
    queueOption = 'requiresApproval';
  }

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
    moderation: queueOption
  };
  var uri = url.resolve(this.host, '/content/item/moderate/' + contentId);

  request({method: method, uri: uri, headers: headers, body: JSON.stringify(body)}, function(err, response, responseBody) {
    if (err) return callback(err);
    if (response.statusCode == 401) return callback("API token missing or incorrect");
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    return callback(null);
  });
};

/*
 * Adds a site user to the CleanSpeak system.
 *
 * @param {string} userId                 UUID for the user.
 * @param {array} opts.applicationIds     Array of application IDs with which to associate this user. If omitted, the
 *                                          user will be available in all applications (optional).
 * @param {object} opts.attributes        Object containing any number of attributes to show in CleanSpeak (optional).
 * @param {array} opts.displayNames       List of display names to associate with the user (optional).
 * @param {string} opts.birthDate         User's birth date in YYYY-MM-DD format (optional).
 * @param {string} opts.email             User's email address (optional).
 * @param {number} opts.lastLoginInstant  Timestamp of user's last login time, in either Unix timestamp or Date format
 *                                          (optional).
 * @param {number} opts.name              User's name (optional).
 * @returns {string} err                  Error message if an error occurs
 *
 */
CleanSpeak.prototype.addUser = function(userId, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (typeof opts.lastLoginInstant === 'Date') opts.lastLoginInstant = opts.lastLoginInstant.valueOf();

  var headers = {
    Authentication: this.authToken
  };
  var body = {
    user: {
      applicationIds: opts.applicationIds,
      attributes: opts.attributes,
      displayNames: opts.displayNames,
      createInstant: new Date().valueOf(),
      birthDate: opts.birthDate,
      email: opts.email,
      lastLoginInstant: opts.lastLoginInstant,
      name: opts.name
    }
  };
  var uri = url.resolve(this.host, '/content/user/' + userId);

  request.post(uri, {headers: headers, json: body}, function(err, result) {
    if (err) return callback(err);
    return callback(null);
  });
};

/*
 * Creates a new application (with a new moderation queue) and attaches a notification server.
 *
 * @param {string} name                   Name for the application, as shown in Cleanspeak
 * @param {string} opts.notificationPath  Path that the notification server will contact on moderation accept/reject
 * @param {uuid} opts.id                  Optional id to use for the application instead of randomizing
 * @param {callback} function             Callback when complete (err, result)
 * @returns {string} err                  Error message if error occurs
 *
 */
CleanSpeak.prototype.createApplication = function(name, opts, callback) {
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
  if (opts.id) uri += '/' + opts.id;

  request.post(uri, {headers: headers, json: body}, function(err, response, body) {
    if (err) return callback(err);
    if (response.statusCode == 401) return callback("API token missing or incorrect");
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    var applicationId = body.application.id;
    that._createNotificationServer(applicationId, opts.notificationPath, function(err) {
      if (err) return callback(err);

      return callback(null, {id: applicationId});
    });
  });
};

/*
 * Creates a notification server and links it to the application.
 *
 * @param {string} applicationId            Application ID to link to the server
 * @param {string} path                     Path that the notification server will contact on moderation accept/reject
 * @param {function} callback               Callback when complete (err)
 * @returns {string} err                    Error message if error occurs
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
CleanSpeak.prototype._convertFilterResponse = function(body) {
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
CleanSpeak.prototype._convertErrors = function(response) {
  try {
    var jsonData = JSON.parse(response.body);
    if (jsonData.generalErrors) return jsonData.generalErrors[0].message;
    return 'Received code ' + response.statusCode + ' from CleanSpeak server: ' + JSON.stringify(jsonData);
  } catch(e) {
    return 'Received code ' + response.statusCode + ' from CleanSpeak server';
  }
};

module.exports = CleanSpeak;