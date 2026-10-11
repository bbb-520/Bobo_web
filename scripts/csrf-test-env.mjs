// Existing business fixtures exercise their own HTTP contracts. Supply the new
// CSRF handshake separately; test-rbac-http.mjs tests that handshake directly.
let current=globalThis.fetch;
Object.defineProperty(globalThis,'fetch',{
  configurable:true,
  get(){return current;},
  set(mock){current=async(url,init)=>{
    if(String(url).endsWith('/api/auth/csrf')) {
      init?.signal?.throwIfAborted();
      return Response.json({token:'fixture-csrf-token',headerName:'X-XSRF-TOKEN'});
    }
    return mock(url,init);
  };},
});
