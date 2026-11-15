// helpers for the mediarr dashboards: stat tiles, time series and bar gauges, laid out in rows
local datasource = { uid: '$datasource' };

// a query is an expression, or { expr, legend }
local normalise(q) = if std.isString(q) then { expr: q, legend: '' } else { legend: '' } + q;
local targetsOf(queries) = [
  { datasource: datasource, expr: q.expr, legendFormat: q.legend, refId: std.char(65 + i) }
  for i in std.range(0, std.length(queries) - 1)
  for q in [normalise(queries[i])]
];

// threshold steps are [color, from]: the first has no lower bound
local stepsOf(steps) = [
  { color: s[0], value: if i == 0 then null else s[1] }
  for i in std.range(0, std.length(steps) - 1)
  for s in [steps[i]]
];

// value mappings are [value, text, color]
local mapValues(pairs) = if std.length(pairs) == 0 then [] else [{
  type: 'value',
  options: {
    [std.toString(p[0])]: { text: p[1], color: p[2], index: i }
    for i in std.range(0, std.length(pairs) - 1)
    for p in [pairs[i]]
  },
}];

local green = [['green']];
local ok = [['green'], ['orange', 1]];
local bad = [['green'], ['red', 1]];

// one row of panels shares the 24 columns equally, and is as tall as its tallest panel
local place(rows) =
  local heights = [std.foldl(function(m, p) std.max(m, p.h), row, 0) for row in rows];
  local tops = [std.foldl(function(a, h) a + h, heights[0:i], 0) for i in std.range(0, std.length(rows) - 1)];
  local firsts = [std.foldl(function(a, r) a + std.length(r), rows[0:i], 0) for i in std.range(0, std.length(rows) - 1)];
  std.flattenArrays([
    [
      rows[r][c] {
        id: firsts[r] + c + 1,
        gridPos: {
          x: c * std.floor(24 / std.length(rows[r])),
          y: tops[r],
          w: if c == std.length(rows[r]) - 1
          then 24 - std.floor(24 / std.length(rows[r])) * (std.length(rows[r]) - 1)
          else std.floor(24 / std.length(rows[r])),
          h: heights[r],
        },
      }
      for c in std.range(0, std.length(rows[r]) - 1)
    ]
    for r in std.range(0, std.length(rows) - 1)
  ]);

{
  green:: green,
  ok:: ok,
  bad:: bad,
  mapValues:: mapValues,

  // up or down, from scraparr's own view of the app
  status(app):: self.stat(
    'Status',
    'max(scraparr_services_up{scraparr_services="%s"}) or vector(0)' % app,
    steps=[['red'], ['green', 1]],
    mappings=[[0, 'Down', 'red'], [1, 'Up', 'green']],
    description='Whether scraparr could reach the app on its last scrape',
  ),

  stat(title, queries, unit='short', steps=green, mappings=[], noValue='0', description='', colorMode='background', decimals=null):: {
    h:: 4,
    type: 'stat',
    title: title,
    description: description,
    datasource: datasource,
    targets: targetsOf(if std.isArray(queries) then queries else [queries]),
    fieldConfig: {
      defaults: {
        unit: unit,
        noValue: noValue,
        thresholds: { mode: 'absolute', steps: stepsOf(steps) },
        mappings: mapValues(mappings),
      } + (if decimals == null then {} else { decimals: decimals }),
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      colorMode: colorMode,
      graphMode: 'none',
      textMode: 'auto',
      justifyMode: 'center',
      orientation: 'auto',
    },
  },

  series(title, queries, unit='short', stack=false, description='', min=null, steps=null):: {
    h:: 8,
    type: 'timeseries',
    title: title,
    description: description,
    datasource: datasource,
    targets: targetsOf(if std.isArray(queries) then queries else [queries]),
    fieldConfig: {
      defaults: {
        unit: unit,
        custom: {
          drawStyle: 'line',
          lineWidth: 2,
          fillOpacity: 10,
          showPoints: 'never',
          spanNulls: true,
          stacking: { mode: if stack then 'normal' else 'none', group: 'A' },
        },
      } + (if min == null then {} else { min: min })
      + (if steps == null then {} else { thresholds: { mode: 'absolute', steps: stepsOf(steps) } }),
      overrides: [],
    },
    options: {
      legend: { displayMode: 'list', placement: 'bottom', showLegend: true },
      tooltip: { mode: 'multi', sort: 'desc' },
    },
  },

  bars(title, queries, unit='short', description=''):: {
    h:: 8,
    type: 'bargauge',
    title: title,
    description: description,
    datasource: datasource,
    targets: targetsOf(if std.isArray(queries) then queries else [queries]),
    fieldConfig: {
      defaults: {
        unit: unit,
        noValue: '0',
        min: 0,
        thresholds: { mode: 'absolute', steps: stepsOf(green) },
      },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      orientation: 'horizontal',
      displayMode: 'gradient',
      showUnfilled: true,
    },
  },

  dashboard(title, uid, rows):: {
    title: title,
    uid: uid,
    tags: ['mediarr'],
    editable: false,
    graphTooltip: 1,
    refresh: '1m',
    schemaVersion: 39,
    time: { from: 'now-7d', to: 'now' },
    timezone: 'browser',
    annotations: { list: [] },
    links: [],
    templating: {
      list: [{ name: 'datasource', label: 'Data source', type: 'datasource', query: 'prometheus', current: {}, hide: 0, refresh: 1 }],
    },
    panels: place(rows),
  },
}
