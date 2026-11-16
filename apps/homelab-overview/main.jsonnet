// a bird's-eye view of the whole homelab: is anything wrong, and if so, where?
local d = import '../../tools/lib/k8s/dashboard.libsonnet';

// namespaces (one per app) that are applications, as opposed to the platform they run on
local applications = [
  'frigate',
  'home-assistant',
  'kokoro-fastapi',
  'llama-cpp',
  'mediarr',
  'mosquitto',
  'music-assistant',
  'postfix',
  'wyoming-openai',
  'wyoming-whisper',
];
local appSelector = 'namespace=~"%s"' % std.join('|', applications);
local platformSelector = 'namespace!~"%s|default|kube-node-lease|kube-public"' % std.join('|', applications);

// a stat that is red when it is above zero, and says so in words when it is not
local problem(title, expr, description='', steps=d.bad) =
  d.stat(title, expr, steps=steps, mappings=[[0, 'None', 'green']], description=description);

// pods that exist (are not finished) but are not ready, by namespace: zero means the app is up.
// a namespace with nothing running does not appear
local notReady(selector) =
  local live = 'kube_pod_status_phase{%s,phase=~"Pending|Running|Failed|Unknown"} == 1' % selector;
  local pods = 'sum by (namespace) (%s)' % live;
  local ready = 'sum by (namespace) (kube_pod_status_ready{%s,condition="true"} and on (namespace, pod) (%s))' % [selector, live];
  '%s - on (namespace) (%s or on (namespace) (%s * 0))' % [pods, ready, pods];

// one tile per namespace: "Up", or how many pods are not ready
local appTiles(title, selector, description) =
  d.stat(
    title,
    { expr: notReady(selector), legend: '{{namespace}}' },
    unit='suffix: not ready',
    steps=d.bad,
    mappings=[[0, 'Up', 'green']],
    noValue='n/a',
    description=description,
  ) + { h:: 7, options+: { textMode: 'value_and_name' } };

local withSteps(panel, steps, max=null) = panel {
  fieldConfig+: {
    defaults+: {
      thresholds: { mode: 'absolute', steps: [{ color: s[0], value: if i == 0 then null else s[1] } for i in std.range(0, std.length(steps) - 1) for s in [steps[i]]] },
    } + (if max == null then {} else { max: max }),
  },
};
local usage = [['green'], ['orange', 0.7], ['red', 0.9]];
local nothing(panel) = panel { fieldConfig+: { defaults+: { noValue: 'None' } } };

local nodeNetwork = 'device!~"lo|veth.*|lxc.*|cilium.*|docker.*"';
local nodeFilesystem = 'fstype!~"tmpfs|squashfs|overlay|devtmpfs|nfs.*|fuse.*|ramfs|rootfs",mountpoint!~"/var/lib/kubelet/.*|/run/.*|/etc/.*|/usr/.*"';
local temperature(chips) = 'node_hwmon_temp_celsius * on (instance, chip) group_left (chip_name) node_hwmon_chip_names{chip_name=~"%s"}' % chips;
local firing(severity) = 'count(ALERTS{alertstate="firing",severity="%s",alertname!="Watchdog"}) or vector(0)' % severity;

