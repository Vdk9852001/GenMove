var activeTable=null,allResults={},allStates={},lastLogCount=0;
var uploadSide='source',uploadFileQueue=[];
var currentFsFilter={};
var fieldsTotalsCache={};
var uploadFieldMappingState={pairName:'',sourceColumns:[],targetColumns:[],suggested:{}};

async function init(){await refresh();setInterval(refresh,4000);}

async function refresh(){
  var d=await Promise.all([
    fetch('/api/status').then(r=>r.json()),
    fetch('/api/results').then(r=>r.json()),
    fetch('/api/activity').then(r=>r.json()),
  ]);
  var status=d[0],results=d[1],activity=d[2];
  document.getElementById('scan-ind').style.display=status.scanning?'inline-block':'none';
  document.getElementById('scan-btn').disabled=status.scanning;
  if(status.last_scan) document.getElementById('last-scan').textContent='Scanned: '+status.last_scan;
  var thr=status.pass_threshold||100, sel=status.selected_fields||[], tmpl=status.active_template||'';
  document.getElementById('thr-badge').textContent=
    'Threshold: '+thr+'%'+((!tmpl&&sel.length)?' | Fields: '+sel.length:'');
  var tmplBadge=document.getElementById('tmpl-badge');
  if(tmpl){tmplBadge.style.display='';tmplBadge.textContent='Template: '+tmpl;}
  else{tmplBadge.style.display='none';}
  var newE=activity.slice(0,activity.length-lastLogCount);
  if(lastLogCount>0) newE.forEach(function(e){toast(e.message,e.level);});
  lastLogCount=activity.length;
  allResults={};allStates=status.file_states||{};
  results.forEach(function(r){allResults[r.name]=r;});
  renderSidebar(status);
  if(activeTable){
    var fs=allStates[activeTable];
    if(fs&&fs.state==='validating') renderValidating(activeTable,fs);
    else if(allResults[activeTable]) renderDetail(allResults[activeTable]);
  }
}

async function triggerScan(){await fetch('/api/scan',{method:'POST'});setTimeout(refresh,600);}

function renderSidebar(status){
  var list=document.getElementById('table-list'),html='';
  status.pairs.forEach(function(pair){
    var fs=(status.file_states||{})[pair.name]||{},st=fs.state||'';
    if(!pair.has_pair){
      html+='<div class="sb-unmatched" onclick="openPairManager()" title="Click to pair">'+
            '<div class="sb-icon sb-icon-warn">!</div>'+
            '<div style="min-width:0;flex:1"><div class="tname">'+esc(pair.name)+'</div>'+
            '<div class="tsub">'+(pair.source_path?'no target':'no source')+' - click to pair</div></div></div>';
      return;
    }
    var pill='';
    if(st==='validating') pill='<span class="sp sp-val">...</span>';
    else{
      var r=allResults[pair.name],s=r?r.status:'';
      if(s==='PASS')         pill='<span class="sp sp-pass">PASS</span>';
      else if(s==='WARNING') pill='<span class="sp sp-warn">WARN</span>';
      else if(s==='FAIL')    pill='<span class="sp sp-fail">FAIL</span>';
      else if(s==='ERROR')   pill='<span class="sp sp-fail">ERR</span>';
      else                   pill='<span class="sp sp-new">New</span>';
    }
    var act=activeTable===pair.name?'active':'';
    var isManual=pair.match_type==='manual';
    html+='<div class="sb-item '+act+'" onclick="selectTable(\''+pair.name+'\',this)">'+
          '<div class="sb-icon sb-icon-tbl">T</div>'+
          '<div style="min-width:0;flex:1">'+
          '<div class="tname">'+esc(pair.name)+(isManual?' <span style="font-size:9px;font-weight:400;color:var(--accent)">[paired]</span>':'')+'</div>'+
          '<div class="tsub">'+esc(pair.source_file)+' vs '+esc(pair.target_file)+'</div></div>'+pill+'</div>';
  });
  if(!html) html='<div style="padding:18px 15px;font-size:12px;color:var(--muted);line-height:1.6">No file pairs found.<br>Upload files and use Pairs to link them.</div>';
  list.innerHTML=html;
}

function selectTable(name,el){
  activeTable=name;
  document.querySelectorAll('.sb-item').forEach(function(e){e.classList.remove('active');});
  if(el) el.classList.add('active');
  var fs=allStates[name]||{};
  if(fs.state==='validating'){renderValidating(name,fs);return;}
  if(allResults[name]){renderDetail(allResults[name]);return;}
  document.getElementById('welcome').style.display='none';
  document.getElementById('detail').style.display='block';
  document.getElementById('detail').innerHTML=
    '<div class="banner bn-val"><span class="spinner"></span>'+
    '<span><b>'+esc(name)+'</b> detected, waiting for validation...</span></div>';
}

function renderValidating(name,fs){
  document.getElementById('welcome').style.display='none';
  document.getElementById('detail').style.display='block';
  document.getElementById('detail').innerHTML=
    '<div class="banner bn-val"><span class="spinner"></span>'+
    '<span><b>'+esc(name)+'</b> validating now... '+
    (fs.source_file?'('+esc(fs.source_file)+' vs '+esc(fs.target_file)+')':'')+
    '</span></div>'+
    '<div style="color:var(--muted);font-size:12px;padding:14px 0">Results will appear automatically.</div>';
}

function renderRecommendations(r){
  var recs=r.recommendations||[];
  if(!recs.length) return '';
  var ragCount=recs.filter(function(x){return x.rag_match&&x.can_apply&&x.rag_confidence>=85;}).length;
  var autoBtn=ragCount?'<button class="rec-auto" data-n="'+esc(r.name)+'" onclick="autoApplyLearned(this)">Apply '+ragCount+' learned rule'+(ragCount!==1?'s':'')+'</button>':'';
  return '<div class="rec-panel"><div class="rec-head"><h3>Failed-column recommendations</h3>'+
    '<span class="rec-count">'+recs.length+'</span>'+autoBtn+'</div><div class="rec-body">'+
    recs.map(function(rec){
      var examples=(rec.examples||[]).map(function(e){
        return '<div><b>'+esc(String(e.material||''))+'</b>: correct <span class="dold">'+
          esc(String(e.source_value||''))+'</span> &rarr; current target <span class="dnew">'+
          esc(String(e.target_value||''))+'</span></div>';
      }).join('');
      var btn=rec.can_apply
        ?'<button class="rec-btn" data-n="'+esc(r.name)+'" data-f="'+esc(rec.field)+'" onclick="applyRecommendation(this)">Apply Rule</button>'
        :'<span class="rec-safe">Manual review required; automatic correction is disabled.</span>';
      return '<div class="rec-item '+esc(rec.severity)+'"><div class="rec-top">'+
        '<span class="rec-field">'+esc(rec.label)+'</span><span class="rec-sev">'+esc(rec.severity.toUpperCase())+'</span>'+
        '<span class="rec-impact">'+fmt(rec.affected_records)+' affected records · '+rec.match_pct+'% match</span></div>'+
        '<div class="rec-expl">'+esc(rec.explanation)+
        (rec.rag_match?' <span class="rec-learned">RAG match '+rec.rag_confidence+'% · approved '+rec.approved_count+' time(s)</span>':'')+'</div>'+
        (examples?'<div class="rec-examples">'+examples+'</div>':'')+
        '<div class="rec-actions">'+btn+(rec.learned?'<span class="rec-learned">Approved rule learned</span>':'')+
        '<span class="rec-safe">Original target upload remains unchanged.</span></div></div>';
    }).join('')+'</div></div>';
}

async function autoApplyLearned(btn){
  var name=btn.dataset.n;
  if(!confirm('Apply all high-confidence learned rules to a new corrected target copy? The original upload will remain unchanged.')) return;
  btn.disabled=true;btn.textContent='Applying learned rules...';
  try{
    var res=await fetch('/api/corrections/'+encodeURIComponent(name)+'/auto-apply',{method:'POST'});
    var data=await res.json();
    if(!res.ok) throw new Error(data.error||'Automatic correction failed');
    btn.outerHTML='<a class="rec-auto" href="'+esc(data.download_url)+'" download="'+esc(data.filename)+'">Download RAG-corrected file</a>';
    toast(data.message,'success');setTimeout(refresh,300);
  }catch(e){btn.disabled=false;btn.textContent='Apply learned rules';toast(String(e),'error');}
}

async function applyRecommendation(btn){
  var name=btn.dataset.n,field=btn.dataset.f;
  if(!confirm('Apply this rule to a new target copy for '+field+'? The original target upload will not be changed.')) return;
  btn.disabled=true;btn.textContent='Creating corrected copy...';
  try{
    var res=await fetch('/api/corrections/'+encodeURIComponent(name)+'/apply',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({field:field})
    });
    var data=await res.json();
    if(!res.ok) throw new Error(data.error||'Correction failed');
    btn.outerHTML='<a class="dl-btn" href="'+esc(data.download_url)+'" download="'+esc(data.filename)+'">Download corrected target ('+fmt(data.changed_records)+' changes)</a>';
    toast(data.message,'success');
    var current=allResults[name];if(current){current.recommendations=(current.recommendations||[]).map(function(x){if(x.field===field)x.learned=true;return x;});}
  }catch(e){btn.disabled=false;btn.textContent='Apply Rule';toast(String(e),'error');}
}

