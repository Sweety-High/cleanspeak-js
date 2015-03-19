'use strict';
var request = require('request');
var url = require('url');
var _ = require('lodash');
var pg = require('pg');

/*
 * Constructor, takes configuration from either passed-in variables or the environment.
 *
 * @param {string} opts.host                    Hostname for Cleanspeak server, including port
 * @param {string} opts.authToken               Auth token for Cleanspeak server (optional)
 * @param {string} opts.notificationHost        Hostname for the notification server. Used for accepting/rejecting moderation.
 * @param {string} opts.notificationUsername    Username for the notification server.
 * @param {string} opts.notificationPassword    Password for the notification server.
 * @param {string} opts.enabled                 Set to false to bypass all CleanSpeak methods (development mode).
 */
function CleanSpeak(opts) {
  this.host = opts.host;
  this.authToken = opts.authToken;
  // TODO these four options are only used for createApplication, maybe move them there?
  this.databaseUrl = opts.databaseUrl;
  this.notificationHost = opts.notificationHost;
  this.notificationUsername = opts.notificationUsername;
  this.notificationPassword = opts.notificationPassword;
  this.enabled = typeof opts.enabled !== 'undefined' ? opts.enabled : true;
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
  if (!this.enabled) return callback(null, {filtered: false, replacement: content});

  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };
  var body = {
    content: content
  };
  var uri = url.resolve(this.host, '/content/item/filter');

  request.post(uri, {body: JSON.stringify(body), headers: headers}, function(err, response, responseBody) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    return callback(null, that._convertFilterResponse(responseBody));
  });
};

/*
 * Sends content for moderation.
 *
 * @param {array} content                     Array of parts that make up the item.
 * @param {string} content[x].name            Name of the content part (must be unique).
 * @param {string} content[x].content         The actual content for the part, such as text (for type 'text') or a URL
 *                                              (for type 'image').
 * @param {string} content[x].type            The type of the content part.
 *                                              Valid types: text, attribute, hyperlink, image, video, audio
 * @param {uuid} opts.contentId               UUID for the content.
 * @param {uuid} opts.senderId                UUID for the user who owns the content.
 * @param {string} opts.senderDisplayName     Name for the user who owns the content.
 * @param {uuid} opts.applicationId           UUID for the application the content is associated with (affects notifications).
 * @param {bool} opts.requiresApproval        Whether or not the content is sent to the queue even if no filter is hit
 * @param {bool} opts.generatesAlert          Whether or not the content is sent to the alert queue
 * @param {function} callback                 Callback function (err)
 * @returns {string} err                      Error message if an error occurs
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
CleanSpeak.prototype.moderate = function(content, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!this.enabled) return callback(null);
  if (this.ironClient) return this._addQueue('moderate',  {content: content, opts: opts}, callback);

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
      applicationId: opts.applicationId,
      createInstant: new Date().valueOf(),
      parts: content,
      senderId: opts.senderId,
      senderDisplayName: opts.senderDisplayName
    },
    moderation: queueOption
  };
  var uri = url.resolve(this.host, '/content/item/moderate/' + opts.contentId);

  request({method: method, uri: uri, headers: headers, body: JSON.stringify(body)}, function(err, response) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    return callback(null);
  });
};

/*
 * Sends content for moderation.
 *
 * @param {string} contentId            UUID for the content.
 * @param {string} reporterId           UUID for the user who is reporting the content.
 * @param {bool} opts.reason            (optional) Reason the item is being reported (i.e. spam, abusive)
 * @param {bool} opts.comment           (optional) Comment from the reporting user
 * @param {function} callback           Callback function (err)
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
CleanSpeak.prototype.flagContent = function(contentId, reporterId, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!this.enabled) return callback(null);

  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };
  var body = {
    flag: {
      reporterId: reporterId,
      createInstant: new Date().valueOf()
    }
  };
  if (opts.reason) body.flag.reason = opts.reason;
  if (opts.comment) body.flag.comment = opts.comment;
  var uri = url.resolve(this.host, '/content/item/flag/' + contentId);

  request({method: 'POST', uri: uri, headers: headers, body: JSON.stringify(body)}, function(err, response) {
    if (err) return callback(err);
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
 * @param {string} opts.imageURL          URL for user's profile image.
 * @param {boolean} opts.update           true if updating an existing record, false if not
 * @returns {string} err                  Error message if an error occurs
 *
 */
