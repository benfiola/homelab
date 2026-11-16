local d = import 'lib.libsonnet';

d.section('SABnzbd', [
  [
    d.status('sabnzbd'),
    d.stat('Speed', 'sum(sabnzbd_queue_speed_bytes)', unit='Bps'),
    d.stat('Queue', 'sum(sabnzbd_queue_slots)'),
    d.stat('Remaining', 'sum(sabnzbd_queue_remaining_bytes)', unit='bytes'),
    d.stat('State', 'max(sabnzbd_queue_paused)', steps=d.ok, mappings=[[0, 'Running', 'green'], [1, 'Paused', 'orange']]),
    d.stat('Failed jobs', 'sum(sabnzbd_history_failed_jobs)', steps=d.ok, description='Failed downloads still in the history'),
  ],
  [
    d.series('Speed', 'sum(sabnzbd_queue_speed_bytes)', unit='Bps', min=0),
    d.series('Queue', [
      { expr: 'sum(sabnzbd_queue_slots)', legend: 'items' },
    ], min=0),
  ],
  [
    d.series('Downloaded in the last 24 hours', 'sum(sabnzbd_history_day_bytes)', unit='bytes', min=0),
    d.series('Article success by provider', { expr: '100 * sabnzbd_server_articles_success / sabnzbd_server_articles_tried', legend: '{{server}}' }, unit='percent', min=0, description='Articles the provider had, of those requested. A drop suggests missing retention or a problem with the provider'),
  ],
])