function renderDetail(r){
  document.getElementById('welcome').style.display='none';
  var det=document.getElementById('detail');
  det.style.display='block';
  var thr=r.pass_threshold||100, sel=r.selected_fields||[];
  var pc=r.status==='PASS'?'pill-pass':r.status==='WARNING'?'pill-warn':r.status==='ERROR'?'pill-err':'pill-fail';
  var fs=allStates[r.name]||{};
  var banner=fs.state==='changed'?'<div class="banner bn-chg">File changed - re-validation queued.</div>':'';
  var bClass=r.status==='PASS'?'bn-pass':r.status==='WARNING'?'bn-chg':'bn-fail';
  var businessMsg=r.business_message?'<div class="banner '+bClass+'">'+esc(r.business_message)+'</div>':'';
  var dlBtn=r.excel_file
    ?'<a class="dl-btn" href="/api/download/'+encodeURIComponent(r.name)+'" download="'+esc(r.excel_file)+'">Download Excel</a>'
    :'<span class="dl-btn disabled">Download Excel</span>';
  var corrected=(r.corrected_files||[])[0];
  var correctedBtn=corrected
    ?'<a class="dl-btn dl-corrected" href="'+esc(corrected.download_url)+'" download="'+esc(corrected.filename)+'" title="'+esc(corrected.created_at||'')+'">Download Corrected File</a>'
    :'';
  var err=r.errors&&r.errors.length?'<div class="err-box">Error: '+r.errors.map(esc).join('<br>')+'</div>':'';
  var thrHtml='<span class="info-bar">Pass threshold: <b>'+thr+'%</b>'
    +((!r.template_used&&sel.length)?' &nbsp;|&nbsp; <b>'+sel.length+'</b> selected fields':' &nbsp;|&nbsp; All fields')
    +'</span>';
  var tmplHtml=r.template_used
    ?'<span class="tmpl-bar">Template: <b>'+esc(r.template_used)+'</b> ('+
      (r.total_fields||0)+' fields validated)</span>'
    :'';
  var tx=r.transformation||{};
  var transformHtml=tx.enabled?'<div class="banner bn-pass" style="display:flex;justify-content:space-between;align-items:center">'+
    '<span><b>Transformation applied:</b> '+esc(tx.rulebook)+' — '+fmt(tx.applied_rules)+' rules changed '+fmt(tx.changed_cells)+' cells across '+fmt(tx.changed_rows)+' rows.</span>'+
    '<button class="fs-btn" onclick="openTransformModal()">View rules</button></div>':'';
  var so=r.records_only_in_source, to=r.records_only_in_target;
  var pairKey=r.source_file+'|'+r.target_file;
  var totalsNow=fieldsTotalsCache[pairKey];
  var cvLabel=fmt((r.field_results||[]).length);
  var cards='<div class="cards">'+
    card(fmt(r.total_source_records),'Source records','')+
    card(fmt(r.total_target_records),'Target records','')+
    card(fmt(r.records_matched),'Keys matched','ok')+
    card(fmt(so),'Source only',so?'warn':'')+
    card(fmt(to),'Target only',to?'warn':'')+
    card(r.fields_passed,'Fields passed','ok')+
    card(r.fields_failed,'Fields failed',r.fields_failed?'warn':'ok')+
    card(r.pass_rate_pct+'%','Pass rate','blue')+
    cardBtn(cvLabel,'Columns validating','blue','openColumnsValidatedModal',r.name,'cv-tile')+
    '</div>';
  var mapHtml='';
  if(r.mapping){
    var m=r.mapping,ml=m.matched_labels||{},sol=m.source_only_labels||{},tol=m.target_only_labels||{};
    var so2=m.source_only_fields&&m.source_only_fields.length
      ?m.source_only_fields.map(function(f){return '<span class="mtag w" title="'+esc(f)+'">'+(sol[f]||f)+(sol[f]&&sol[f]!==f?'<small>'+f+'</small>':'')+'</span>';}).join('')
      :'<span style="color:var(--muted);font-size:10px">none</span>';
    var to2=m.target_only_fields&&m.target_only_fields.length
      ?m.target_only_fields.map(function(f){return '<span class="mtag w" title="'+esc(f)+'">'+(tol[f]||f)+(tol[f]&&tol[f]!==f?'<small>'+f+'</small>':'')+'</span>';}).join('')
      :'<span style="color:var(--muted);font-size:10px">none</span>';
    var nums=m.numeric_fields&&m.numeric_fields.length
      ?m.numeric_fields.map(function(f){return '<span class="mtag num">'+(ml[f]||f)+'<small>'+f+' +/-'+m.tolerance_map[f]+'</small></span>';}).join('')
      :'<span style="color:var(--muted);font-size:10px">none</span>';
    var crossHtml='';
    if(r.field_mapping_detail&&r.field_mapping_detail.mapped_fields){
      var mappedFields=r.field_mapping_detail.mapped_fields;
      if(mappedFields.length){
        crossHtml='<div class="map-box" style="grid-column:1/-1"><h5>Mapped source → target fields ('+mappedFields.length+')</h5>'+
          mappedFields.map(function(d){return '<span class="mtag '+(d.method==='exact'?'':'cross')+'">'+esc(d.source_label||d.source_field)+
            '<small>'+esc(d.source_field)+' -> '+esc(d.target_field)+'</small>'+
            '<small style="opacity:.7">'+esc(d.method)+'</small></span>';}).join('')+'</div>';
      }
    }
    // Composite join key panel
    var jkeys=r.join_keys||[];
    var jlabels=m.join_key_labels||{};
    var confCls='jk-conf-'+(r.key_detection_method==='manual'?'manual':r.key_confidence||'low');
    var confTxt=r.key_detection_method==='manual'?'manual':'auto ('+esc(r.key_confidence||'low')+')';
    var keysHtml=jkeys.map(function(k,i){
      return (i>0?'<span class="jk-plus">+</span>':'')+
        '<span class="jk-key">'+esc(jlabels[k]||k)+'<small>'+esc(k)+'</small></span>';
    }).join('');
    var dupHtml='';
    if((r.duplicate_src||0)+(r.duplicate_tgt||0)>0){
      var sampRows='';
      if(r.duplicate_key_samples&&r.duplicate_key_samples.length>0){
        var sampCols=Object.keys(r.duplicate_key_samples[0]);
        sampRows='<div class="dup-samples"><table width="100%"><thead><tr>'+
          sampCols.map(function(c){return '<th>'+esc(c)+'</th>';}).join('')+'</tr></thead><tbody>'+
          r.duplicate_key_samples.slice(0,5).map(function(row){
            return '<tr>'+sampCols.map(function(c){return '<td>'+esc(String(row[c]||''))+'</td>';}).join('')+'</tr>';
          }).join('')+'</tbody></table></div>';
      }
      dupHtml='<div class="dup-panel"><strong>Duplicate keys detected</strong>: '+
        fmt(r.duplicate_src||0)+' in source, '+fmt(r.duplicate_tgt||0)+' in target. '+
        'These records share the same composite key — each is still validated separately.'+
        sampRows+'</div>';
    }
    var jkPanel='<div class="jk-panel">'+
      '<div class="jk-header">'+
        '<div>'+
          '<div class="jk-title">Composite join key ('+jkeys.length+' field'+(jkeys.length!==1?'s':'')+')</div>'+
          '<div class="jk-keys" style="margin-top:6px">'+keysHtml+'</div>'+
          '<div class="jk-meta">'+
            '<span>Method: <span class="'+confCls+'">'+confTxt+'</span></span>'+
            (r.key_detection_method!=='manual'?
              '<span>Src uniqueness: <b>'+(((r.mapping&&r.mapping.uniqueness_src)||0)*100).toFixed(1)+'%</b></span>':'')+
            '<span>Duplicates: src=<b>'+fmt(r.duplicate_src||0)+'</b> tgt=<b>'+fmt(r.duplicate_tgt||0)+'</b></span>'+
          '</div>'+
        '</div>'+
        '<button class="jk-edit-btn" onclick="openJoinKeyModal(this.dataset.n)" data-n="'+esc(r.name)+'">Edit join keys</button>'+
      '</div>'+
      dupHtml+
    '</div>';
    mapHtml=jkPanel+'<div class="sec">Field mapping</div><div class="map-grid">'+
      '<div class="map-box"><h5>Numeric fields (auto-tolerance)</h5>'+nums+'</div>'+
      '<div class="map-box"><h5>Source-only (not validated)</h5>'+so2+'</div>'+
      '<div class="map-box"><h5>Target-only (not validated)</h5>'+to2+'</div>'+
      (crossHtml?crossHtml:'')+'</div>';
  }
  // Separate key fields from data fields for grouped display
  var keyFields  = r.field_results.filter(function(fr){return  fr.is_key_field;});
  var dataFields = r.field_results.filter(function(fr){return !fr.is_key_field;});
  var allFields  = keyFields.concat(dataFields);
  var prevGroup  = null;

  var frows=allFields.map(function(fr,i){
    var pct=fr.match_pct,fthr=fr.pass_threshold||thr;
    var bc=pct>=fthr?'var(--pass)':pct>=(fthr*0.8)?'var(--warn)':'var(--fail)';
    var isKey=fr.is_key_field||false;
    var groupHeader='';
    var curGroup=isKey?'key':'data';
    if(curGroup!==prevGroup){
      prevGroup=curGroup;
      groupHeader=isKey
        ?'<tr class="key-group-hdr"><td colspan="8">Join Key Fields (used for record matching)</td></tr>'
        :'<tr class="data-group-hdr"><td colspan="8">Data Fields (validated for value accuracy)</td></tr>';
    }
    var stBadge=isKey?'<span class="bdg-key">KEY</span>':
      (fr.status==='PASS'?'<span class="bdg b-pass">PASS</span>':'<span class="bdg b-fail">FAIL</span>');
    var typeTag=isKey?'<span class="bdg-key" style="font-size:10px">Join Key</span>':
      (fr.type==='numeric'
        ?'<span class="tn">Numeric +/-'+fr.tolerance+'</span>'
        :'<span class="ts">Text</span>');
    var displayName=fr.display_name||fr.field_label||fr.field;
    var isCross=fr.is_cross_mapped||false;
    var techLine=isCross
      ?'<div class="ft">'+esc(fr.field)+' <span style="color:var(--accent)">-></span> '+esc(fr.field_target||'')+'</div>'
      :'<div class="ft">'+esc(fr.field)+'</div>';
    var methodBadge='';
    if(fr.mapping_method&&fr.mapping_method!=='exact'){
      var ml2={alias_object:'alias',alias_global:'global alias',fuzzy:'fuzzy ('+Math.round((fr.mapping_confidence||0)*100)+'%)'};
      methodBadge=' <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--accent-light);color:var(--accent)">'+(ml2[fr.mapping_method]||fr.mapping_method)+'</span>';
    }
    var totalMiss=fr.mismatch_count||(fr.mismatches?fr.mismatches.length:0);
    var issues=fr.mismatched+fr.miss_source+fr.miss_target;
    var hasMiss=totalMiss>0||issues>0;
    var expBtn=hasMiss
      ?'<button class="exp-btn" id="eb-'+i+'" onclick="toggleRow('+i+',event)">'+
        '<i class="arr">&#9658;</i> '+fmt(totalMiss)+' mismatch'+(totalMiss!==1?'es':'')+'</button>'
      :'';
    var missHtml='';
    if(hasMiss&&fr.mismatches&&fr.mismatches.length>0){
      var rows=fr.mismatches.slice(0,20).map(function(m){
        return '<tr><td style="font-family:monospace;font-size:10px;color:var(--muted)">'+esc(String(m.material))+'</td>'+
        '<td class="dold">'+esc(String(m.source_value))+'</td>'+
        '<td class="dnew">'+esc(String(m.target_value))+'</td>'+
        '<td style="font-size:10px;color:var(--muted)">'+esc(m.issue)+'</td></tr>';
      }).join('');
      var moreNote=totalMiss>20?'<div class="more-note">Showing 20 of '+fmt(totalMiss)+' - download Excel for full list.</div>':'';
      missHtml='<div class="miss-inner"><table><thead><tr>'+
        '<th>Key</th><th>Source ('+esc(fr.field)+')</th>'+
        '<th>Target ('+esc(fr.field_target||fr.field)+')</th><th>Issue</th>'+
        '</tr></thead><tbody>'+rows+'</tbody></table>'+moreNote+'</div>';
    }else if(hasMiss){
      missHtml='<div class="miss-inner"><div style="font-size:11px;color:var(--muted);padding:8px">'+
        fmt(issues)+' issue(s). Download Excel for details.</div></div>';
    }
    var detRow=hasMiss
      ?'<tr class="miss-row" id="md-'+i+'" onclick="event.stopPropagation()"><td colspan="8">'+missHtml+'</td></tr>'
      :'';
    var dblAttrs=' ondblclick="openFieldRecords(this.dataset.n,this.dataset.f,this.dataset.s)"'+
      ' data-n="'+esc(r.name)+'" data-f="'+esc(fr.field)+'" data-s="'+esc(fr.status)+'"'+
      ' title="Double-click to view all '+(fr.status==='FAIL'?'error':'matched')+' records in a new tab"';
    return groupHeader+'<tr class="data-row'+(isKey?' key-field-row':'')+'"'+dblAttrs+'>'+

      '<td>'+
        '<div class="fl">'+esc(displayName)+'</div>'+techLine+methodBadge+
        (expBtn?'<div style="margin-top:5px">'+expBtn+'</div>':'')+
      '</td>'+
      '<td>'+typeTag+'</td>'+
      '<td>'+fmt(fr.total)+'</td>'+
      '<td>'+fmt(fr.matched)+'</td>'+
      '<td>'+(hasMiss?'<b style="color:var(--fail)">'+fmt(issues)+'</b>':fmt(issues))+'</td>'+
      '<td><div class="bar-w"><div class="bar-bg"><div class="bar-f" style="width:'+pct+'%;background:'+bc+'"></div></div>'+
        '<span class="bar-v" style="color:'+bc+'">'+pct+'%</span></div></td>'+
      '<td><span style="font-size:10px;color:var(--muted)">>='+fthr+'%</span></td>'+
      '<td>'+stBadge+'</td></tr>'+detRow;
  }).join('');
  var recHtml=renderRecommendations(r);
  det.innerHTML=banner+businessMsg+err+
    '<div class="det-hdr">'+
    '<div><div class="det-title">'+esc(r.name)+'</div>'+
    '<div class="det-meta">'+esc(r.source_file)+' vs '+esc(r.target_file)+
    ' - '+esc(r.run_at)+
    (r.sap_object?' - <span style="color:var(--muted)">'+esc(r.sap_object)+'</span>':'')+
    '</div></div>'+
    '<div class="det-right">'+correctedBtn+dlBtn+'<span class="st-pill '+pc+'">'+r.status+'</span></div></div>'+
    thrHtml+tmplHtml+transformHtml+mapHtml+cards+recHtml+
    '<div class="sec">Field-level results</div>'+
    '<div class="tbl-wrap"><table><thead><tr>'+
    '<th>Field</th><th>Type</th><th>Total</th><th>Matched</th>'+
    '<th>Issues</th><th>Match %</th><th>Threshold</th><th>Status</th>'+
    '</tr></thead><tbody>'+frows+'</tbody></table></div>';
  if(!totalsNow) loadFieldsTotals(r);
}

