local d = import 'lib.libsonnet';

d.section('Sonarr', [
  [
    d.status('sonarr'),
    d.stat('Queue', 'sum(sonarr_queue_count)', description='Items being downloaded, or waiting to import'),
    d.stat('Queue warnings', 'max(sonarr_queue_warning)', steps=d.ok, mappings=[[0, 'None', 'green']], description='Something in the queue needs attention, such as an import it cannot do on its own'),
    d.stat('Queue errors', 'max(sonarr_queue_error)', steps=d.bad, mappings=[[0, 'None', 'green']]),
    d.stat('Missing episodes', 'sum(sonarr_missing_episodes_total)'),
    d.stat('Episodes', 'sum(sonarr_episodes_total)'),
  ],
  [
    d.series('Queue', 'sum(sonarr_queue_count)', min=0, description='A queue that only grows means imports are stuck'),
    d.series('Queue warnings and errors', [
      { expr: 'max(sonarr_queue_warning)', legend: 'warnings' },
      { expr: 'max(sonarr_queue_error)', legend: 'errors' },
    ], min=0),
  ],
  [
    d.series('Episodes on disk', 'sum(sonarr_episodes_total)', description='Rises with imports, falls with deletions'),
    d.series('Missing episodes', 'sum(sonarr_missing_episodes_total)', min=0),
  ],
])
