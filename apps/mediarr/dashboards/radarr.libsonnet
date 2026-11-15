local d = import 'lib.libsonnet';

d.section('Radarr', [
  [
    d.status('radarr'),
    d.stat('Queue', 'sum(radarr_queue_count)', description='Items being downloaded, or waiting to import'),
    d.stat('Queue warnings', 'max(radarr_queue_warning)', steps=d.ok, mappings=[[0, 'None', 'green']], description='Something in the queue needs attention, such as an import it cannot do on its own'),
    d.stat('Queue errors', 'max(radarr_queue_error)', steps=d.bad, mappings=[[0, 'None', 'green']]),
    d.stat('Missing movies', 'sum(radarr_missing_movies_total)'),
    d.stat('Movies', 'sum(radarr_movies_total)'),
  ],
  [
    d.series('Queue', 'sum(radarr_queue_count)', min=0, description='A queue that only grows means imports are stuck'),
    d.series('Queue warnings and errors', [
      { expr: 'max(radarr_queue_warning)', legend: 'warnings' },
      { expr: 'max(radarr_queue_error)', legend: 'errors' },
    ], min=0),
  ],
  [
    d.series('Movies on disk', 'sum(radarr_movies_total)', description='Rises with imports, falls with deletions'),
    d.bars('Movies by status', [
      { expr: 'sum(radarr_released_movies_total)', legend: 'released' },
      // scraparr never counts these (it looks for "in cinemas" where radarr says "inCinemas"): what is left over
      { expr: 'sum(radarr_movies_total) - sum(radarr_released_movies_total) - sum(radarr_announced_movies_total) - sum(radarr_tba_movies_total) - sum(radarr_deleted_movies_total)', legend: 'in cinemas' },
      { expr: 'sum(radarr_announced_movies_total)', legend: 'announced' },
      { expr: 'sum(radarr_tba_movies_total)', legend: 'tba' },
    ]),
  ],
])
