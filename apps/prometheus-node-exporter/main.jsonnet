local mixin = (import 'node-mixin/mixin.libsonnet') + {
  _config+:: { nodeExporterSelector: 'job="node-exporter"' },
};

// every query is scoped to the dashboard's selected cluster and instance
local sel = 'job="node-exporter", instance="$instance", cluster=~"$cluster"';

local ds = { type: 'prometheus', uid: '$datasource' };

// a time series panel; `targets` are [expr, legend] pairs
local timeseries(id, title, description, unit, targets, defaults={}) = {
  id: id,
  type: 'timeseries',
  title: title,
  description: description,
  datasource: { type: 'prometheus', uid: '${datasource}' },
  fieldConfig: {
    defaults: { unit: unit, min: 0, custom: { fillOpacity: 0, showPoints: 'never' } } + defaults,
  },
  options: { tooltip: { mode: 'multi' } },
  targets: [{ datasource: ds, expr: t[0], legendFormat: t[1] } for t in targets],
  gridPos: { w: 12, h: 7 },
};

// colors a temperature by how worrying it is
local temperatureThresholds = {
  thresholds: {
    mode: 'absolute',
    steps: [
      { color: 'green', value: null },
      { color: 'orange', value: 70 },
      { color: 'red', value: 85 },
    ],
  },
  custom: { fillOpacity: 0, showPoints: 'never', thresholdsStyle: { mode: 'line' } },
};

// the temperature sensors of the chips named `chips` (a regex), labelled by chip and sensor
local temperature(chips, s=sel) =
  'node_hwmon_temp_celsius{%s} * on(instance, chip) group_left(chip_name) node_hwmon_chip_names{%s, chip_name=~"%s"}' % [s, s, chips];

local pressure(id, title, description, resource, stalls) = timeseries(
  id,
  title,
  description,
  'percentunit',
  [
    ['rate(node_pressure_%s_waiting_seconds_total{%s}[$__rate_interval])' % [resource, sel], 'some tasks stalled'],
  ] + (
    if stalls then [['rate(node_pressure_%s_stalled_seconds_total{%s}[$__rate_interval])' % [resource, sel], 'all tasks stalled']] else []
  ),
);

// panels added to the mixin's rows, by the title of the row
local added = {
  CPU: [
    pressure(101, 'CPU Pressure', 'Share of time tasks were waiting for CPU (pressure stall information)', 'cpu', false),
  ],
  Memory: [
    pressure(102, 'Memory Pressure', 'Share of time tasks were stalled waiting for memory (pressure stall information)', 'memory', true),
    timeseries(
      103,
      'OOM Kills',
      'Processes killed by the kernel OOM killer',
      'short',
      [['increase(node_vmstat_oom_kill{%s}[$__rate_interval])' % sel, 'oom kills']],
    ),
  ],
  Disk: [
    pressure(104, 'I/O Pressure', 'Share of time tasks were stalled waiting for disk I/O (pressure stall information)', 'io', true),
  ],
  Network: [
    timeseries(
      105,
      'Conntrack Usage',
      'Connection tracking table usage; new connections are dropped when it is full',
      'percentunit',
      [['node_nf_conntrack_entries{%s} / node_nf_conntrack_entries_limit{%s}' % [sel, sel], 'conntrack entries used']],
      { max: 1 },
    ),
    timeseries(
      106,
      'TCP Retransmits',
      'TCP segments retransmitted per second',
      'short',
      [['rate(node_netstat_Tcp_RetransSegs{%s}[$__rate_interval])' % sel, 'retransmitted segments']],
    ),
  ],
};

