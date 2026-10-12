/*
 * AI⁴Methane expertise directory: shared settings.
 *
 * 1) Paste the Apps Script web-app URL into ENDPOINT after deploying (see SETUP-expertise.md).
 * 2) Edit the category lists below to change what the survey offers. Categories with
 *    allowOther: true get an "Add your own" box, and members can also add free keywords,
 *    so the lists don't need to be complete. A new category also needs its name added
 *    to LIST_FIELDS and PUBLIC_FIELDS in expertise-backend/Code.gs.
 *    Renaming an option later does NOT rename it in existing responses, so prefer
 *    adding over renaming.
 */
window.AI4M = window.AI4M || {};

AI4M.ENDPOINT = 'https://script.google.com/macros/s/AKfycbwJRkxytZLqRiY29Jl5rY6X3xu5XDWZ3kWpulgUcAqr73MUn8MPoOXdjAAKq8kVwGO3/exec';

AI4M.TAXONOMY = {
  domains: {
    label: 'Methane systems',
    help: 'Sources and sinks you work on.',
    allowOther: true,
    groups: [
      { name: 'Natural', options: [
        'Boreal & temperate wetlands', 'Tropical wetlands', 'Peatlands', 'Permafrost & thermokarst',
        'Coastal & blue carbon wetlands', 'Inland waters (lakes, rivers, reservoirs)', 'Upland soils (CH₄ sink)',
        'Oceans', 'Geologic seeps', 'Vegetation & tree stems', 'Termites & wild animals', 'Wildfire & biomass burning'
      ]},
      { name: 'Anthropogenic', options: [
        'Rice agriculture', 'Livestock & manure', 'Oil & gas', 'Coal', 'Landfills & waste', 'Wastewater'
      ]},
      { name: 'Atmosphere', options: [
        'Atmospheric chemistry & OH sink', 'Global CH₄ budget'
      ]}
    ]
  },
  methods: {
    label: 'Methods & skills',
    help: 'Approaches you are experienced with.',
    allowOther: true,
    groups: [
      { name: 'Observations', options: [
        'Eddy covariance', 'Chamber fluxes', 'Tower & aircraft atmospheric observations',
        'Satellite CH₄ retrievals', 'Land-surface remote sensing', 'Stable isotopes',
        'Field experiments & manipulations', 'Lab incubations', 'Microbial ecology & genomics'
      ]},
      { name: 'Modeling & AI', options: [
        'Process-based biogeochemical modeling', 'Earth system modeling', 'Atmospheric inversion',
        'Machine learning / AI', 'Knowledge-guided machine learning (KGML)', 'Upscaling',
        'Data harmonization & synthesis', 'Uncertainty quantification', 'Software & data engineering'
      ]}
    ]
  },
  applications: {
    label: 'Applications & impact',
    help: 'Broader areas your expertise feeds into.',
    allowOther: true,
    groups: [{ name: '', options: [
      'Nature-based solutions', 'Natural carbon capture', 'Policy implications', 'Climate mitigation & MRV',
      'Land management', 'Ecological forecasting', 'AI research & method development', 'Science communication & outreach'
    ]}]
  },
  scales: {
    label: 'Spatial scales',
    help: '',
    groups: [{ name: '', options: ['Plot / site', 'Landscape', 'Regional', 'Continental', 'Global'] }]
  },
  regions: {
    label: 'Regions',
    help: 'Where your work is focused.',
    allowOther: true,
    groups: [{ name: '', options: [
      'Arctic & boreal', 'North America', 'Latin America & Caribbean', 'Europe', 'Africa',
      'East Asia', 'South & Southeast Asia', 'Oceania', 'Tropics (pan-tropical)', 'Oceans & coasts', 'Global'
    ]}]
  },
  open_to: {
    label: 'Open to',
    help: 'Let researchers know how they can reach out.',
    groups: [{ name: '', options: [
      'New collaborations', 'Mentoring students & postdocs', 'Sharing data', 'Sharing code & models',
      'Reviewing papers & proposals', 'Media & outreach'
    ]}]
  }
};

AI4M.CAREER_STAGES = [
  'Graduate student', 'Postdoc', 'Early-career researcher', 'Mid-career researcher',
  'Senior researcher', 'Research staff / scientist', 'Non-academic professional'
];

/* ---------- Small helpers shared by the pages ---------- */
AI4M.optionsOf = function (field) {
  var t = AI4M.TAXONOMY[field], out = [];
  t.groups.forEach(function (g) { out = out.concat(g.options); });
  return out;
};

AI4M.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

AI4M.configured = function () { return !!AI4M.ENDPOINT; };

// Public list. Apps Script answers GET with a redirect that fetch follows.
AI4M.fetchProfiles = function () {
  if (!AI4M.configured()) return Promise.reject(new Error('not-configured'));
  return fetch(AI4M.ENDPOINT + '?action=list', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.ok) throw new Error(d.error || 'load failed'); return d.profiles || []; });
};

AI4M.fetchOpportunities = function () {
  if (!AI4M.configured()) return Promise.reject(new Error('not-configured'));
  return fetch(AI4M.ENDPOINT + '?action=list_opportunities', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.ok) throw new Error(d.error || 'load failed'); return d.opportunities || []; });
};

// POST as text/plain so the browser sends it without a CORS preflight (Apps Script can't answer one).
AI4M.post = function (payload) {
  if (!AI4M.configured()) return Promise.reject(new Error('not-configured'));
  return fetch(AI4M.ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.json(); });
};

// Count how many profiles carry each term of a field, most common first.
AI4M.tally = function (profiles, field) {
  var counts = {};
  profiles.forEach(function (p) {
    (p[field] || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  });
  return Object.keys(counts).map(function (k) { return { term: k, count: counts[k] }; })
    .sort(function (a, b) { return b.count - a.count || a.term.localeCompare(b.term); });
};
