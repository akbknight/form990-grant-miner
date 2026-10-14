(function(){
  const parts=window.__RECIPIENT_GRANTS_JSON_PARTS||[];
  if(!parts.length) throw new Error('RECIPIENT_GRANTS data chunks missing');
  window.RECIPIENT_GRANTS=JSON.parse(parts.join(''));
  window.__RECIPIENT_GRANTS_JSON_PARTS=null;
})();