local hardware = [
  { id: 100, type: 'row', title: 'Hardware', collapsed: false, panels: [] },
  timeseries(
    107,
    'CPU Temperature',
    'CPU package and core temperatures',
    'celsius',
    [[temperature('coretemp|k10temp'), '{{chip_name}} {{sensor}}']],
    temperatureThresholds { min: null },
  ),
  timeseries(
    108,
    'NVMe Temperature',
    'NVMe drive temperatures',
    'celsius',
    [[temperature('nvme'), '{{chip}} {{sensor}}']],
    temperatureThresholds { min: null },
  ),
  timeseries(
    109,
    'CPU Frequency',
    'Average CPU frequency against its maximum; a drop under load suggests throttling',
    'hertz',
    [
      ['avg(node_cpu_scaling_frequency_hertz{%s})' % sel, 'average'],
      ['max(node_cpu_scaling_frequency_max_hertz{%s})' % sel, 'maximum'],
    ],
  ),
  timeseries(
    110,
    'CPU Thermal Throttling',
    'Times the CPU was throttled because it was too hot, per second',
    'short',
    [
      ['sum(rate(node_cpu_core_throttles_total{%s}[$__rate_interval]))' % sel, 'core throttles'],
      ['sum(rate(node_cpu_package_throttles_total{%s}[$__rate_interval]))' % sel, 'package throttles'],
    ],
  ),
];

// the panels of a dashboard are a flat list in which a row owns the panels that follow it. this
// adds panels to the end of the rows `added` names, appends the hardware row, and lays everything
// out again, two panels to a line
local withPanels(panels) =
  local rows = [i for i in std.range(0, std.length(panels) - 1) if panels[i].type == 'row'];
  local groups = [
    panels[rows[k]:(if k + 1 < std.length(rows) then rows[k + 1] else std.length(panels))] + std.get(added, panels[rows[k]].title, [])
    for k in std.range(0, std.length(rows) - 1)
  ] + [hardware];
  local place(state, p) =
    local wrap = state.x + p.gridPos.w > 24;
    local x = if wrap then 0 else state.x;
    local y = if wrap then state.y + state.lineHeight else state.y;
    {
      x: x + p.gridPos.w,
      y: y,
      lineHeight: if wrap then p.gridPos.h else std.max(state.lineHeight, p.gridPos.h),
      out: state.out + [p { gridPos+: { x: x, y: y } }],
    };
  local layout(acc, group) =
    local start = acc.y + acc.lineHeight;
    local row = group[0] { gridPos: { x: 0, y: start, w: 24, h: 1 } };
    local end = std.foldl(place, group[1:], { x: 0, y: start + 1, lineHeight: 0, out: [row] });
    { y: end.y, lineHeight: end.lineHeight, out: acc.out + end.out };
  std.foldl(layout, groups, { y: 0, lineHeight: 0, out: [] }).out;

local hardwareAlerts = {
  name: 'node-hardware',
  rules: [
    {
      alert: 'NodeCPUHighTemperature',
      expr: 'max by (instance) (%s) > 85' % temperature('coretemp|k10temp', 'job="node-exporter"'),
      'for': '10m',
      labels: { severity: 'warning' },
      annotations: {
        summary: 'CPU temperature is high.',
        description: '{{ $labels.instance }} CPU temperature has been {{ $value }}°C for 10 minutes.',
      },
    },
    {
      alert: 'NodeNVMeHighTemperature',
      expr: 'max by (instance) (%s) > 70' % temperature('nvme', 'job="node-exporter"'),
      'for': '10m',
      labels: { severity: 'warning' },
      annotations: {
        summary: 'NVMe temperature is high.',
        description: '{{ $labels.instance }} NVMe temperature has been {{ $value }}°C for 10 minutes.',
      },
    },
    {
      alert: 'NodeOOMKilled',
      expr: 'increase(node_vmstat_oom_kill{job="node-exporter"}[5m]) > 0',
      labels: { severity: 'warning' },
      annotations: {
        summary: 'The kernel OOM killer ran.',
        description: '{{ $labels.instance }} had {{ $value }} processes killed by the OOM killer in the last 5 minutes.',
      },
    },
  ],
};

{
  alerts: mixin.prometheusAlerts.groups + [hardwareAlerts],
  dashboards: {
    [name]: mixin.grafanaDashboards[name] + (
      if name == 'nodes.json' then { panels: withPanels(mixin.grafanaDashboards[name].panels) } else {}
    )
    for name in std.objectFields(mixin.grafanaDashboards)
    if std.findSubstr('aix', name) == [] && std.findSubstr('darwin', name) == []
  },
  rules: mixin.prometheusRules.groups,
}
