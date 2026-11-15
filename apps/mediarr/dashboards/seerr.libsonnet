local d = import 'lib.libsonnet';

d.section('Seerr', [
  [
    d.status('seerr'),
    d.stat('Requests', 'sum(seerr_request_total)'),
    d.stat('Pending or processing', 'sum(seerr_request_status{status=~"Pending|Processing"}) or vector(0)', steps=d.ok, description='Requests waiting for approval, or still being fulfilled'),
    d.stat('Open issues', 'sum(seerr_issue_total)', steps=d.ok),
  ],
  [
    d.series('Requests per day', [
      { expr: 'clamp_min(delta(seerr_request_movie[1d]), 0)', legend: 'movies' },
      { expr: 'clamp_min(delta(seerr_request_tv[1d]), 0)', legend: 'tv' },
    ], stack=true, min=0),
    d.bars('Requests by status', 'sum by (status) (seerr_request_status)'),
  ],
])