// Fetch the true common-column count for a pair (independent of the current
// field selection) so the "Columns validated" tile can show N of M. Cached
// per source/target file pair so it's fetched at most once per pair per session.
async function loadFieldsTotals(r){
  var pairKey=r.source_file+'|'+r.target_file;
  try{
    var data=await fetch('/api/fields/from-files',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source_file:r.source_file,target_file:r.target_file,pair_name:r.name})
    }).then(function(x){return x.json();});
    fieldsTotalsCache[pairKey]=data;
  }catch(e){return;}
  if(activeTable===r.name){
    var tile=document.getElementById('cv-tile');
    if(tile){
      var n=tile.querySelector('.n');
      if(n) n.textContent=fmt((r.field_results||[]).length);
    }
  }
}

// Breakdown modal for the "Columns validated" tile: which common columns were
// actually validated vs excluded by the current field selection vs genuinely
// source-only/target-only (the latter reused from r.mapping, same data mapHtml uses).
async function openColumnsValidatedModal(name){
  var r=allResults[name];
  if(!r) return;
  var pairKey=r.source_file+'|'+r.target_file;
  var totals=fieldsTotalsCache[pairKey];
  if(!totals){
    await loadFieldsTotals(r);
    totals=fieldsTotalsCache[pairKey];
  }
  totals=totals||{fields:[],common:0};
  var labelOf={};
  (totals.fields||[]).forEach(function(f){labelOf[f.field]=f.label;});
  var allCommon=(totals.fields||[]).filter(function(f){return f.common;}).map(function(f){return f.field;});
  var validatedSet={};
  (r.field_results||[]).forEach(function(fr){validatedSet[fr.field]=true;});
  var validatedCommon=allCommon.filter(function(c){return validatedSet[c];});
  var notValidated=allCommon.filter(function(c){return !validatedSet[c];});
  var selSet={};
  (r.selected_fields||[]).forEach(function(s){selSet[String(s).toUpperCase()]=true;});
  var hasSelection=(r.selected_fields||[]).length>0;
  var excluded=notValidated.filter(function(c){return hasSelection&&!selSet[c];});
  var otherGap=notValidated.filter(function(c){return !(hasSelection&&!selSet[c]);});
  var crossMapped=(r.field_results||[]).filter(function(fr){return allCommon.indexOf(fr.field)<0;});

  function tagList(codes,cls){
    if(!codes.length) return '<span style="color:var(--muted);font-size:10px">none</span>';
    return codes.map(function(c){
      var lbl=labelOf[c]||c;
      return '<span class="mtag '+(cls||'')+'" title="'+esc(c)+'">'+esc(lbl)+
        (lbl!==c?'<small>'+esc(c)+'</small>':'')+'</span>';
    }).join('');
  }
  var m=r.mapping||{};
  var sol=m.source_only_labels||{}, tol=m.target_only_labels||{};
  var so2=(m.source_only_fields&&m.source_only_fields.length)
    ?m.source_only_fields.map(function(f){return '<span class="mtag w" title="'+esc(f)+'">'+esc(sol[f]||f)+
      (sol[f]&&sol[f]!==f?'<small>'+esc(f)+'</small>':'')+'</span>';}).join('')
    :'<span style="color:var(--muted);font-size:10px">none</span>';
  var to2=(m.target_only_fields&&m.target_only_fields.length)
    ?m.target_only_fields.map(function(f){return '<span class="mtag w" title="'+esc(f)+'">'+esc(tol[f]||f)+
      (tol[f]&&tol[f]!==f?'<small>'+esc(f)+'</small>':'')+'</span>';}).join('')
    :'<span style="color:var(--muted);font-size:10px">none</span>';

  var validatedCount=validatedCommon.length+crossMapped.length;
  document.getElementById('cv-modal-sub').textContent=r.source_file+' vs '+r.target_file;
  document.getElementById('cv-modal-body').innerHTML=
    '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;font-family:var(--font-mono)">'+
      validatedCount+' of '+allCommon.length+' common columns validated'+
      (excluded.length?', '+excluded.length+' excluded by your field selection':'')+'.</div>'+
    '<div class="map-grid">'+
    '<div class="map-box" style="grid-column:1/-1"><h5>Validated ('+validatedCount+')</h5>'+
      tagList(validatedCommon,'')+
      crossMapped.map(function(fr){
        var lbl=fr.display_name||fr.field_label||fr.field;
        return '<span class="mtag cross" title="'+esc(fr.field)+'">'+esc(lbl)+'<small>cross-mapped</small></span>';
      }).join('')+
    '</div>'+
    (excluded.length?'<div class="map-box" style="grid-column:1/-1"><h5>Excluded by selection ('+excluded.length+')</h5>'+tagList(excluded,'w')+'</div>':'')+
    (otherGap.length?'<div class="map-box" style="grid-column:1/-1"><h5>Common but not matched ('+otherGap.length+')</h5>'+tagList(otherGap,'w')+'</div>':'')+
    '<div class="map-box"><h5>Source-only (not validated)</h5>'+so2+'</div>'+
    '<div class="map-box"><h5>Target-only (not validated)</h5>'+to2+'</div>'+
    '</div>';
  document.getElementById('columns-validated-modal').classList.add('open');
}

function openFieldRecords(name,field,status){
  var path=status==='FAIL'?'/field-errors/':'/field-records/';
  window.open(path+encodeURIComponent(name)+'/'+encodeURIComponent(field),'_blank','noopener');
}

function toggleRow(i,event){
  if(event) event.stopPropagation();
  var row=document.getElementById('md-'+i),btn=document.getElementById('eb-'+i);
  if(!row) return;
  var open=row.classList.contains('open');
  row.classList.toggle('open',!open);
  if(btn) btn.classList.toggle('open',!open);
}

// Upload modal
async function openUploadModal(side){
  uploadSide=side;uploadFileQueue=[];
  document.getElementById('upload-modal-title').textContent=
    'Upload '+(side==='source'?'Source':'Target')+' Files';
  document.getElementById('upload-queue').style.display='none';
  document.getElementById('upload-queue-rows').innerHTML='';
  document.getElementById('upload-status').textContent='';
  document.getElementById('upload-file-input').value='';
  var ruleSection=document.getElementById('upload-rule-section');
  var ruleSelect=document.getElementById('upload-rule-object');
  if(side==='source'){
    ruleSection.style.display='block';
    ruleSelect.innerHTML='<option value="">No transformation</option><option disabled>Loading approved rules…</option>';
    try{
      var rulesData=await fetch('/api/transformations').then(function(r){return r.json();});
      var objects=rulesData.approved_objects||[];
      ruleSelect.innerHTML='<option value="">No transformation</option>'+objects.map(function(name){
        return '<option value="'+esc(name)+'">'+esc(name)+' — approved rules</option>';
      }).join('');
    }catch(e){ruleSelect.innerHTML='<option value="">Approved rules unavailable</option>';}
  }else{
    ruleSection.style.display='none';
    ruleSelect.value='';
  }
  document.getElementById('upload-modal').classList.add('open');
}
function onUploadFilesChosen(input){
  if(!input.files||!input.files.length) return;
  uploadFileQueue=Array.from(input.files).map(function(f){return {file:f};});
  document.getElementById('upload-queue-rows').innerHTML=uploadFileQueue.map(function(item){
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;'+
    'padding:9px 12px;margin-bottom:6px;display:flex;align-items:center;gap:10px">'+
    '<span style="font-size:12px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500">'+
    esc(item.file.name)+'</span>'+
    '<span style="font-size:10px;color:var(--muted)">'+fmt(Math.round(item.file.size/1024))+' KB</span></div>';
  }).join('');
  document.getElementById('upload-queue').style.display='block';
}
async function confirmUpload(){
  var st=document.getElementById('upload-status');
  st.style.color='var(--muted)';st.textContent='Uploading...';
  var saved=[],errors=[];
  for(var i=0;i<uploadFileQueue.length;i++){
    var item=uploadFileQueue[i];
    var fd=new FormData();fd.append('file',item.file,item.file.name);
    if(uploadSide==='source') fd.append('rule_object',document.getElementById('upload-rule-object').value||'');
    try{
      var res=await fetch('/api/upload/'+uploadSide,{method:'POST',body:fd});
      var data=await res.json();
      if(data.ok) saved=saved.concat(data.saved||[]);
      else errors.push(data.error||'Error');
    }catch(e){errors.push(String(e));}
  }
  if(errors.length&&!saved.length){st.style.color='var(--fail)';st.textContent='Errors: '+errors.join(', ');return;}
  var selectedRules=uploadSide==='source'?document.getElementById('upload-rule-object').value:'';
  st.style.color='var(--pass)';st.textContent='Uploaded: '+saved.join(', ')+
    (selectedRules?' · '+selectedRules+' rules will apply automatically':'');
  var stEl=document.getElementById(uploadSide==='source'?'src-st':'tgt-st');
  if(stEl){stEl.style.color='var(--pass)';stEl.textContent='OK: '+saved.join(', ');}
  toast('Uploaded to '+uploadSide+': '+saved.join(', ')+
    (selectedRules?' · automatic '+selectedRules+' rules enabled':''),'success');
  setTimeout(function(){closeModal('upload-modal');refresh();},900);
  // Optional refinement, not on the critical path: if this upload just completed a
  // source+target pair, offer the column picker. Never blocks/delays the automatic
  // all-fields validation that scan_and_validate_all() already kicked off server-side.
  checkAndShowFieldPicker(saved).catch(function(){});
}

// Does one of the files we just saved belong to a pair that now has both a source
// and a target on disk? /api/upload/<side> only tells us about the side we uploaded,
// so we cross-check against /api/status's pairs list (has_pair + source_file/target_file)
// to detect "pair just became complete" — there is no explicit signal for this from the
// upload route itself.
async function checkAndShowFieldPicker(savedFiles){
  if(!savedFiles||!savedFiles.length) return;
  var status=await fetch('/api/status').then(function(r){return r.json();});
  var pair=(status.pairs||[]).filter(function(p){
    return p.has_pair&&(savedFiles.indexOf(p.source_file)>=0||savedFiles.indexOf(p.target_file)>=0);
  })[0];
  if(!pair) return;
  await openUploadFieldsPanel(pair.source_file,pair.target_file,pair.name);
}

async function openUploadFieldsPanel(srcFile,tgtFile,pairName){
  var res=await fetch('/api/fields/from-files',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({source_file:srcFile,target_file:tgtFile,pair_name:pairName||''})
  });
  var data=await res.json();
  if(!data.fields||!data.fields.length) return;
  document.getElementById('uf-modal-sub').textContent=
    (pairName?pairName+': ':'')+srcFile+' vs '+tgtFile;
  document.getElementById('uf-summary').textContent=
    data.common+' common column'+(data.common!==1?'s':'')+
    (data.src_only?', '+data.src_only+' source-only':'')+
    (data.tgt_only?', '+data.tgt_only+' target-only':'')+'.';
  document.getElementById('uf-field-st').textContent='';
  renderUploadFieldMappings(data,pairName);
  renderFieldCheckboxes(data.fields,data,'uf-');
  document.getElementById('upload-fields-modal').classList.add('open');
}

