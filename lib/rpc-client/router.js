var utils = require('../util/utils');
var crc = require('crc');

/**
 * Calculate route info and return an appropriate server id.
 *
 * @param session {Object} session object for current rpc request
 * @param msg {Object} rpc message. {serverType, service, method, args, opts}
 * @param context {Object} context of client
 * @param cb(err, serverId)
 */
var defRoute = function(session, msg, context, cb) {
  var list = context.getServersByType(msg.serverType);
  if (!list || !list.length) {
    cb(new Error('can not find server info for type:' + msg.serverType));
    return;
  }
  var uid = session ? (session.uid || '') : '';
  var index = Math.abs(crc.crc32(uid)) % list.length;
  utils.invokeCallback(cb, null, list[index].id);
};

var rrRoute = function(client, serverType, cb) {
  var servers = client._station.serversMap[serverType];
  if(!servers.length) {
    utils.invokeCallback(cb, new Error('rpc servers not exist with serverType: ' + serverType));
    return;
  }
  var index;
  if(!!client.rrParam) {
    index = client.rrParam[serverType];
  } else {
    index = 0;
    client.rrParam = {};
  }
  utils.invokeCallback(cb, null, servers[index % servers.length]);
  if(index++ === Number.MAX_VALUE) {
    index = 0;
  }
  client.rrParam[serverType] = index;
};

var wrrRoute = function(client, serverType, cb) {
  var servers = client._station.serversMap[serverType];
  if(!servers.length) {
    utils.invokeCallback(cb, new Error('rpc servers not exist with serverType: ' + serverType));
    return;
  }
  var index, weight;
  if(!!client.wrrParam && !!client.wrrParam[serverType]) {
    index = client.wrrParam[serverType].index;
    weight = client.wrrParam[serverType].weight;
  } else {
    index = -1;
    weight = 0;
    client.wrrParam = {};
  }
  var getMaxWeight = function() {
    var maxWeight = -1;
    for(var i=0; i<servers.length; i++) {
      var server = client._station.servers[servers[i]];
      if(!!server.weight && server.weight > maxWeight) {
        maxWeight = server.weight;
      }
    }
    return maxWeight;
  };
  while(true) {
    index = (index + 1) % servers.length;
    if(index === 0) {
      weight = weight - 1;
      if(weight <= 0) {
        weight = getMaxWeight();
        if(weight <= 0) {
          utils.invokeCallback(cb, new Error('rpc wrr route get invalid weight.'));
          return;
        }
      }
    }
    var server = client._station.servers[servers[index]];
    if(server.weight >= weight) {
      client.wrrParam[serverType] = {index: index, weight: weight};
      utils.invokeCallback(cb, null, server.id);
      return;
    }
  }
};

var laRoute = function(client, serverType, cb) {
  var servers = client._station.serversMap[serverType];
  if(!servers.length) {
    utils.invokeCallback(cb, new Error('rpc servers not exist with serverType: ' + serverType));
    return;
  }
  var actives = [];
  if(!!client.laParam) {
    for(var j=0; j<servers.length; j++) {
      var count = client.laParam[servers[j]];
      if(!count) {
        client.laParam[servers[j]] = count = 0;
      }
      actives.push(count);
    }
  } else {
    client.laParam = {};
    for(var i=0; i<servers.length; i++) {
      client.laParam[servers[i]] = 0;
      actives.push(0);
    }
  }
  var rs = [];
  var minInvoke = Number.MAX_VALUE;
  for(var k=0; k<actives.length; k++) {
    if(actives[k] < minInvoke) {
      minInvoke = actives[k];
      rs = [];
      rs.push(servers[k]);
    } else if(actives[k] === minInvoke) {
      rs.push(servers[k]);
    }
  }
  var index = Math.floor(Math.random() * rs.length);
  var serverId = rs[index];
  client.laParam[serverId] += 1;
};

module.exports = {
  rr: rrRoute,
  wrr: wrrRoute,
  la: laRoute,
  defalut: defRoute
};