CleanSpeak.prototype.addUser = function(userId, opts, callback) {
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!this.enabled) return callback(null);

  if (opts.lastLoginInstant instanceof Date) opts.lastLoginInstant = opts.lastLoginInstant.valueOf();

  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };

  var userOpts = _.pick({
    applicationIds: opts.applicationIds,
    attributes: opts.attributes,
    displayNames: opts.displayNames,
    createInstant: new Date().valueOf(),
    birthDate: opts.birthDate,
    email: opts.email,
    lastLoginInstant: opts.lastLoginInstant,
    name: opts.name,
    imageURL: opts.imageURL
  }, function(value) {
    return !!value;
  });
  var body = {
    user: userOpts
  };
  var uri = url.resolve(this.host, '/content/user/' + userId);
  var method = opts.update ? 'PUT' : 'POST';

  request({method: method, uri: uri, headers: headers, body: JSON.stringify(body)}, function(err) {
    if (err) return callback(err);
    return callback(null);
  });
};

/*
 * Creates a new application (with a new moderation queue) and attaches a notification server.
 *
 * @param {string} name                                 Name for the application, as shown in Cleanspeak
 * @param {string} opts.notificationPath                Path that the notification server will contact on moderation accept/reject
 * @param {bool} opts.storeContent                      true if all content should be stored in CleanSpeak's database.
 * @param {bool} opts.persistent                        true if content should be persistent (eligible for moderation).
 *                                                        Defaults to false (transient).
 * @param {bool} opts.contentEditable                   true if the content in the application can be edited by moderators.
 * @param {bool} opts.contentDeletable                  true if the content in the application can be delete by moderators.
 * @param {bool} opts.defaultActionIsQueueForApproval   true if all content should be queued (pre-moderation).
 *                                                        If false, this can still be set on individual moderation calls.
 * @param {bool} opts.contentUserActionsEnabled         true if users in this application can be actioned by moderators.
 *
 * @param {uuid} opts.id                                Optional id to use for the application instead of selecting a random one.
 * @param {callback} function                           Callback when complete (err, result)
 * @returns {string} err                                Error message if error occurs
 *
 */
CleanSpeak.prototype.createApplication = function(name, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!this.enabled) return callback(null);

  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };

  var moderationOpts = _.pick(opts, [
    'contentDeletable',
    'contentEditable',
    'contentUserActionsEnabled',
    'defaultActionIsQueueForApproval',
    'persistent',
    'storeContent'
  ]);
  var body = {
    application: {
      name: name,
      moderationConfiguration: moderationOpts
    }
  };

  var uri = url.resolve(this.host, '/system/application');
  if (opts.id) uri += '/' + opts.id;

  request.post(uri, {headers: headers, body: JSON.stringify(body)}, function(err, response, body) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    var applicationId = JSON.parse(body).application.id;
    that._createNotificationServer(applicationId, opts.notificationPath, function(err) {
      if (err) return callback(err);

      return callback(null, {id: applicationId});
    });
  });
};

/*
 * Deletes an application, along with its notification server.
 *
 * @param {uuid} id                 ID for the application, as shown in Cleanspeak
 * @param {callback} function       Callback when complete (err, result)
 * @returns {string} err            Error message if error occurs
 *
 */
CleanSpeak.prototype.deleteApplication = function(id, opts, callback) {
  var that = this;
  if (!this.enabled) return callback(null);
  if (!opts.notificationPath) return callback('notificationPath is required');

  var headers = {
    Authentication: this.authToken
  };

  var uri = url.resolve(this.host, '/system/application/' + id);
  request.del(uri, {headers: headers}, function(err, response) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    that._deleteNotificationServer(id, opts.notificationPath, function(err) {
      if (err) return callback(err);

      return callback(null);
    });
  });
};