function renderUploadFieldMappings(data,pairName){
  uploadFieldMappingState={
    pairName:(pairName||data.pair_name||'').toUpperCase(),
    sourceColumns:data.source_columns||[],targetColumns:data.target_columns||[],
    suggested:data.field_mapping||{}
  };
  var rows=document.getElementById('uf-mapping-rows');
  var targets=uploadFieldMappingState.targetColumns;
  rows.innerHTML=uploadFieldMappingState.sourceColumns.map(function(source){
    var selected=uploadFieldMappingState.suggested[source]||'';
    return '<div class="upload-mapping-row"><div class="upload-mapping-source" title="'+esc(source)+'">'+esc(source)+'</div>'+
      '<div class="upload-mapping-arrow">→</div><select class="uf-map-target" data-source="'+esc(source)+'">'+
      '<option value="">— do not validate —</option>'+targets.map(function(target){
        return '<option value="'+esc(target)+'"'+(target===selected?' selected':'')+'>'+esc(target)+'</option>';
      }).join('')+'</select></div>';
  }).join('')||'<div class="empty-msg">No source columns found.</div>';
  document.getElementById('uf-mapping-st').textContent=data.mapping_is_manual
    ?'Saved pair mapping loaded.':'Suggestions loaded. Review them before validation.';
}

function autoFillUploadMappings(){
  document.querySelectorAll('.uf-map-target').forEach(function(select){
    select.value=uploadFieldMappingState.suggested[select.dataset.source]||'';
  });
}

async function saveUploadMappingAndSelection(){
  var st=document.getElementById('uf-mapping-st');
  var mapping={},used={};
  var duplicate='';
  document.querySelectorAll('.uf-map-target').forEach(function(select){
    if(!select.value||duplicate) return;
    if(used[select.value]){duplicate=select.value;return;}
    mapping[select.dataset.source]=select.value;used[select.value]=true;
  });
  if(duplicate){st.style.color='var(--fail)';st.textContent='Target column '+duplicate+' is selected more than once.';return;}
  if(!Object.keys(mapping).length){st.style.color='var(--fail)';st.textContent='Map at least one source column to a target column.';return;}
  st.style.color='var(--muted)';st.textContent='Saving mapping…';
  try{
    var res=await fetch('/api/field-mappings/'+encodeURIComponent(uploadFieldMappingState.pairName),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapping:mapping})
    });
    var data=await res.json();
    if(!res.ok){st.style.color='var(--fail)';st.textContent=data.error||'Mapping could not be saved.';return;}
    st.style.color='var(--pass)';st.textContent=data.mapped+' mappings saved. Applying field selection…';
    if(document.querySelectorAll('#uf-field-checkboxes input:not(:disabled)').length){
      await saveFieldSelection('uf-','upload-fields-modal');
    }else{
      toast(data.mapped+' field mappings saved and validation started','success');
      setTimeout(function(){closeModal('upload-fields-modal');refresh();},700);
    }
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
}

// Pair manager
async function openPairManager(){
  document.getElementById('pair-modal').classList.add('open');
  document.getElementById('pair-create-status').textContent='';
  await loadPairDropdowns();
  await loadExistingPairs();
}
async function loadPairDropdowns(){
  var data=await fetch('/api/files/list').then(function(r){return r.json();});
  document.getElementById('pair-src-sel').innerHTML=
    '<option value="">-- choose source file --</option>'+
    (data.source_files||[]).map(function(f){return '<option value="'+esc(f)+'">'+esc(f)+'</option>';}).join('');
  document.getElementById('pair-tgt-sel').innerHTML=
    '<option value="">-- choose target file --</option>'+
    (data.target_files||[]).map(function(f){return '<option value="'+esc(f)+'">'+esc(f)+'</option>';}).join('');
}
async function loadExistingPairs(){
  var pairs=await fetch('/api/pairs').then(function(r){return r.json();});
  var el=document.getElementById('existing-pairs-list');
  if(!pairs||!pairs.length){
    el.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px 0">No manual pairs. All pairs are auto-matched by filename.</div>';
    return;
  }
  el.innerHTML=pairs.map(function(p){
    return '<div style="display:flex;align-items:center;gap:9px;padding:9px 12px;'+
    'background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">'+
    '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12px">'+esc(p.name)+'</div>'+
    '<div style="font-size:10px;color:var(--muted);margin-top:2px">'+esc(p.source_file)+' vs '+esc(p.target_file)+'</div></div>'+
    '<button onclick="deletePair(\''+esc(p.name)+'\')" class="t-btn del">Remove</button></div>';
  }).join('');
}
async function createPair(){
  var srcFile=document.getElementById('pair-src-sel').value;
  var tgtFile=document.getElementById('pair-tgt-sel').value;
  var pairName=document.getElementById('pair-name-inp').value.trim().toUpperCase();
  var st=document.getElementById('pair-create-status');
  if(!srcFile){st.style.color='var(--fail)';st.textContent='Select a source file.';return;}
  if(!tgtFile){st.style.color='var(--fail)';st.textContent='Select a target file.';return;}
  if(!pairName){st.style.color='var(--fail)';st.textContent='Enter a pair name (e.g. CUSTOMER).';return;}
  if(srcFile===tgtFile){st.style.color='var(--fail)';st.textContent='Source and target must differ.';return;}
  st.style.color='var(--muted)';st.textContent='Saving...';
  var existing=await fetch('/api/pairs').then(function(r){return r.json();});
  var filtered=existing.filter(function(p){return p.name!==pairName;});
  filtered.push({name:pairName,source_file:srcFile,target_file:tgtFile});
  var res=await fetch('/api/pairs',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pairs:filtered})});
  var data=await res.json();
  if(data.ok){
    st.style.color='var(--pass)';st.textContent='Pair created: '+pairName;
    toast('Pair created: '+pairName,'success');
    await loadExistingPairs();setTimeout(function(){refresh();},400);
  }else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
}
async function deletePair(name){
  await fetch('/api/pairs/'+encodeURIComponent(name),{method:'DELETE'});
  toast('Pair removed: '+name,'info');
  await loadExistingPairs();refresh();
}

// Log / Reports
async function openLog(){
  document.getElementById('log-modal').classList.add('open');
  var activity=await fetch('/api/activity').then(function(r){return r.json();});
  var el=document.getElementById('log-list');
  if(!activity.length){el.innerHTML='<div class="empty-msg">No activity yet.</div>';return;}
  var icons={info:'i',success:'OK',warn:'!',error:'X'};
  el.innerHTML=activity.map(function(e){
    return '<div class="le '+e.level+'"><span class="le-ts">'+e.ts+'</span>'+
    '<span class="le-m">'+(icons[e.level]||'')+' '+esc(e.message)+'</span></div>';
  }).join('');
}
async function openReports(){
  document.getElementById('rep-modal').classList.add('open');
  var list=document.getElementById('rep-list');
  list.innerHTML='<div class="empty-msg">Loading...</div>';
  var reports=await fetch('/api/reports').then(function(r){return r.json();});
  if(!reports.length){list.innerHTML='<div class="empty-msg">No reports yet.</div>';return;}
  list.innerHTML=reports.map(function(rep){
    return '<div class="rep-row"><span class="rep-nm">'+esc(rep.filename)+'</span>'+
    '<span class="rep-mt">'+rep.size_kb+'KB - '+rep.modified+'</span>'+
    '<a class="rep-dl" href="/api/download-file/'+encodeURIComponent(rep.filename)+
    '" download="'+esc(rep.filename)+'">Download</a></div>';
  }).join('');
}

// Settings
async function openSettings(){
  document.getElementById('set-modal').classList.add('open');
  var cfg=await fetch('/api/config').then(function(r){return r.json();});
  document.getElementById('cfg-src').value=cfg.source_dir||'';
  document.getElementById('cfg-tgt').value=cfg.target_dir||'';
  var thr=cfg.pass_threshold||100;
  document.getElementById('thr-slider').value=thr;
  document.getElementById('thr-display').textContent=thr+'%';
  document.getElementById('lbl-current').textContent=
    cfg.labels_file_exists?'Custom labels loaded: '+cfg.labels_file:'Using built-in SAP field dictionary.';
  // Populate file dropdowns from disk
  var srcFiles=cfg.source_files||[], tgtFiles=cfg.target_files||[];
  var srcSel=document.getElementById('fs-src-sel');
  var tgtSel=document.getElementById('fs-tgt-sel');
  srcSel.innerHTML='<option value="">-- select source file --</option>'+
    srcFiles.map(function(f){return '<option value="'+esc(f)+'">'+esc(f)+'</option>';}).join('');
  tgtSel.innerHTML='<option value="">-- select target file --</option>'+
    tgtFiles.map(function(f){return '<option value="'+esc(f)+'">'+esc(f)+'</option>';}).join('');
  if(srcFiles.length===1) srcSel.value=srcFiles[0];
  if(tgtFiles.length===1) tgtSel.value=tgtFiles[0];
  // Show current fields
  var sel=cfg.selected_fields||[];
  var avail=cfg.available_fields||[];
  if(avail.length){
    var enriched=avail.map(function(f){return Object.assign({},f,{selected:sel.length===0||sel.indexOf(f.field)>=0});});
    renderFieldCheckboxes(enriched,{
      common:   enriched.filter(function(f){return f.common;}).length,
      src_only: enriched.filter(function(f){return f.in_source&&!f.in_target;}).length,
      tgt_only: enriched.filter(function(f){return !f.in_source&&f.in_target;}).length,
    });
    var fst=document.getElementById('field-st');
    fst.style.color=sel.length?'var(--pass)':'var(--muted)';
    fst.textContent=sel.length?'Validating '+sel.length+' selected field(s).':'Validating all fields.';
    var info=document.getElementById('fs-file-info');
    if(info&&(srcFiles.length||tgtFiles.length)){
      info.style.display='';
      info.textContent='Currently showing fields from: '+(srcFiles[0]||'?')+' vs '+(tgtFiles[0]||'?')+
        '. Select different files and click Load to change.';
    }
  }else{
    document.getElementById('field-checkboxes').innerHTML=
      '<div style="color:var(--muted);font-size:11px;padding:8px;grid-column:1/-1">Select files above and click Load fields.</div>';
  }
  await loadTemplateList(cfg.active_template||'');
}

function onFsFileChanged(){
  var st=document.getElementById('prev-status');
  var srcFile=document.getElementById('fs-src-sel').value;
  var tgtFile=document.getElementById('fs-tgt-sel').value;
  if(srcFile||tgtFile){
    st.style.color='var(--muted)';
    st.textContent=(srcFile||'(none)')+' vs '+(tgtFile||'(none)')+' - click Load fields.';
  }
}

async function loadFieldsFromSelected(){
  var st=document.getElementById('prev-status');
  var srcFile=document.getElementById('fs-src-sel').value;
  var tgtFile=document.getElementById('fs-tgt-sel').value;
  if(!srcFile&&!tgtFile){st.style.color='var(--warn)';st.textContent='Select at least one file first.';return;}
  st.style.color='var(--muted)';st.textContent='Reading column headers...';
  try{
    var res=await fetch('/api/fields/from-files',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({source_file:srcFile,target_file:tgtFile})
    });
    var data=await res.json();
    if(data.errors&&Object.keys(data.errors).length&&(!data.fields||!data.fields.length)){
      st.style.color='var(--fail)';st.textContent=Object.values(data.errors).join(' | ');return;
    }
    if(!data.fields||!data.fields.length){st.style.color='var(--warn)';st.textContent='No columns found.';return;}
    renderFieldCheckboxes(data.fields,data);
    st.style.color='var(--pass)';
    st.textContent=data.fields.length+' fields loaded - '+
      data.common+' common'+(data.src_only?', '+data.src_only+' source-only':'')+
      (data.tgt_only?', '+data.tgt_only+' target-only':'');
    var info=document.getElementById('fs-file-info');
    if(info){info.style.display='';info.textContent='Fields from: '+(srcFile||'none')+' vs '+(tgtFile||'none');}
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
}

