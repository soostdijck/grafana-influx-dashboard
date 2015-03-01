/* global _ */

/*
 * Complex scripted dashboard
 * This script generates a dashboard object that Grafana can load. It also takes a number of user
 * supplied URL parameters (int ARGS variable)
 */


// Accessable variables in this scope
var window, document, ARGS, $, jQuery, moment, kbn;


return function (callback) {
  'use strict';

  // Setup some variables
  var dashboard;
  var hostSeries = [];

  // InfluxDB setup
  var influxUser = 'root';
  var influxPass = 'root';
  var influxDB = 'graphite'; 

  // GET variables
  var displayHost = '';
  var displayMetric = '';
  var displayTime;

  if(!_.isUndefined(ARGS.host)) {
    displayHost = ARGS.host;
  }
  if(!_.isUndefined(ARGS.metric)) {
    displayMetric = ARGS.metric;
  }
  if(!_.isUndefined(ARGS.time)) {
    displayTime = ARGS.time;
  }

  var prefix = 'collectd.' + displayHost + '.';
  var postfix = '';
  var influxdbQueryUrl = window.location.protocol + '//'+ window.location.host +
                   ':8086/db/' + influxDB + '/series?u=' + influxUser + '&p=' + influxPass +
                   '&q=list series /\.' + displayHost + '\./';

  var getdashConfig = '/app/getdash/getdash.conf.js';

  // Intialize a skeleton with nothing but a rows array and service object
  dashboard = {
      rows : [],
      services : {}
  };

  // Set default time
  // time can be overriden in the url using from/to parameteres, but this is
  // handled automatically in grafana core during dashboard initialization

  // Dashboard time and interval setup function
  var getDashTimeInterval = function (time) {
    var defaultTimeInterval =  {
      time: {
        from: "now-6h",
        to: "now"
      },
      interval: '1m',
    };

    if (!time)
      return defaultTimeInterval;

    var timeM = 0;
    var regexpTime = /(\d)+(m|h|d)/;
    var rTime = regexpTime.exec(time);

    if (!rTime)
      return defaultTimeInterval;

    if (rTime[2] === 'm') {
      timeM = parseInt(rTime[1]);
    } else if (rTime[2] === 'h') {
      timeM = parseInt(rTime[1]) * 60;
    } else if (rTime[2] === 'd') {
      timeM = parseInt(rTime[1]) * 60 * 24;
    }

    return {
      time: {
        from: "now-" + time,
        to: "now"
      },
      interval: (timeM >= 360) ? Math.floor(timeM / 360).toString() + 'm' : '30s',
    };
  };

  var dashTimeInterval = getDashTimeInterval(displayTime);
  dashboard.time = dashTimeInterval.time;
  var interval = dashTimeInterval.interval;

  // Set a title
  dashboard.title = 'Scripted Dashboard for ' + displayHost;


  // Dashboard setup helper functions
  var targetGen = function (series, alias, interval, column, apply) {
    return {
      'series': series,
      'alias': alias,
      'column': (column === undefined) ? 'value' : column,
      'interval': (interval === undefined) ? '1m' : interval,
      'function': (apply === undefined) ? 'mean' : apply,
    };
  };

  var targetsGen = function (series, seriesAlias, span, interval, graphConf, aliasConf) {
    var targets = [];
    var aliasColors = {};
    var aliasColor = '';
    var alias = '';
    var column = '';
    var apply = '';
    for (var match in graphConf) {
      var graph = graphConf[match];
      for (var i = 0; i < series.length; i++) {
        var s = series[i];
        seriesAlias = (seriesAlias) ? seriesAlias : s.split('.')[2];
        if (s.lastIndexOf(match) === s.length - match.length) {
          if ((aliasConf) && ('position' in aliasConf)) {
            alias = seriesAlias + '.' + s.split('.')[aliasConf.position];
          } else if (graph.alias) {
            alias = seriesAlias + '.' + graph.alias;
          } else {
            alias = seriesAlias + '.' + match;
          }
          column = graph.column;
          apply = graph.apply;
          targets.push(targetGen(s, alias, interval, column, apply));
          if (graph.color) {
            aliasColor = graph.color;
          } else {
            aliasColor = '#' + ((1 << 24) * Math.random() | 0).toString(16);
          }
          aliasColors[alias] = aliasColor;
        }
      }
    }
    return {
      'targets': targets,
      'aliasColors': aliasColors,
    };
  };

  var panelFactory = function (gConf) {
    return function (series, seriesAlias, span, interval) {
      span = (span === undefined) ? 12 : span;
      interval = (interval === undefined) ? '1m' : interval;
      var result = {};
      var graph = gConf.graph;
      var alias = gConf.alias;
      var targets = targetsGen(series, seriesAlias, span, interval, graph, alias);
      var panel = {
        'title': 'Default Title',
        'type': 'graphite',
        'span': span,
        'y_formats': [ 'none' ],
        'grid': { 'max': null, 'min': 0, 'leftMin': 0 },
        'lines': true,
        'fill': 1,
        'linewidth': 1,
        'nullPointMode': 'null',
        'targets': targets.targets,
        'aliasColors': targets.aliasColors,
      };

      if (('title' in gConf.panel) && (gConf.panel.title.match('@metric'))) {
        return $.extend(result, panel, gConf.panel,
            { 'title': gConf.panel.title.replace('@metric', series[0].split('.')[2]) });
      }

      return $.extend(result, panel, gConf.panel);
   };
  };

  var setupRow = function (title, panels) {
    return {
      'title': title,
      'height': '250px',
      'panels': panels,
      'grid': { 'max': null, 'min': 0 },
    };
  };
  
  var getExtendedMetrics = function (series, prefix) {
    var metricsExt = [];
    var postfix = '';
    for (var i = 0; i < series.length; i++) {
      if (series[i].indexOf(prefix) === 0) {
        postfix = series[i].slice(prefix.length);
        postfix = postfix.slice(0, postfix.indexOf('.'));
        if (metricsExt.indexOf(postfix) === -1) {
          metricsExt.push(postfix);
        }
      }
    }
    return metricsExt;
  };

  var setupDash = function (plugin) {
    var p = {
      func: [],
      config: plugin.config,
    };
    for (var name in plugin) {
      p.func.push(panelFactory(plugin[name]));
    }
    return p;
  };

  var genDashs = function (metrics, plugins) {
    var dashs = {};
    if (metrics) {
      var groups = plugins.groups;
      for (var i = 0, mlen = metrics.length; i < mlen; i++) {
        var metric = metrics[i];
        if (metric in plugins) {
          dashs[metric] = setupDash(plugins[metric]);
        } else if (metric in groups) {
          var group = groups[metric];
          for (var j = 0, glen = group.length; j < glen; j++) {
            var member = group[j];
            if (!(member in dashs) && (member in plugins)) {
              dashs[member] = setupDash(plugins[member]);
            } 
          }
        }
      }
      return dashs;
    } else {
      for (var plugin in plugins) {
        dashs[plugin] = setupDash(plugins[plugin]);
      }
      return dashs;
    }
  };

  var matchSeries = function (prefix, metric, plugin, series, dash) {
    var matchedSeries = [];
    for (var i = 0, len = series.length; i < len; i++) {
      if ((series[i].indexOf(prefix + metric) === 0) &&
        (!('regexp' in dash[plugin].config) ||
        dash[plugin].config.regexp.test(series[i].split('.')[2]))) {
          matchedSeries.push(series[i]);
      }
    }
    return matchedSeries;
  };

  // AJAX configuration
  $.ajaxSetup({
    async: true,
    cache: false,
  });

  // Get series and panel configuration to perepare dashboard
  $.when(
    $.getJSON(influxdbQueryUrl)
      .done(function (jsonData) {
        var points = jsonData[0].points;
        for (var i = 0, len = points.length; i < len; i++) {
          hostSeries.push(points[i][1]);
        }
      })
      .fail(function () {
        throw new Error('Error loading InfluxDB data JSON from: ' + influxdbQueryUrl);
      }),

    $.getScript(getdashConfig)
      .fail(function () {
        throw new Error('Error loading getdash config from: ' + getdashConfig);
      }),

    $.Deferred(function (deferred) {
      $(deferred.resolve);
    })
  ).done(function () {
    if (hostSeries.length === 0) {
      return dashboard;
    }

    var displayMetrics = (displayMetric) ? displayMetric.split(',') : null;
    var showDashs = genDashs(displayMetrics, plugins);

    for (var plugin in showDashs) {
      var metric = plugin;
      var seriesAlias = ('alias' in showDashs[plugin].config) ? showDashs[plugin].config.alias : null;
      var matchedSeries = [];
 
      if (showDashs[plugin].config.multi) {
        var metricsExt = getExtendedMetrics(matchSeries(prefix, metric, plugin, hostSeries, showDashs), prefix);
        for (var i = 0, mlen = metricsExt.length; i < mlen; i++) {
          matchedSeries.push(matchSeries(prefix, metricsExt[i], plugin, hostSeries, showDashs));
        }
      } else {
        matchedSeries.push(matchSeries(prefix, metric, plugin, hostSeries, showDashs));
      }

      for (var j = 0, slen = matchedSeries.length; j < slen; j++) {
        for (var k = 0, flen = showDashs[plugin].func.length; k < flen; k++) {
          var metricFunc = showDashs[plugin].func[k];
          dashboard.rows.push(setupRow(metric.toUpperCase, [metricFunc(matchedSeries[j], seriesAlias, 12, interval)]));
        }
      }
    }

    // Return dashboard
    callback(dashboard);
  });
};