/*
 * Updates an existing application.
 *
 * @param {uuid} id                                     ID for the application
 * @param {string} opts.name                            Name for the application
 * @param {bool} opts.storeContent                      true if all content should be stored in CleanSpeak's database.
 * @param {bool} opts.persistent                        true if content should be persistent (eligible for moderation).
 *                                                        Defaults to false (transient).
 * @param {bool} opts.contentEditable                   true if the content in the application can be edited by moderators.
 * @param {bool} opts.contentDeletable                  true if the content in the application can be delete by moderators.
 * @param {bool} opts.defaultActionIsQueueForApproval   true if all content should be queued (pre-moderation).
 *                                                        If false, this can still be set on individual moderation calls.
 * @param {bool} opts.contentUserActionsEnabled         true if users in this application can be actioned by moderators.
 * @param {callback} function                           Callback when complete (err, result)
 * @returns {string} err                                Error message if error occurs
 *
 */
CleanSpeak.prototype.updateApplication = function(id, opts, callback) {
  var that = this;
  if (typeof opts === 'function') {
    callback = opts;
    opts = {};
  }
  if (!this.enabled) return callback(null);

  var headers = {
    Authentication: this.authToken,
    'Content-Type': 'application/json'
  };

  var moderationOpts = _.pick(opts, [
    'contentDeletable',
    'contentEditable',
    'contentUserActionsEnabled',
    'defaultActionIsQueueForApproval',
    'persistent',
    'storeContent'
  ]);
  var body = {
    application: {
      name: opts.name,
      moderationConfiguration: moderationOpts
    }
  };

  var uri = url.resolve(this.host, '/system/application/' + id);

  request.put(uri, {headers: headers, body: JSON.stringify(body)}, function(err, response) {
    if (err) return callback(err);
    if (response.statusCode !== 200) return callback(that._convertErrors(response));

    return callback(null);
  });
};

/*
 * Deletes a notification server and all records.
 *
 * @param {string} applicationId            Application ID to link to the server
 * @param {function} callback               Callback when complete (err)
 * @returns {string} err                    Error message if error occurs
 */
CleanSpeak.prototype._deleteNotificationServer = function(applicationId, path, callback) {
  var query, params, that = this;

  pg.connect(this.databaseUrl, function(err, client, done) {
    var uri = url.resolve(that.notificationHost, path);
    if (!uri) return callback('Error while build URI. noticationHost: ', that.notificationHost, ', path: ', path);
    if (err) return callback('error fetching client from pool', err);

    query = 'DELETE FROM notification_servers WHERE url = $1';
    params = [uri];
    client.query(query, params, function(err) {
      done();
      if (err) return callback(err);

      return callback(null);
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

  pg.connect(this.databaseUrl, function(err, client, done) {
    var uri = url.resolve(that.notificationHost, path);
    if (!uri) return callback('Error while build URI. noticationHost: ', that.notificationHost, ', path: ', path);
    if (err) return callback('error fetching client from pool', err);

    var query = 'INSERT INTO notification_servers (url, http_authentication_username, http_authentication_password) VALUES ($1, $2, $3) RETURNING id';
    var params = [uri, that.notificationUsername, that.notificationPassword];
    client.query(query, params, function(err, result) {
      if (err) {
        done();
        return callback(err);
      }

      var notificationId = result.rows[0].id;

      var query = 'INSERT INTO notification_servers_applications (notification_servers_id, applications_id) VALUES ($1, $2)';
      var params = [notificationId, applicationId];
      client.query(query, params, function(err) {
        done();
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
  var jsonData = JSON.parse(body);
  if (jsonData.matches) {
    return {filtered: true, replacement: jsonData.replacement};
  } else {
    return {filtered: false, replacement: jsonData.replacement};
  }
};

/*
 * Parses the response from Cleanspeak and pulls the error message
 *
 * @returns {obj} error.statusCode         Human-readable error message
 */
CleanSpeak.prototype._convertErrors = function(response) {
  try {
    var jsonData = JSON.parse(response.body);
    return JSON.stringify({
      statusCode: response.statusCode,
      message: jsonData
    });
  } catch(e) {
    return JSON.stringify({
      statusCode: response.statusCode,
      message: response.body
    });

  }
};

module.exports = CleanSpeak;