// Template management
async function loadTemplateList(activeTemplate){
  var templates=await fetch('/api/templates').then(function(r){return r.json();});
  var el=document.getElementById('template-list');
  var st=document.getElementById('tmpl-st');
  if(!templates||!templates.length){
    el.innerHTML='<div style="background:var(--surface2);border:1px dashed var(--border);'+
      'border-radius:9px;padding:16px;text-align:center;font-size:12px;color:var(--muted)">'+
      'No templates uploaded yet. Upload a CSV with one field name per row to get started.</div>';
    st.textContent='';st.style.color='var(--muted)';
    return;
  }
  el.innerHTML=templates.map(function(t){
    var isActive=t.is_active||(t.filename===activeTemplate);
    var preview=(t.fields||[]).slice(0,8).map(function(f){return '<code style="font-size:9px;margin:1px">'+esc(f)+'</code>';}).join(' ')+
      (t.field_count>8?' <span style="font-size:9px;color:var(--muted)">+'+(t.field_count-8)+' more</span>':'');
    return '<div class="tmpl-card'+(isActive?' is-active':'')+'">'+
      '<div class="tmpl-info">'+
      '<div class="tmpl-name">'+esc(t.filename)+
      (isActive?'<span class="active-badge">ACTIVE</span>':'')+'</div>'+
      '<div class="tmpl-meta">'+t.field_count+' fields - '+t.modified+'</div>'+
      '<div class="tmpl-fields-preview">'+preview+'</div></div>'+
      '<div class="tmpl-actions">'+
      (isActive
        ?'<button class="t-btn deactivate" onclick="deactivateTemplate()">Deactivate</button>'
        :'<button class="t-btn activate" onclick="activateTemplate(\''+esc(t.filename)+'\')">Activate</button>')+
      '<button class="t-btn del" onclick="deleteTemplate(\''+esc(t.filename)+'\')">Delete</button>'+
      '</div></div>';
  }).join('');
  var active=templates.filter(function(t){return t.is_active||(t.filename===activeTemplate);})[0];
  if(active){st.style.color='var(--pass)';st.textContent='Active: '+active.filename+' ('+active.field_count+' fields)';}
  else{st.style.color='var(--muted)';st.textContent='No template active - validating all fields.';}
}

async function uploadTemplate(input){
  if(!input.files||!input.files.length) return;
  var st=document.getElementById('tmpl-st');
  st.style.color='var(--muted)';st.textContent='Uploading...';
  var fd=new FormData();fd.append('file',input.files[0]);
  try{
    var res=await fetch('/api/templates/upload',{method:'POST',body:fd});
    var data=await res.json();
    if(data.ok){
      st.style.color='var(--pass)';
      st.textContent='Uploaded: '+data.filename+' ('+data.field_count+' fields). Click Activate to use it.';
      toast('Template uploaded: '+data.filename+' ('+data.field_count+' fields)','success');
      var cfg=await fetch('/api/config').then(function(r){return r.json();});
      await loadTemplateList(cfg.active_template||'');
    }else{st.style.color='var(--fail)';st.textContent=data.error||'Upload failed';}
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
  input.value='';
}

async function activateTemplate(filename){
  var st=document.getElementById('tmpl-st');
  st.style.color='var(--muted)';st.textContent='Activating...';
  try{
    var res=await fetch('/api/templates/activate',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:filename})});
    var data=await res.json();
    if(data.ok){
      st.style.color='var(--pass)';st.textContent='Activated: '+filename+' ('+data.field_count+' fields) - re-validating...';
      toast('Template activated: '+filename,'success');
      await loadTemplateList(filename);
      setTimeout(function(){refresh();},1500);
    }else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
}

async function deactivateTemplate(){
  var st=document.getElementById('tmpl-st');
  st.style.color='var(--muted)';st.textContent='Deactivating...';
  try{
    var res=await fetch('/api/templates/activate',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:''})});
    var data=await res.json();
    if(data.ok){
      st.style.color='var(--pass)';st.textContent='Template deactivated - validating all fields.';
      toast('Template deactivated','info');
      await loadTemplateList('');
      setTimeout(function(){refresh();},1500);
    }else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
}

async function deleteTemplate(filename){
  if(!confirm('Delete template "'+filename+'"?')) return;
  var st=document.getElementById('tmpl-st');
  try{
    var res=await fetch('/api/templates/'+encodeURIComponent(filename),{method:'DELETE'});
    var data=await res.json();
    if(data.ok){
      st.style.color='var(--pass)';st.textContent='Template deleted.';
      toast('Deleted: '+filename,'info');
      var cfg=await fetch('/api/config').then(function(r){return r.json();});
      await loadTemplateList(cfg.active_template||'');
      setTimeout(function(){refresh();},800);
    }else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
  }catch(e){st.style.color='var(--fail)';st.textContent='Error: '+e;}
}

// Field selection checkboxes. `prefix` selects which container this instance
// targets ('' = the Settings modal's original #field-checkboxes/#fs-* ids,
// 'uf-' = the post-upload picker's #uf-field-checkboxes/#uf-fs-* ids), so the
// same component can be rendered into more than one panel at once.
function renderFieldCheckboxes(fields,summary,prefix){
  prefix=prefix||'';
  var grid=document.getElementById(prefix+'field-checkboxes');
  var bar=document.getElementById(prefix+'fs-filter-bar');
  currentFsFilter[prefix]='all';
  bar.innerHTML=
    '<button class="fs-btn" style="background:var(--accent);color:#fff;border-color:var(--accent)" '+
    'onclick="setFsFilter(this,\'all\',\''+prefix+'\')">All ('+fields.length+')</button>'+
    (summary&&summary.common?'<button class="fs-btn" onclick="setFsFilter(this,\'common\',\''+prefix+'\')">Common ('+summary.common+')</button>':'')+
    (summary&&summary.src_only?'<button class="fs-btn" onclick="setFsFilter(this,\'src_only\',\''+prefix+'\')">Src only ('+summary.src_only+')</button>':'')+
    (summary&&summary.tgt_only?'<button class="fs-btn" onclick="setFsFilter(this,\'tgt_only\',\''+prefix+'\')">Tgt only ('+summary.tgt_only+')</button>':'');
  if(!fields||!fields.length){
    grid.innerHTML='<div style="color:var(--muted);font-size:11px;padding:8px;grid-column:1/-1">No fields found.</div>';return;
  }
  grid.innerHTML=fields.map(function(f){
    var lbl=f.label&&f.label!==f.field?f.label:f.field;
    var tech=f.label&&f.label!==f.field?'<div class="fc-tech">'+esc(f.field)+'</div>':'';
    var canSel=f.common!==false;
    var role=f.common?'common':(f.in_source?'src_only':'tgt_only');
    var sc=f.in_source?'<span style="font-size:8px;background:var(--pass-bg);color:var(--pass);padding:0 4px;border-radius:3px;margin-left:3px">S</span>':'';
    var tc=f.in_target?'<span style="font-size:8px;background:var(--info-bg);color:var(--info);padding:0 4px;border-radius:3px;margin-left:2px">T</span>':'';
    return '<label class="fc-item"'+(canSel?'':' style="opacity:.45" title="not in both files"')+
      ' data-field="'+f.field.toLowerCase()+'" data-label="'+lbl.toLowerCase()+'" data-role="'+role+'">'+
      '<input type="checkbox" value="'+esc(f.field)+'"'+(f.selected?' checked':'')+(canSel?'':' disabled')+' onchange="updateFsCount(\''+prefix+'\')">'+
      '<span><div class="fc-label">'+esc(lbl)+sc+tc+'</div>'+tech+'</span></label>';
  }).join('');
  updateFsCount(prefix);
}
function setFsFilter(btn,filter,prefix){
  prefix=prefix||'';
  document.querySelectorAll('#'+prefix+'fs-filter-bar .fs-btn').forEach(function(b){
    b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--muted)';});
  btn.style.background='var(--accent)';btn.style.borderColor='var(--accent)';btn.style.color='#fff';
  currentFsFilter[prefix]=filter;filterFieldCheckboxes(prefix);
}
function filterFieldCheckboxes(prefix){
  prefix=prefix||'';
  var q=(document.getElementById(prefix+'fs-search').value||'').toLowerCase();
  var filter=currentFsFilter[prefix]||'all';
  document.querySelectorAll('#'+prefix+'field-checkboxes .fc-item').forEach(function(item){
    var field=item.dataset.field||'',label=item.dataset.label||'',role=item.dataset.role||'';
    item.style.display=((filter==='all'||filter===role)&&(!q||field.indexOf(q)>=0||label.indexOf(q)>=0))?'':'none';
  });
}
function selectAllFields(prefix){prefix=prefix||'';document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled)').forEach(function(cb){cb.checked=true;});updateFsCount(prefix);}
function clearAllFields(prefix){prefix=prefix||'';document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled)').forEach(function(cb){cb.checked=false;});updateFsCount(prefix);}
function selectVisible(prefix){prefix=prefix||'';document.querySelectorAll('#'+prefix+'field-checkboxes .fc-item:not([style*="display: none"]) input:not(:disabled)').forEach(function(cb){cb.checked=true;});updateFsCount(prefix);}
function clearVisible(prefix){prefix=prefix||'';document.querySelectorAll('#'+prefix+'field-checkboxes .fc-item:not([style*="display: none"]) input:not(:disabled)').forEach(function(cb){cb.checked=false;});updateFsCount(prefix);}
function updateFsCount(prefix){
  prefix=prefix||'';
  var en=document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled)');
  var ch=document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled):checked');
  document.getElementById(prefix+'fs-count').textContent=
    (ch.length===en.length&&en.length>0)?'All fields ('+en.length+')':ch.length+' of '+en.length+' selected';
}
function updateThrDisplay(){document.getElementById('thr-display').textContent=document.getElementById('thr-slider').value+'%';}
async function savePaths(){
  var st=document.getElementById('path-st');st.textContent='Saving...';
  var res=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({source_dir:document.getElementById('cfg-src').value,
      target_dir:document.getElementById('cfg-tgt').value})});
  var data=await res.json();
  if(data.ok){st.style.color='var(--pass)';st.textContent='Saved - rescanning...';setTimeout(refresh,800);}
  else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
}
async function saveThreshold(){
  var thr=parseFloat(document.getElementById('thr-slider').value);
  var st=document.getElementById('thr-st');st.textContent='Applying...';
  var res=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pass_threshold:thr})});
  var data=await res.json();
  if(data.ok){st.style.color='var(--pass)';st.textContent='Threshold set to '+thr+'% - re-validating...';
    toast('Threshold: '+thr+'%','info');setTimeout(refresh,800);}
  else{st.style.color='var(--fail)';st.textContent='Failed';}
}
async function saveFieldSelection(prefix,closeModalId){
  prefix=prefix||'';
  var allEn=document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled)');
  var st=document.getElementById(prefix+'field-st');
  if(allEn.length===0){if(st){st.style.color='var(--warn)';st.textContent='No fields loaded yet.';}return;}
  var allCh=document.querySelectorAll('#'+prefix+'field-checkboxes input:not(:disabled):checked');
  var selected=[];allCh.forEach(function(cb){selected.push(cb.value);});
  var toSave=selected.length===allEn.length?[]:selected;
  if(st){st.style.color='var(--muted)';st.textContent='Saving...';}
  try{
    var res=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({selected_fields:toSave})});
    var data=await res.json();
    if(data.ok){
      var lbl=toSave.length?toSave.length+' field(s) selected':'All fields';
      if(st){st.style.color='var(--pass)';st.textContent=lbl+' - re-validating...';}
      toast(lbl+' applied','success');
      if(closeModalId) setTimeout(function(){closeModal(closeModalId);},500);
      setTimeout(refresh,1200);
    }else if(st){st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
  }catch(e){if(st){st.style.color='var(--fail)';st.textContent='Error: '+e;}}
}
async function uploadLabels(input){
  if(!input.files||!input.files.length) return;
  var st=document.getElementById('lbl-st');st.textContent='Uploading...';
  var fd=new FormData();fd.append('file',input.files[0]);
  var res=await fetch('/api/upload/labels',{method:'POST',body:fd});
  var data=await res.json();
  if(data.ok){st.style.color='var(--pass)';st.textContent='Labels applied - re-validating...';
    toast('Custom labels applied','info');setTimeout(refresh,1000);}
  else{st.style.color='var(--fail)';st.textContent=data.error||'Failed';}
  input.value='';
}

