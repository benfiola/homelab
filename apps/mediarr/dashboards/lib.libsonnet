// the shared dashboard helpers, with what is particular to mediarr
local base = import '../../../tools/lib/k8s/dashboard.libsonnet';

base {
  // up or down, from scraparr's own view of the app
  status(app):: self.stat(
    'Status',
    'max(scraparr_services_up{scraparr_services="%s"}) or vector(0)' % app,
    steps=[['red'], ['green', 1]],
    mappings=[[0, 'Down', 'red'], [1, 'Up', 'green']],
    description='Whether scraparr could reach the app on its last scrape',
  ),

  dashboard(title, uid, sections):: base.dashboard(title, uid, sections, tags=['mediarr'], from='now-7d'),
}
