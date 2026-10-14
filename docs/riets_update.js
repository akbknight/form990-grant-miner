// =============================================================================
//  RIETS Recipient Update Bootstrap
//  Added: 2026-05-27
//  Adds Rabbi Isaac Elchanan Theological Seminary (RIETS) grant-received data
//  from two Candid CSV exports covering award years 2014–2025.
// =============================================================================
window.RIETS_DASHBOARD_UPDATE = {
  summary: {
    label: "RIETS grant-received data added",
    description: "Added Rabbi Isaac Elchanan Theological Seminary (RIETS) " +
                 "as a recipient profile with 188 grant-received records from " +
                 "55 donor organizations, covering award years 2014–2025. " +
                 "Records ingested from two Candid CSV exports (donor-side view). " +
                 "Classification: Jewish-aligned (rabbinical seminary affiliated with Yeshiva University).",
    recipient_name: "Rabbi Isaac Elchanan Theological Seminary",
    recipient_city: "New York City",
    recipient_state: "NY",
    grants_added: 188,
    total_amount_added: 11731824.00,
    donor_count: 55,
    year_range: "2014–2025",
    top_subject: "Graduate and professional education",
    classification: "Jewish-aligned",
    source_files: [
      "data-2026-05-27T091859.879.csv",
      "data-2026-05-27T091912.557.csv"
    ],
    duplicate_rows_dropped: 12, // 100 + 100 = 200 raw → 188 unique
    parse_errors: 0,
    pledge_candidates_flagged: 0,
    review_flags: 0,
    timestamp: "2026-05-27T13:22:00Z",
    update_type: "manual_csv_import",
    target_files_patched: [
      "jewish_recipients.js",
      "jewish_recipient_detail.js",
      "jewish_recipient_grants.js"
    ],
    top_5_donors: [
      { name: "Jewish Communal Fund",                    total: 2839761, count: 10 },
      { name: "Yeshiva Endowment Foundation Inc",        total: 2474401, count: 8  },
      { name: "Hyman & Ann Arbesfeld Foundation Inc",    total: 2171000, count: 5  },
      { name: "Fidelity Investments Charitable Gift Fund", total: 1165118, count: 23 },
      { name: "Kenneth and Agnes Zitter Family Foundation", total: 1037500, count: 11 }
    ]
  }
};

// Auto-log to the Updates Center activity log + send admin notification on first load.
(function(){
  'use strict';
  function logToUpdatesCenter(){
    if(!window.UPDATES_CENTER) return false;
    var u = window.RIETS_DASHBOARD_UPDATE.summary;
    try {
      if(typeof window.UPDATES_CENTER.logActivity === 'function'){
        window.UPDATES_CENTER.logActivity({
          ts: u.timestamp,
          event: 'manual_recipient_data_import',
          card: 'classification_passes',
          summary: u.label + ': ' + u.grants_added + ' grants, $' +
                   u.total_amount_added.toLocaleString() + ' from ' +
                   u.donor_count + ' donors (' + u.year_range + ').',
          details: {
            recipient: u.recipient_name,
            grants_added: u.grants_added,
            total_amount_added: u.total_amount_added,
            donor_count: u.donor_count,
            year_range: u.year_range,
            classification: u.classification,
            source_files: u.source_files,
            review_flags: u.review_flags,
            pledge_candidates_flagged: u.pledge_candidates_flagged,
            top_5_donors: u.top_5_donors
          }
        });
      }
      if(typeof window.UPDATES_CENTER.pushNotification === 'function'){
        window.UPDATES_CENTER.pushNotification({
          severity: 'info',
          card: 'classification_passes',
          kind: 'data_import',
          title: 'RIETS recipient data added (188 grants, $11.73M)',
          summary: 'Rabbi Isaac Elchanan Theological Seminary added as recipient profile. ' +
                   '55 donors, 2014–2025. Source: 2 Candid CSV exports. No review flags.'
        });
      }
      return true;
    } catch(e){
      if(window.console && console.warn) console.warn('[riets_update] log failed:', e);
      return false;
    }
  }
  // The Updates Center may load after this script — retry briefly.
  var tries = 0;
  function tryLog(){
    if(logToUpdatesCenter()) return;
    if(++tries < 20) setTimeout(tryLog, 500);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(tryLog, 800); });
  } else {
    setTimeout(tryLog, 800);
  }
})();