async function openTransformModal(){
  document.getElementById('transform-modal').classList.add('open');
  var data=await fetch('/api/transformations').then(function(r){return r.json();});
  var books=data.rulebooks||[];
  document.getElementById('transform-books').innerHTML=books.length?books.map(function(b){
    return '<div style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px">'+
      '<div><b style="font-size:12px">'+esc(b.filename)+'</b><div style="font-size:10px;color:var(--muted)">'+
      (b.error?esc(b.error):fmt(b.rule_count)+' active rules')+'</div></div>'+
      '<button class="fs-btn" onclick="activateTransform(\''+esc(b.filename)+'\')">'+(b.active?'Active ✓':'Activate')+'</button></div>';
  }).join(''):'<div class="empty-msg">No rulebook uploaded yet. Download the example to begin.</div>';
  var fl=await fetch('/api/files/list').then(function(r){return r.json();});
  var pairs=await fetch('/api/pairs').then(function(r){return r.json();});
  document.getElementById('transform-object').innerHTML='<option value="">Pair / object</option>'+pairs.map(function(p){return '<option value="'+esc(p.name)+'">'+esc(p.name)+'</option>';}).join('');
  document.getElementById('transform-source').innerHTML='<option value="">Source file</option>'+(fl.source_files||[]).map(function(f){return '<option value="'+esc(f)+'">'+esc(f)+'</option>';}).join('');
}
async function uploadTransformRules(input){
  if(!input.files.length)return;
  var st=document.getElementById('transform-status');st.textContent='Checking and uploading rulebook…';
  var fd=new FormData();fd.append('file',input.files[0]);
  var res=await fetch('/api/transformations/upload',{method:'POST',body:fd});var data=await res.json();
  st.style.color=res.ok?'var(--pass)':'var(--fail)';
  st.textContent=res.ok?'Activated '+data.filename+' with '+data.rule_count+' rules.':data.error;
  input.value='';if(res.ok){toast('Transformation rulebook activated','success');openTransformModal();}
}
async function activateTransform(filename){
  await fetch('/api/transformations/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:filename})});
  toast('Transformation rulebook activated','success');openTransformModal();
}
async function previewTransform(){
  var objectName=document.getElementById('transform-object').value,sourceFile=document.getElementById('transform-source').value;
  var box=document.getElementById('transform-preview');box.textContent='Calculating preview…';
  var res=await fetch('/api/transformations/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({object_name:objectName,source_file:sourceFile})});
  var data=await res.json();if(!res.ok){box.innerHTML='<div style="color:var(--fail)">'+esc(data.error)+'</div>';return;}
  box.innerHTML='<div style="display:flex;gap:8px;margin-bottom:8px">'+card(fmt(data.applicable_rules),'Applicable rules','')+card(fmt(data.applied_rules),'Rules matched','')+card(fmt(data.changed_rows),'Rows affected','')+card(fmt(data.changed_cells),'Cell changes','')+'</div>'+
    '<div style="max-height:220px;overflow:auto"><table><thead><tr><th>Field</th><th>Source</th><th>Transformed</th><th>Rows</th><th>Status</th></tr></thead><tbody>'+data.audit.map(function(a){return '<tr><td>'+esc(a.source_field||a.SOURCE_FIELD)+' → '+esc(a.target_field||a.TARGET_FIELD)+'</td><td>'+esc(a.source_value||a.SOURCE_VALUE)+'</td><td>'+esc(a.target_value||a.TARGET_VALUE)+'</td><td>'+fmt(a.affected_rows||0)+'</td><td>'+esc(a.status)+'</td></tr>';}).join('')+'</tbody></table></div>';
}
async function applyTransformToSource(){
  var objectName=document.getElementById('transform-object').value,sourceFile=document.getElementById('transform-source').value;
  if(!objectName||!sourceFile){toast('Select a pair and source file first','error');return;}
  if(!confirm('Create a transformed copy of '+sourceFile+'? The original source file will remain unchanged.'))return;
  var box=document.getElementById('transform-preview');box.textContent='Creating transformed source file…';
  var res=await fetch('/api/transformations/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({object_name:objectName,source_file:sourceFile})});
  var data=await res.json();if(!res.ok){box.innerHTML='<div style="color:var(--fail)">'+esc(data.error)+'</div>';return;}
  box.innerHTML='<div class="banner bn-pass"><b>Transformed source created:</b> '+esc(data.filename)+'<br>'+fmt(data.changed_cells)+' cells changed across '+fmt(data.changed_rows)+' rows. Original unchanged.<br><a class="dl-btn" style="display:inline-block;margin-top:8px" href="'+esc(data.download_url)+'" download>Download transformed source</a></div>';
  toast('Transformed source file created','success');
}

// Utilities
function closeModal(id){document.getElementById(id).classList.remove('open');}
['log-modal','rep-modal','set-modal','upload-modal','pair-modal','transform-modal'].forEach(function(id){
  document.getElementById(id).addEventListener('click',function(e){
    if(e.target===this) this.classList.remove('open');
  });
});
function toast(msg,lvl){
  lvl=lvl||'info';
  var el=document.createElement('div');
  el.className='toast '+lvl;
  el.innerHTML='<span class="toast-m">'+esc(msg)+'</span>';
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function(){el.classList.add('rm');setTimeout(function(){el.remove();},230);},5000);
}
function card(val,lbl,cls){return '<div class="card '+cls+'"><div class="n">'+val+'</div><div class="l">'+lbl+'</div></div>';}
function cardBtn(val,lbl,cls,fnName,dataN,id){
  return '<div class="card '+cls+' card-btn"'+(id?' id="'+id+'"':'')+
    ' role="button" tabindex="0" onclick="'+fnName+'(this.dataset.n)" data-n="'+esc(dataN)+'"'+
    ' title="Click to see which columns were validated">'+
    '<div class="n" style="font-family:var(--font-mono)">'+val+'</div><div class="l">'+lbl+'</div></div>';
}
function fmt(n){return Number(n).toLocaleString();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── Join Key Selector ─────────────────────────────────────────────────────────
var _jkName = '';
var _jkSelectedKeys = [];
var _jkAllCols = [];

async function openJoinKeyModal(tableName) {
  _jkName = tableName;
  _jkSelectedKeys = [];
  document.getElementById('jk-modal-name').textContent = tableName;
  document.getElementById('jk-status').textContent = '';
  document.getElementById('jk-suggest-status').textContent = '';
  document.getElementById('jk-suggest-box').style.display = 'none';
  document.getElementById('jk-search').value = '';
  document.getElementById('jk-uniqueness-bar').style.display = 'none';
  document.getElementById('jk-modal').classList.add('open');
  document.getElementById('jk-col-grid').innerHTML =
    '<div style="color:var(--muted);font-size:11px;grid-column:1/-1;padding:8px">Loading columns...</div>';

  // Load common columns from the API
  try {
    var res  = await fetch('/api/join-keys/' + encodeURIComponent(tableName) + '/columns');
    var data = await res.json();
    if (data.error) {
      document.getElementById('jk-col-grid').innerHTML =
        '<div style="color:var(--fail);font-size:11px;grid-column:1/-1;padding:8px">' + esc(data.error) + '</div>';
      return;
    }
    _jkAllCols = data.common_columns || [];
    // Pre-select saved keys
    _jkSelectedKeys = (data.saved_keys || []).slice();
    document.getElementById('jk-col-count').textContent =
      ' (' + _jkAllCols.length + ' common columns)';
    renderJkColGrid();
    renderJkSelectedStrip();
    updateJkUniquenessBar();
  } catch(e) {
    document.getElementById('jk-col-grid').innerHTML =
      '<div style="color:var(--fail);font-size:11px;grid-column:1/-1;padding:8px">Error: ' + esc(String(e)) + '</div>';
  }
}

function renderJkSelectedStrip() {
  var strip = document.getElementById('jk-selected-strip');
  if (!_jkSelectedKeys.length) {
    strip.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic">No keys selected &mdash; click columns below to select</span>';
    return;
  }
  strip.innerHTML = _jkSelectedKeys.map(function(k, i) {
    var col = _jkAllCols.find(function(c) { return c.field === k; });
    var lbl = col ? (col.label !== col.field ? col.label : col.field) : k;
    return '<span class="jk-sel-tag">' +
      (i > 0 ? '<span style="opacity:.5;margin-right:3px;font-size:10px">+</span>' : '') +
      esc(lbl) + '<small style="opacity:.65;margin-left:3px">' + esc(k) + '</small>' +
      '<button onclick="removeJkKey(this.dataset.k)" data-k="' + esc(k) + '" title="Remove">&times;</button>' +
    '</span>';
  }).join('');
}

function removeJkKey(k) {
  _jkSelectedKeys = _jkSelectedKeys.filter(function(x) { return x !== k; });
  renderJkSelectedStrip();
  renderJkColGrid();
  updateJkUniquenessBar();
}

function renderJkColGrid() {
  var grid = document.getElementById('jk-col-grid');
  var q    = (document.getElementById('jk-search').value || '').toLowerCase();
  var sel  = new Set(_jkSelectedKeys);
  var cols = _jkAllCols.filter(function(c) {
    return !q || c.field.toLowerCase().indexOf(q) >= 0 ||
           (c.label || '').toLowerCase().indexOf(q) >= 0;
  });
  if (!cols.length) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;grid-column:1/-1">No columns match.</div>';
    return;
  }
  grid.innerHTML = cols.map(function(c) {
    var isSelected = sel.has(c.field);
    var lbl = c.label && c.label !== c.field ? c.label : c.field;
    var pos = isSelected ? (_jkSelectedKeys.indexOf(c.field) + 1) : null;
    return '<label class="jk-col-item" style="' + (isSelected ? 'background:var(--accent-light);' : '') + '">' +
      '<input type="checkbox" value="' + esc(c.field) + '"' + (isSelected ? ' checked' : '') +
      ' onchange="toggleJkKey(this)">' +
      '<span style="flex:1">' +
        '<div style="font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px">' +
          esc(lbl) +
          (isSelected ? '<span style="background:var(--accent);color:#fff;border-radius:10px;font-size:9px;padding:0 6px;font-weight:700">#' + pos + '</span>' : '') +
        '</div>' +
        (c.label && c.label !== c.field ? '<div style="font-size:9px;color:var(--muted)">' + esc(c.field) + '</div>' : '') +
      '</span></label>';
  }).join('');
}

function filterJkCols() { renderJkColGrid(); }

function toggleJkKey(cb) {
  var k = cb.value;
  if (cb.checked) {
    if (_jkSelectedKeys.indexOf(k) < 0) _jkSelectedKeys.push(k);
  } else {
    _jkSelectedKeys = _jkSelectedKeys.filter(function(x) { return x !== k; });
  }
  renderJkSelectedStrip();
  renderJkColGrid();
  updateJkUniquenessBar();
}

function updateJkUniquenessBar() {
  var bar = document.getElementById('jk-uniqueness-bar');
  bar.style.display = _jkSelectedKeys.length ? 'flex' : 'none';
  // Clear — live uniqueness is shown after suggest
  document.getElementById('jk-u-src').textContent = '-';
  document.getElementById('jk-u-tgt').textContent = '-';
  document.getElementById('jk-u-note').textContent =
    _jkSelectedKeys.length ? 'Click Auto-suggest to see uniqueness score' : '';
}

async function suggestJoinKeys() {
  var st  = document.getElementById('jk-suggest-status');
  var box = document.getElementById('jk-suggest-box');
  st.style.color = 'var(--muted)';
  st.textContent = 'Analysing file columns...';
  box.style.display = 'none';

  try {
    var res  = await fetch('/api/join-keys/' + encodeURIComponent(_jkName) + '/suggest', { method: 'POST' });
    var data = await res.json();
    if (!data.ok) { st.style.color = 'var(--fail)'; st.textContent = data.error || 'Failed'; return; }

    var keys   = data.suggested_keys || [];
    var labels = data.key_labels || {};
    var scores = data.column_scores || [];
    var confCls = data.confidence === 'high' ? 'jk-conf-high' :
                  data.confidence === 'medium' ? 'jk-conf-medium' : 'jk-conf-low';

    // Show uniqueness bar
    document.getElementById('jk-uniqueness-bar').style.display = 'flex';
    document.getElementById('jk-u-src').textContent = data.uniqueness_src + '%';
    document.getElementById('jk-u-tgt').textContent = data.uniqueness_tgt + '%';
    var uNote = document.getElementById('jk-u-note');
    var uMin  = Math.min(data.uniqueness_src, data.uniqueness_tgt);
    uNote.style.color = uMin >= 99 ? 'var(--pass)' : uMin >= 95 ? 'var(--warn)' : 'var(--fail)';
    uNote.textContent = uMin >= 99 ? 'Excellent — 100% unique records' :
                        uMin >= 95 ? 'Good — some duplicates remain' : 'Low — records may have duplicates';

    // Show suggestion box with apply button
    box.style.display = '';
    box._suggested    = keys;
    var keyStr = keys.map(function(k) {
      return '<b>' + esc(labels[k] || k) + '</b>' +
             (labels[k] && labels[k] !== k ? ' <span style="opacity:.7">(' + esc(k) + ')</span>' : '');
    }).join(' <span style="opacity:.5">+</span> ');

    // Column uniqueness table
    var scoreRows = scores.slice(0, 8).map(function(s) {
      var bar = Math.round(s.src_uniqueness);
      var bc  = bar >= 90 ? 'var(--pass)' : bar >= 60 ? 'var(--warn)' : 'var(--fail)';
      return '<tr style="font-size:10px">' +
        '<td style="padding:3px 8px;font-weight:600">' + esc(s.label !== s.field ? s.label : s.field) + '</td>' +
        '<td style="padding:3px 8px;font-family:monospace;color:var(--muted)">' + esc(s.field) + '</td>' +
        '<td style="padding:3px 8px"><div style="display:flex;align-items:center;gap:6px">' +
          '<div style="height:4px;width:60px;background:var(--border);border-radius:2px">' +
            '<div style="height:100%;width:' + bar + '%;background:' + bc + ';border-radius:2px"></div>' +
          '</div>' +
          '<span style="color:' + bc + ';font-weight:600">' + s.src_uniqueness + '%</span>' +
          (s.in_suggestion ? '<span style="background:var(--pass-bg);color:var(--pass);font-size:9px;padding:0 5px;border-radius:10px;font-weight:700">suggested</span>' : '') +
        '</div></td></tr>';
    }).join('');

    box.innerHTML =
      '<div style="margin-bottom:8px"><b>Suggested composite key:</b> ' + keyStr + '</div>' +
      '<div style="font-size:10px;color:var(--pass)">Method: ' + esc(data.detection_method) + ' &nbsp;|&nbsp; ' +
        '<span class="' + confCls + '">' + data.confidence + ' confidence</span> &nbsp;|&nbsp; ' +
        'Duplicates: src=' + data.duplicate_src + ' tgt=' + data.duplicate_tgt + '</div>' +
      (scoreRows ? '<table style="margin-top:8px;width:100%;border-collapse:collapse"><thead>' +
        '<tr style="font-size:9px;color:var(--muted)"><th style="padding:2px 8px;text-align:left">Label</th>' +
        '<th style="padding:2px 8px;text-align:left">Field</th>' +
        '<th style="padding:2px 8px;text-align:left">Uniqueness</th></tr></thead>' +
        '<tbody>' + scoreRows + '</tbody></table>' : '') +
      '<button class="save-btn" style="margin-top:10px;font-size:11px;padding:5px 14px" ' +
        'onclick="applyJkSuggestion()">Use these keys</button>';

    st.style.color  = 'var(--pass)';
    st.textContent  = keys.length + ' key(s) suggested';

    // Reload column list to show scores
    if (data.column_scores && data.column_scores.length) {
      _jkAllCols = data.column_scores.map(function(s) {
        return { field: s.field, label: s.label };
      });
      renderJkColGrid();
    }
  } catch(e) {
    st.style.color = 'var(--fail)';
    st.textContent = 'Error: ' + e;
  }
}

function applyJkSuggestion() {
  var box = document.getElementById('jk-suggest-box');
  if (box._suggested && box._suggested.length) {
    _jkSelectedKeys = box._suggested.slice();
    renderJkSelectedStrip();
    renderJkColGrid();
  }
}

async function saveJoinKeys() {
  var st = document.getElementById('jk-status');
  if (!_jkSelectedKeys.length) {
    st.style.color = 'var(--warn)';
    st.textContent = 'Please select at least one join key column.';
    return;
  }
  st.style.color = 'var(--muted)';
  st.textContent = 'Saving and re-validating...';
  try {
    var res  = await fetch('/api/join-keys/' + encodeURIComponent(_jkName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: _jkSelectedKeys }),
    });
    var data = await res.json();
    if (data.ok) {
      st.style.color = 'var(--pass)';
      st.textContent = 'Saved: ' + _jkSelectedKeys.join(' + ') + ' — re-validating...';
      toast('Join keys set for ' + _jkName + ': ' + _jkSelectedKeys.join(' + '), 'success');
      setTimeout(function() { closeModal('jk-modal'); refresh(); }, 1000);
    } else {
      st.style.color = 'var(--fail)';
      st.textContent = data.error || 'Failed to save';
    }
  } catch(e) {
    st.style.color = 'var(--fail)';
    st.textContent = 'Error: ' + e;
  }
}