{
  dashboards: {
    'homelab-overview.json': d.dashboard('Homelab Overview', 'homelab-overview', [
      d.section('Health', [
        [
          problem('Critical alerts', firing('critical'), description='Firing alerts with critical severity (Watchdog excluded)'),
          problem('Warning alerts', firing('warning'), steps=d.ok, description='Firing alerts with warning severity'),
          problem('Targets down', 'count(up == 0) or vector(0)', description='Scrape targets prometheus cannot reach. See "Down targets" below'),
          problem('Nodes not ready', 'count(kube_node_status_condition{condition="Ready",status="true"} == 0) or vector(0)'),
          problem('Pods not ready', 'count(%s) or vector(0)' % ('(%s) > 0' % notReady('namespace=~".+"')), description='Namespaces with pods that are not ready'),
          problem('Crash-looping containers', 'count(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1) or vector(0)'),
        ],
        [
          problem(
            'OOM kills (24h)',
            'count(increase(kube_pod_container_status_restarts_total[24h]) > 0 and on (namespace, pod, container) kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1) or vector(0)',
            steps=d.ok,
            description='Containers restarted in the last day after being killed for using too much memory',
          ),
          problem('Certificates expiring (14d)', 'count((certmanager_certificate_expiration_timestamp_seconds - time()) < 14 * 86400) or vector(0)', steps=d.ok, description='cert-manager should have renewed these by now'),
          problem('Flux not ready', 'count(gotk_resource_info{ready=~"False|Unknown",suspended!="true"}) or vector(0)', description='Flux resources that are not reconciled and not suspended'),
          problem('Failed backup jobs', 'count(kube_job_status_failed{namespace=~"bucket-sync|pvc-restore|volsync"} > 0) or vector(0)', description='Failed jobs in the backup and restore apps'),
        ],
      ]),

      d.section('Applications', [
        [
          appTiles('Applications', appSelector, 'Up when every pod of the app is ready'),
          appTiles('Platform', platformSelector, 'Up when every pod of the component is ready'),
        ],
        [
          nothing(d.bars('Restarts (24h)', { expr: 'sort_desc(sum by (namespace) (increase(kube_pod_container_status_restarts_total[24h])) > 0)', legend: '{{namespace}}' }, description='Namespaces whose containers restarted in the last day')),
          d.bars('Memory', { expr: 'topk(10, sum by (namespace) (container_memory_working_set_bytes{container!=""}))', legend: '{{namespace}}' }, unit='bytes', description='Working set of the ten largest namespaces'),
          d.bars('CPU', { expr: 'topk(10, sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m])))', legend: '{{namespace}}' }, unit='none', description='Cores used by the ten busiest namespaces'),
        ],
      ]),

      d.section('Nodes and storage', [
        [
          withSteps(d.bars('CPU used', { expr: '1 - avg by (instance) (rate(node_cpu_seconds_total{job="node-exporter",mode="idle"}[5m]))', legend: '{{instance}}' }, unit='percentunit'), usage, 1),
          withSteps(d.bars('Memory used', { expr: '1 - node_memory_MemAvailable_bytes{job="node-exporter"} / node_memory_MemTotal_bytes{job="node-exporter"}', legend: '{{instance}}' }, unit='percentunit'), usage, 1),
          withSteps(d.bars('Disk used', { expr: 'max by (instance) (1 - node_filesystem_avail_bytes{job="node-exporter",%(f)s} / node_filesystem_size_bytes{job="node-exporter",%(f)s})' % { f: nodeFilesystem }, legend: '{{instance}}' }, unit='percentunit', description='The fullest filesystem of each node'), usage, 1),
        ],
        [
          withSteps(d.bars('Fullest volumes', { expr: 'topk(5, max by (namespace, persistentvolumeclaim) (1 - kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes))', legend: '{{namespace}}/{{persistentvolumeclaim}}' }, unit='percentunit', description='The five fullest persistent volumes'), usage, 1),
          d.series('Temperature', [
            { expr: 'max by (instance) (%s)' % temperature('coretemp|k10temp'), legend: '{{instance}} cpu' },
            { expr: 'max by (instance) (%s)' % temperature('nvme'), legend: '{{instance}} nvme' },
          ], unit='celsius', steps=[['green'], ['orange', 70], ['red', 85]], description='Hottest CPU and NVMe sensor of each node'),
          d.series('Network', [
            { expr: 'sum by (instance) (rate(node_network_receive_bytes_total{job="node-exporter",%s}[$__rate_interval]))' % nodeNetwork, legend: '{{instance}} in' },
            { expr: '-sum by (instance) (rate(node_network_transmit_bytes_total{job="node-exporter",%s}[$__rate_interval]))' % nodeNetwork, legend: '{{instance}} out' },
          ], unit='Bps', description='Received (up) and transmitted (down)'),
        ],
      ]),

      d.section('Platform', [
        [
          d.series('Requests through the gateway', { expr: 'sum by (envoy_response_code_class) (rate(envoy_cluster_upstream_rq_xx[$__rate_interval]))', legend: '{{envoy_response_code_class}}xx' }, unit='reqps', stack=true, min=0),
          d.series('Gateway errors', { expr: 'sum(rate(envoy_cluster_upstream_rq_xx{envoy_response_code_class="5"}[$__rate_interval])) / sum(rate(envoy_cluster_upstream_rq_xx[$__rate_interval]))', legend: '5xx ratio' }, unit='percentunit', min=0, description='The share of requests answered with a server error'),
          d.series('Gateway latency', { expr: 'histogram_quantile(0.95, sum by (le) (rate(envoy_cluster_upstream_rq_time_bucket[$__rate_interval])))', legend: 'p95' }, unit='ms', min=0),
        ],
        [
          d.series('Dropped packets', { expr: 'sum by (reason) (rate(cilium_drop_count_total[$__rate_interval]))', legend: '{{reason}}' }, unit='pps', min=0, description='Packets cilium dropped, by reason. Policy denials show here'),
          withSteps(nothing(d.bars('Certificate lifetime', { expr: 'bottomk(5, (certmanager_certificate_expiration_timestamp_seconds - time()) / 86400)', legend: '{{namespace}}/{{name}}' }, unit='d', description='The five certificates closest to expiring')), [['red'], ['orange', 7], ['green', 21]]),
          d.series('DNS and secret sync errors', [
            { expr: 'sum(rate(external_dns_registry_errors_total[$__rate_interval])) + sum(rate(external_dns_source_errors_total[$__rate_interval]))', legend: 'external-dns' },
            { expr: 'sum(rate(externalsecret_sync_calls_error[$__rate_interval]))', legend: 'external-secrets' },
          ], min=0),
        ],
      ]),

      d.section('Observability', [
        [
          nothing(d.bars('Down targets', { expr: 'count by (job) (up == 0)', legend: '{{job}}' }, description='Scrape targets that cannot be reached, by job')),
          d.series('Prometheus series', { expr: 'sum(prometheus_tsdb_head_series)', legend: 'series' }, min=0),
          d.series('Prometheus storage', { expr: 'sum(prometheus_tsdb_storage_blocks_bytes)', legend: 'blocks' }, unit='bytes', min=0),
        ],
        [
          d.series('Loki ingestion', { expr: 'sum(rate(loki_distributor_bytes_received_total[$__rate_interval]))', legend: 'received' }, unit='Bps', min=0),
          d.series('Loki server errors', { expr: 'sum(rate(loki_request_duration_seconds_count{status_code=~"5.."}[$__rate_interval]))', legend: '5xx' }, unit='reqps', min=0),
          d.series('Failed notifications', { expr: 'sum by (integration) (rate(alertmanager_notifications_failed_total[$__rate_interval]))', legend: '{{integration}}' }, min=0, description='Alerts alertmanager failed to deliver'),
        ],
      ]),

      d.section('Hardware', [
        [
          d.series('NVIDIA GPU', [
            { expr: 'avg by (gpu) (DCGM_FI_DEV_GPU_UTIL) / 100', legend: 'gpu {{gpu}} utilisation' },
            { expr: 'avg by (gpu) (DCGM_FI_DEV_FB_USED / (DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE))', legend: 'gpu {{gpu}} memory' },
          ], unit='percentunit', min=0),
          d.series('NVIDIA GPU temperature and power', [
            { expr: 'avg by (gpu) (DCGM_FI_DEV_GPU_TEMP)', legend: 'gpu {{gpu}} °C' },
            { expr: 'avg by (gpu) (DCGM_FI_DEV_POWER_USAGE)', legend: 'gpu {{gpu}} W' },
          ], min=0),
          d.series('Intel GPU', [
            { expr: 'max(igpu_engines_render_3d_0_busy) / 100', legend: 'render' },
            { expr: 'max(igpu_engines_video_0_busy) / 100', legend: 'video' },
          ], unit='percentunit', min=0),
        ],
      ]),

      d.section('Backups', [
        [
          withSteps(nothing(d.bars('Time since last successful run', { expr: 'max by (namespace, cronjob) (time() - kube_cronjob_status_last_successful_time)', legend: '{{namespace}}/{{cronjob}}' }, unit='s', description='Per CronJob. A backup that stopped running shows as a growing bar')), [['green'], ['orange', 129600], ['red', 259200]]),
          d.series('Failed jobs', { expr: 'sum by (namespace) (kube_job_status_failed{namespace=~"bucket-sync|pvc-restore|volsync"})', legend: '{{namespace}}' }, min=0),
        ],
      ]),
    ], tags=['homelab']),
  },
}
