let currentPage=1,currentPages=1,currentRows=[],currentColumns=[];
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function init(){
  try{
    const response=await fetch('/api/database/tables'),data=await response.json();
    if(!response.ok) throw new Error(data.error||'Database unavailable');
    tableSelect.innerHTML=data.tables.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    tableSelect.onchange=()=>loadTable(1);pageSize.onchange=()=>loadTable(1);filter.oninput=renderRows;
    await loadTable(1);
  }catch(error){showError(error.message)}
}
async function loadTable(page){
  if(page<1)return;error.style.display='none';sheet.innerHTML='<div class="loading">Loading rows...</div>';
  const table=tableSelect.value,size=pageSize.value;
  try{
    const response=await fetch(`/api/database/table/${encodeURIComponent(table)}?page=${page}&page_size=${size}`),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Unable to read table');
    currentPage=data.page;currentPages=data.pages;currentRows=data.rows;currentColumns=data.columns;filter.value='';
    summary.textContent=`${Number(data.total).toLocaleString()} total records`;
    pageText.textContent=`Page ${data.page} of ${data.pages}`;prev.disabled=data.page<=1;next.disabled=data.page>=data.pages;
    exportBtn.href=`/api/database/export/${encodeURIComponent(table)}`;renderRows();
  }catch(error){showError(error.message)}
}
function renderRows(){
  const term=filter.value.toLowerCase();
  const rows=currentRows.filter(row=>!term||currentColumns.some(col=>String(row[col]??'').toLowerCase().includes(term)));
  const head='<thead><tr>'+currentColumns.map(col=>`<th>${esc(col)}</th>`).join('')+'</tr></thead>';
  const body='<tbody>'+rows.map(row=>'<tr>'+currentColumns.map(col=>`<td title="${esc(row[col])}">${esc(row[col])}</td>`).join('')+'</tr>').join('')+'</tbody>';
  sheet.innerHTML=`<table>${head}${body}</table>`;
}
function showError(message){error.textContent=message;error.style.display='block';sheet.innerHTML='';}
init();