async function clearJoinKeys() {
  var st = document.getElementById('jk-status');
  st.style.color = 'var(--muted)';
  st.textContent = 'Clearing...';
  try {
    var res  = await fetch('/api/join-keys/' + encodeURIComponent(_jkName), { method: 'DELETE' });
    var data = await res.json();
    if (data.ok) {
      _jkSelectedKeys = [];
      renderJkSelectedStrip();
      renderJkColGrid();
      st.style.color = 'var(--pass)';
      st.textContent = 'Cleared — system will auto-suggest on next validation';
      toast('Join keys cleared for ' + _jkName, 'info');
      setTimeout(function() { closeModal('jk-modal'); refresh(); }, 1000);
    } else {
      st.style.color = 'var(--fail)';
      st.textContent = data.error || 'Failed';
    }
  } catch(e) {
    st.style.color = 'var(--fail)';
    st.textContent = 'Error: ' + e;
  }
}

document.getElementById('jk-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});


// ── LTMC Validation ──────────────────────────────────────────────────────────
var _ltmcFile = '';
var _ltmcSheets = [];
var _ltmcJoinKeys = [];

async function openLtmcModal() {
  document.getElementById('ltmc-modal').classList.add('open');
  document.getElementById('ltmc-run-status').textContent = '';
  document.getElementById('ltmc-results-panel').style.display = 'none';
  // Load existing target files for postload dropdown
  try {
    var fl = await fetch('/api/files/list').then(function(r){return r.json();});
    var sel = document.getElementById('ltmc-postload-sel');
    sel.innerHTML = '<option value="">-- select target file --</option>' +
      (fl.target_files||[]).map(function(f){
        return '<option value="'+esc(f)+'">'+esc(f)+'</option>';
      }).join('');
  } catch(e) {}
  // Load existing XML files
  try {
    var xmlFiles = await fetch('/api/ltmc/list').then(function(r){return r.json();});
    if(xmlFiles.length) {
      document.getElementById('ltmc-xml-status').textContent =
        'Previously uploaded: ' + xmlFiles.map(function(f){return f.filename;}).join(', ');
      // Use most recent
      _ltmcFile = xmlFiles[0].filename;
      if(xmlFiles[0].parsed && xmlFiles[0].sheets.length) {
        _ltmcSheets = xmlFiles[0].sheets.map(function(s){return {sheet_name:s, row_count:0, columns:[]};});
        renderLtmcSheets(xmlFiles[0].sheets.map(function(s){
          return {sheet_name:s, row_count:'?', col_count:'?', columns:[]};
        }));
      }
    }
  } catch(e) {}
}

async function uploadLtmcXml(input) {
  if(!input.files||!input.files.length) return;
  var st = document.getElementById('ltmc-xml-status');
  st.style.color = 'var(--muted)'; st.textContent = 'Uploading and parsing...';
  var fd = new FormData(); fd.append('file', input.files[0]);
  try {
    var res  = await fetch('/api/ltmc/upload', {method:'POST', body:fd});
    var data = await res.json();
    if(data.ok) {
      _ltmcFile   = data.filename;
      _ltmcSheets = data.sheets;
      st.style.color = 'var(--pass)';
      st.textContent = 'Parsed: ' + data.filename + ' — ' + data.total_sheets + ' sheet(s) found';
      renderLtmcSheets(data.sheets);
      toast('LTMC XML parsed: ' + data.total_sheets + ' sheet(s)', 'success');
    } else {
      st.style.color = 'var(--fail)'; st.textContent = data.error || 'Failed';
    }
  } catch(e) { st.style.color='var(--fail)'; st.textContent='Error: '+e; }
  input.value = '';
}

function renderLtmcSheets(sheets) {
  var panel = document.getElementById('ltmc-sheets-panel');
  var list  = document.getElementById('ltmc-sheets-list');
  var sel   = document.getElementById('ltmc-sheet-sel');
  panel.style.display = '';
  list.innerHTML = sheets.map(function(s) {
    return '<div style="display:inline-flex;align-items:center;gap:6px;background:#ccfbf1;' +
      'border:1px solid rgba(15,118,110,.25);border-radius:6px;padding:4px 10px;' +
      'margin:2px;font-size:11px;font-weight:600;color:#0f766e">' +
      esc(s.sheet_name) +
      '<span style="font-weight:400;color:var(--muted)">' +
      (s.row_count || '?') + ' rows, ' + (s.col_count || (s.columns||[]).length) + ' cols</span></div>';
  }).join('');
  sel.innerHTML = '<option value="">-- select a sheet --</option>' +
    sheets.map(function(s){
      return '<option value="'+esc(s.sheet_name)+'">'+esc(s.sheet_name)+
        ' ('+(s.row_count||'?')+' rows)</option>';
    }).join('');
  onLtmcSheetChange();
}

function onLtmcSheetChange() {
  var sheet    = document.getElementById('ltmc-sheet-sel').value;
  var postload = document.getElementById('ltmc-postload-sel').value;
  var canResolve = sheet && postload && _ltmcFile;
  document.getElementById('ltmc-resolve-btn').disabled = !canResolve;
  document.getElementById('ltmc-validate-btn').disabled = !canResolve;
  document.getElementById('ltmc-resolution-panel').style.display = 'none';

  // Populate suggested join keys from sheet columns
  if(sheet && _ltmcSheets.length) {
    var sheetData = _ltmcSheets.find(function(s){return s.sheet_name===sheet;});
    if(sheetData && sheetData.columns && sheetData.columns.length) {
      renderLtmcColHints(sheetData.columns);
    }
  }
}

function renderLtmcColHints(columns) {
  var container = document.getElementById('ltmc-jk-cols');
  // Show column pills as clickable suggestions (not pre-selected)
  container.innerHTML = '<span style="font-size:10px;color:var(--muted);margin-right:4px">Available:</span>' +
    columns.slice(0,12).map(function(c) {
      return '<span onclick="ltmcAddJkKey(this.dataset.k)" data-k="'+esc(c)+'" title="Click to add as join key" ' +
        'style="cursor:pointer;background:var(--surface2);border:1px solid var(--border);' +
        'border-radius:5px;padding:2px 8px;font-size:10px;font-weight:500;color:var(--muted)">' +
        esc(c) + '</span>';
    }).join('') +
    (columns.length > 12 ? '<span style="font-size:10px;color:var(--muted)">+' + (columns.length-12) + ' more</span>' : '');
}

function ltmcAddJkKey(key) {
  key = key.trim().toUpperCase();
  if(!key || _ltmcJoinKeys.indexOf(key) >= 0) return;
  _ltmcJoinKeys.push(key);
  renderLtmcJkTags();
  document.getElementById('ltmc-jk-input').value = '';
}

function ltmcAddJkOnEnter(event) {
  if(event.key === 'Enter') {
    var val = document.getElementById('ltmc-jk-input').value.trim().toUpperCase();
    if(val) { ltmcAddJkKey(val); }
    event.preventDefault();
  }
}

function renderLtmcJkTags() {
  var container = document.getElementById('ltmc-jk-cols');
  if(!_ltmcJoinKeys.length) {
    container.innerHTML = '<span style="font-size:10px;color:var(--muted)">No keys added — will auto-detect</span>';
    return;
  }
  container.innerHTML = _ltmcJoinKeys.map(function(k) {
    return '<span class="jk-sel-tag" onclick="ltmcRemoveJkKey(this.dataset.k)" data-k="'+esc(k)+'">'+
      esc(k)+'<button>&times;</button></span>';
  }).join('');
}

function ltmcRemoveJkKey(key) {
  _ltmcJoinKeys = _ltmcJoinKeys.filter(function(k){return k!==key;});
  renderLtmcJkTags();
}

async function uploadLtmcPostload(input) {
  if(!input.files||!input.files.length) return;
  var fd = new FormData(); fd.append('file', input.files[0]);
  try {
    var res  = await fetch('/api/upload/target', {method:'POST', body:fd});
    var data = await res.json();
    if(data.ok) {
      toast('Post-load file uploaded: ' + data.saved.join(', '), 'success');
      // Add to dropdown
      var sel = document.getElementById('ltmc-postload-sel');
      var newOpt = document.createElement('option');
      newOpt.value = data.saved[0]; newOpt.textContent = data.saved[0]; newOpt.selected = true;
      sel.appendChild(newOpt);
      onLtmcSheetChange();
    }
  } catch(e) { toast('Upload error: '+e, 'error'); }
  input.value='';
}

async function ltmcResolveColumns() {
  var sheet    = document.getElementById('ltmc-sheet-sel').value;
  var postload = document.getElementById('ltmc-postload-sel').value;
  var st       = document.getElementById('ltmc-resolve-status');
  st.style.color = 'var(--muted)'; st.textContent = 'Resolving columns...';
  try {
    var res  = await fetch('/api/ltmc/resolve', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ltmc_file:_ltmcFile, sheet_name:sheet, postload_file:postload})
    });
    var data = await res.json();
    if(data.error) { st.style.color='var(--fail)'; st.textContent=data.error; return; }

    st.style.color='var(--pass)';
    st.textContent = data.match_count + ' of ' + data.ltmc_columns.length +
      ' LTMC fields matched (' + data.coverage_pct + '% coverage)';

    renderLtmcResolution(data);
    document.getElementById('ltmc-validate-btn').disabled = false;
  } catch(e) { st.style.color='var(--fail)'; st.textContent='Error: '+e; }
}

