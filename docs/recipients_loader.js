(function(){
  const parts=window.__RECIPIENTS_JSON_PARTS||[];
  if(!parts.length) throw new Error('RECIPIENTS data chunks missing');
  window.RECIPIENTS=JSON.parse(parts.join(''));
  window.__RECIPIENTS_JSON_PARTS=null;
})();
