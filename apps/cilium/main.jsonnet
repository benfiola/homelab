local datasource = { type: 'loki', uid: '${datasource}' };

// where a flow endpoint is described by, in order: its namespace (and pod), the dns names it was
// reached by, a reserved identity (1 host, 6 remote-node, 7 kube-apiserver), and finally its ip
local endpoint(side) = |||
  {{ if .%(s)s_ns }}{{ .%(s)s_ns }}{{ if .%(s)s_pod }}/{{ .%(s)s_pod }}{{ end }}{{ else if .%(s)s_names }}{{ .%(s)s_names }}{{ else if eq .%(s)s_id "1" }}host{{ else if eq .%(s)s_id "6" }}remote-node{{ else if eq .%(s)s_id "7" }}kube-apiserver{{ else }}{{ .%(s)s_ip }}{{ end }}
||| % { s: side };

// each record of the export is a flow aggregated over the export interval, holding the number of
// flows it stands for. both queries share this pipeline and differ only in what they unwrap
local shared = |||
    {namespace="cilium", container="hubble-flows"} |= "\"flow\":"
    | json verdict="flow.verdict", dir="flow.traffic_direction", e="flow.aggregate.egress_flow_count", i="flow.aggregate.ingress_flow_count", ep="flow.egress_allowed_by[0].name", ip="flow.ingress_allowed_by[0].name", src_ns="flow.source.namespace", dst_ns="flow.destination.namespace", src_pod="flow.source.pod_name", dst_pod="flow.destination.pod_name", src_id="flow.source.identity", dst_id="flow.destination.identity", src_names="flow.source_names", dst_names="flow.destination_names", src_ip="flow.IP.source", dst_ip="flow.IP.destination", tcp="flow.l4.TCP.destination_port", udp="flow.l4.UDP.destination_port", icmp="flow.l4.ICMPv4.type"
    | label_format policy=`{{ or .ep .ip }}`, events=`{{ add (int (or .e "0")) (int (or .i "0")) }}`, port=`{{ if .tcp }}TCP/{{ .tcp }}{{ else if .udp }}UDP/{{ .udp }}{{ else if .icmp }}ICMP/{{ .icmp }}{{ end }}`, src_names=`{{ regexReplaceAll "[\\[\\]\"]" .src_names "" }}`, dst_names=`{{ regexReplaceAll "[\\[\\]\"]" .dst_names "" }}`
|||;
local pipeline = std.join('\n', [
  '  ' + line
  for line in std.split(std.stripChars(shared, '\n'), '\n') + [
    '| label_format source=`%s`, destination=`%s`' % [std.stripChars(endpoint('src'), '\n'), std.stripChars(endpoint('dst'), '\n')],
  ]
]);

local query(refId, aggregate, extra, value) = {
  refId: refId,
  datasource: datasource,
  editorMode: 'code',
  queryType: 'instant',
  instant: true,
  expr: '%s(\n%s\n%s  | keep verdict, dir, source, destination, port, policy, %s\n  | unwrap %s [$__range]\n)' % [aggregate, pipeline, extra, value, value],
};

local column(name, properties) = { matcher: { id: 'byName', options: name }, properties: properties };

{
  dashboards: {
    'policy-flows.json': {
      uid: 'hubble-policy-flows',
      title: 'Network Flows',
      editable: false,
      schemaVersion: 39,
      tags: ['cilium', 'network-policy'],
      time: { from: 'now-7d', to: 'now' },
      refresh: '',
      templating: {
        list: [{ name: 'datasource', label: 'Loki', type: 'datasource', query: 'loki', current: {}, hide: 0 }],
      },
      panels: [{
        id: 1,
        type: 'table',
        title: '',
        datasource: datasource,
        gridPos: { x: 0, y: 0, w: 24, h: 32 },
        targets: [
          // how many flows each aggregated flow stands for
          query('A', 'sum_over_time', '', 'events'),
          // when it was last exported: the loki timestamp of its record
          query('B', 'max_over_time', '  | label_format ts=`{{ __timestamp__.UnixMilli }}`\n', 'ts'),
        ],
        transformations: [
          { id: 'labelsToFields', options: { mode: 'columns' } },
          { id: 'merge', options: {} },
          {
            id: 'organize',
            options: {
              excludeByName: { Time: true },
              renameByName: { 'Value #A': 'events', 'Value #B': 'last seen', dir: 'direction' },
              // keyed by the names the fields have before they are renamed
              indexByName: { 'Value #B': 0, source: 1, destination: 2, port: 3, dir: 4, verdict: 5, policy: 6, 'Value #A': 7 },
            },
          },
        ],
        fieldConfig: {
          defaults: { custom: { filterable: true, align: 'auto', cellOptions: { type: 'auto' } } },
          overrides: [
            column('verdict', [
              { id: 'mappings', value: [{ type: 'value', options: { DROPPED: { color: 'red', index: 0 } } }] },
              { id: 'custom.cellOptions', value: { type: 'color-text' } },
            ]),
            // records are written when an export interval closes, so minutes are all it can tell
            column('last seen', [
              { id: 'unit', value: 'time:YYYY-MM-DD HH:mm' },
              { id: 'custom.width', value: 190 },
            ]),
            column('events', [{ id: 'custom.align', value: 'right' }]),
          ],
        },
        options: {
          showHeader: true,
          cellHeight: 'sm',
          sortBy: [{ displayName: 'last seen', desc: true }],
          footer: { show: false },
        },
      }],
    },
  },
}