function renderLtmcResolution(data) {
  var panel   = document.getElementById('ltmc-resolution-panel');
  var content = document.getElementById('ltmc-resolution-content');
  panel.style.display = '';

  var matchedRows = Object.entries(data.matched).map(function(entry) {
    var postCol = entry[0], info = entry[1];
    var methodBadge = info.method === 'exact'
      ? '<span style="background:var(--pass-bg);color:var(--pass);font-size:9px;padding:1px 6px;border-radius:10px">exact</span>'
      : '<span style="background:var(--accent-light);color:var(--accent);font-size:9px;padding:1px 6px;border-radius:10px">'+esc(info.method)+'</span>';
    return '<tr><td style="padding:5px 9px;font-family:monospace;font-size:11px;color:var(--pass);font-weight:600">'+esc(info.ltmc_col)+'</td>'+
      '<td style="padding:5px 9px;font-size:11px">'+esc(postCol)+'</td>'+
      '<td style="padding:5px 9px">'+methodBadge+'</td></tr>';
  }).join('');

  var unmatchedLtmc = (data.unmatched_ltmc||[]).map(function(c) {
    return '<span style="background:var(--warn-bg);color:var(--warn);border:1px solid rgba(217,119,6,.25);'+
      'border-radius:5px;padding:2px 8px;font-size:10px;font-weight:600;margin:2px;display:inline-block">'+esc(c)+'</span>';
  }).join('') || '<span style="color:var(--muted);font-size:11px">none</span>';

  var unmatchedPost = Object.keys(data.unmatched_postload||{}).map(function(c) {
    return '<span style="background:var(--surface2);border:1px solid var(--border);'+
      'border-radius:5px;padding:2px 8px;font-size:10px;color:var(--muted);margin:2px;display:inline-block">'+esc(c)+'</span>';
  }).join('') || '<span style="color:var(--muted);font-size:11px">none</span>';

  content.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px">'+
    '<table width="100%"><thead>'+
    '<tr style="background:var(--pass-bg)"><th style="padding:6px 9px;font-size:10px;font-weight:700;text-align:left;color:var(--pass);border-bottom:1px solid rgba(22,163,74,.2)">LTMC Field</th>'+
    '<th style="padding:6px 9px;font-size:10px;font-weight:700;text-align:left;color:var(--pass);border-bottom:1px solid rgba(22,163,74,.2)">Post-load Column</th>'+
    '<th style="padding:6px 9px;font-size:10px;font-weight:700;text-align:left;color:var(--pass);border-bottom:1px solid rgba(22,163,74,.2)">Match method</th>'+
    '</tr></thead><tbody>'+matchedRows+'</tbody></table></div>'+
    '<div style="margin-bottom:8px"><span style="font-size:10px;font-weight:700;color:var(--warn);text-transform:uppercase;letter-spacing:.05em">LTMC fields not in post-load: </span>'+unmatchedLtmc+'</div>'+
    '<div><span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Post-load cols not in LTMC: </span>'+unmatchedPost+'</div>';
}

async function runLtmcValidation() {
  var sheet    = document.getElementById('ltmc-sheet-sel').value;
  var postload = document.getElementById('ltmc-postload-sel').value;
  var st       = document.getElementById('ltmc-run-status');
  var btn      = document.getElementById('ltmc-validate-btn');

  st.style.color = 'var(--muted)'; st.textContent = 'Running validation...';
  btn.disabled = true;

  try {
    var res  = await fetch('/api/ltmc/validate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        ltmc_file:      _ltmcFile,
        sheet_name:     sheet,
        postload_file:  postload,
        join_keys:      _ltmcJoinKeys,
        pass_threshold: parseFloat(document.getElementById('thr-slider').value||100),
      })
    });
    var data = await res.json();
    btn.disabled = false;

    if(data.error) {
      st.style.color = 'var(--fail)'; st.textContent = data.error; return;
    }

    var pc = data.status==='PASS'?'var(--pass)':data.status==='WARNING'?'var(--warn)':'var(--fail)';
    st.style.color = pc;
    st.textContent = data.status + ' — ' + data.business_message;

    toast('LTMC validation: ' + data.status + ' — ' + sheet, data.status==='PASS'?'success':'warn');
    renderLtmcResults(data);
  } catch(e) {
    btn.disabled = false;
    st.style.color = 'var(--fail)'; st.textContent = 'Error: ' + e;
  }
}

function renderLtmcResults(data) {
  var panel = document.getElementById('ltmc-results-panel');
  panel.style.display = '';

  var pc = data.status==='PASS'?'pill-pass':data.status==='WARNING'?'pill-warn':'pill-fail';
  var dlBtn = data.excel_file
    ? '<a class="rep-dl" href="/api/download-file/'+encodeURIComponent(data.excel_file)+'" download="'+esc(data.excel_file)+'">Download Excel</a>'
    : '';

  var jkHtml = (data.join_keys||[]).map(function(k) {
    return '<span class="jk-key">'+esc(k)+'</span>';
  }).join('<span class="jk-plus">+</span>');

  var frows = (data.field_results||[]).map(function(fr) {
    var pct = fr.match_pct, fthr = fr.pass_threshold||100;
    var bc  = pct>=fthr?'var(--pass)':pct>=(fthr*0.8)?'var(--warn)':'var(--fail)';
    var isKey = fr.is_key_field||false;
    var badge = isKey ? '<span class="bdg-key">KEY</span>'
      : (fr.status==='PASS'?'<span class="bdg b-pass">PASS</span>':'<span class="bdg b-fail">FAIL</span>');
    var resolution = fr.resolution_method && fr.resolution_method!=='exact'
      ? '<span style="font-size:9px;background:var(--accent-light);color:var(--accent);padding:0 5px;border-radius:4px">'+esc(fr.resolution_method)+'</span>'
      : '';
    return '<tr class="data-row'+(isKey?' key-field-row':'')+'">'+
      '<td><div class="fl">'+esc(fr.field_label||fr.field)+'</div>'+
        '<div class="ft">'+esc(fr.field)+(fr.postload_original_col&&fr.postload_original_col!==fr.field?' &rarr; '+esc(fr.postload_original_col):'')+' '+resolution+'</div></td>'+
      '<td>'+fmt(fr.total)+'</td>'+
      '<td>'+fmt(fr.matched)+'</td>'+
      '<td>'+(fr.mismatched>0?'<b style="color:var(--fail)">'+fmt(fr.mismatched)+'</b>':fmt(fr.mismatched))+'</td>'+
      '<td><div class="bar-w"><div class="bar-bg"><div class="bar-f" style="width:'+pct+'%;background:'+bc+'"></div></div>'+
        '<span class="bar-v" style="color:'+bc+'">'+pct+'%</span></div></td>'+
      '<td>'+badge+'</td></tr>';
  }).join('');

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
    '<div><div style="font-size:16px;font-weight:700">'+esc(data.sheet_name)+'</div>'+
    '<div style="font-size:11px;color:var(--muted)">'+esc(data.ltmc_file)+' vs '+esc(data.postload_file)+'</div></div>'+
    '<div style="display:flex;gap:7px;align-items:center">'+dlBtn+'<span class="st-pill '+pc+'">'+data.status+'</span></div></div>'+

    '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap">'+
    '<span class="info-bar">Join keys: '+(jkHtml||'<span style="font-style:italic">auto-detected</span>')+
    ' &nbsp;|&nbsp; Method: <b>'+esc(data.key_detection_method||'auto')+'</b></span>'+
    (data.resolution_summary?'<span class="tmpl-bar">'+data.resolution_summary.matched_count+' fields resolved</span>':'')+'</div>'+

    '<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(100px,1fr));margin-bottom:14px">'+
    card(fmt(data.total_source_records),'LTMC rows','')+
    card(fmt(data.total_target_records),'Post-load rows','')+
    card(fmt(data.records_matched),'Matched','ok')+
    card(fmt(data.records_only_in_source),'LTMC only',data.records_only_in_source?'warn':'')+
    card(fmt(data.records_only_in_target),'Post-load only',data.records_only_in_target?'warn':'')+
    card(data.pass_rate_pct+'%','Pass rate','blue')+
    '</div>'+

    '<div class="tbl-wrap"><table><thead><tr>'+
    '<th>Field</th><th>Total</th><th>Matched</th><th>Mismatch</th><th>Match %</th><th>Status</th>'+
    '</tr></thead><tbody>'+frows+'</tbody></table></div>';
}

document.getElementById('ltmc-modal').addEventListener('click', function(e){
  if(e.target===this) this.classList.remove('open');
});

init();
