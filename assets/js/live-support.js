(() => {
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {pending:'Aguardando',sent:'Enviada',delivered:'Entregue',read:'Lida',failed:'Falhou'};
  const sessionLabels = {created:'Não conectado',initializing:'Iniciando',qr_ready:'Aguardando leitura do QR',authenticating:'Autenticando',ready:'Conectado',disconnected:'Desconectado',action_required:'Ação necessária no celular',failed:'Falha na conexão'};
  const now = () => Math.floor(Date.now()/1000);
  const permissions = role => ({send:['admin','atendente'].includes(role),connect:role==='admin'});
  class MockProvider {
    constructor() {
      this.mock=true; this.role='admin'; this.status='ready'; this.listener=()=>{};
      this.contacts=[{id:'551100000001@c.us',name:'João Silva',last:'Podemos combinar a entrega?',unread:2,tag:'Pedido #0127'},
        {id:'551100000002@c.us',name:'Construtora Horizonte',last:'Qual é a previsão do lote?',unread:1,tag:'Pedido #0128'},
        {id:'551100000003@c.us',name:'Mariana Costa',last:'Obrigada pelo atendimento!',unread:0,tag:'Cliente'}];
      this.messages=new Map(this.contacts.map((c,i)=>[c.id,[{id:'seed-'+i,chatId:c.id,text:i===0?'Olá! Meu pedido já está pronto?':'Bom dia, equipe EcoBrik!',mine:false,timestamp:now()-86400,status:'read'},
        {id:'seed-out-'+i,chatId:c.id,text:'Olá! Vou conferir as informações para você.',mine:true,timestamp:now()-600,status:'read'},
        {id:'seed-last-'+i,chatId:c.id,text:c.last,mine:false,timestamp:now()-180,status:'delivered'}]]));
    }
    async me(){return {role:this.role,email:'perfil de demonstração'};}
    async chats(offset=0){const all=this.role==='atendente'?this.contacts.slice(0,2):this.contacts;return {items:all.slice(offset,offset+100),nextOffset:null};}
    async history(id){if(this.role==='atendente'&&id===this.contacts[2].id)throw Error('Conversa não autorizada.');return {items:[...(this.messages.get(id)||[])],nextOffset:null};}
    async send(id,text){if(!permissions(this.role).send)throw Error('Perfil sem permissão para enviar.');if(this.status!=='ready')throw Error('Conecte a sessão de demonstração antes de enviar.');const m={id:crypto.randomUUID(),chatId:id,text,mine:true,timestamp:now(),status:'sent'};this.messages.get(id).push(m);this.contacts.find(c=>c.id===id).last=text;
      setTimeout(()=>{m.status='delivered';this.listener({type:'message.ack',chatId:id});},800);return {id:m.id,timestamp:m.timestamp,status:m.status};}
    receive(id){const c=this.contacts.find(c=>c.id===id),m={id:crypto.randomUUID(),chatId:id,text:'Mensagem recebida de demonstração: pode confirmar a previsão da entrega?',mine:false,timestamp:now(),status:'delivered'};this.messages.get(id).push(m);c.last=m.text;c.unread++;this.listener({type:'message.received',chatId:id});}
    async connection(){return {status:this.status};}
    async start(){if(this.role!=='admin')throw Error('Somente administradores podem conectar.');this.status='qr_ready';this.listener({type:'session.status'});}
    async stop(){if(this.role!=='admin')throw Error('Sem permissão.');this.status='disconnected';this.listener({type:'session.status'});}
    complete(){if(this.role!=='admin')return;this.status='ready';this.listener({type:'session.status'});}
    subscribe(listener){this.listener=listener;return ()=>this.listener=()=>{};}
  }
  class RemoteProvider {
    constructor(config){this.mock=false;this.config=config;this.base=config.url.replace(/\/$/,'');this.abort=new AbortController();}
    async request(path,method='GET',body,signal){const token=await this.config.getToken();if(!token)throw Error('Entre com sua conta Google autorizada.');const response=await fetch(this.base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)]),cache:'no-store',redirect:'error'});if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Falha no serviço de atendimento.');}return response;}
    async json(path,method,body){return (await this.request(path,method,body)).json();}
    me(){return this.json('/me');}chats(offset=0){return this.json('/chats?offset='+offset);}history(id,offset=0){return this.json('/chats/'+encodeURIComponent(id)+'/messages?offset='+offset);}send(id,text){return this.json('/chats/'+encodeURIComponent(id)+'/messages','POST',{text});}
    connection(){return this.json('/connection');}start(){return this.json('/connection/start','POST');}stop(){return this.json('/connection/stop','POST');}
    subscribe(listener,onError){let stopped=false;const run=async()=>{while(!stopped){try{const response=await this.request('/events','GET',undefined,this.abort.signal),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';listener({type:'transport.ready'});while(!stopped){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);const data=block.split('\n').find(s=>s.startsWith('data: '));if(data)listener(JSON.parse(data.slice(6)));}}}catch(e){if(!stopped)onError(e);}if(!stopped)await new Promise(r=>setTimeout(r,3000));}};run();return ()=>{stopped=true;this.abort.abort();};}
  }
  function layout(){return `<section class="support-banner"><div><strong>Atendimento EcoBrik</strong><span id="support-mode">Carregando atendimento…</span></div><div class="support-controls"><label id="demo-role-label" hidden>Perfil simulado<select id="support-role"><option value="admin">Administrador</option><option value="atendente">Atendente · 2 conversas</option><option value="leitura">Somente leitura</option></select></label><button class="btn" id="support-connection" disabled>Conexão / QR Code</button></div></section><p id="support-error" role="alert" class="support-error" hidden></p><div class="support-workspace"><aside class="support-inbox"><div class="inbox-head"><h2>Conversas</h2><span id="support-count" class="badge neutral">0</span></div><label class="support-search"><input id="support-search" type="search" placeholder="Buscar conversa" aria-label="Buscar conversa"></label><div class="inbox-tabs"><button class="active" data-filter="all">Todas</button><button data-filter="unread">Não lidas</button></div><div id="support-contacts" class="support-contact-list"></div><button class="btn load-more" id="support-more-chats" hidden>Mais conversas</button><p class="inbox-foot">Acesso definido pelo perfil do usuário</p></aside><section class="support-thread"><header class="support-thread-head"><button id="support-back" class="icon-btn" aria-label="Voltar às conversas">←</button><span class="avatar" id="support-avatar">E</span><div><h2 id="support-name">Selecione uma conversa</h2><small id="support-tag">Atendimento comercial</small></div><span id="support-status" class="badge neutral">Carregando</span></header><div class="support-history" id="support-history" role="log" aria-label="Histórico da conversa" aria-live="polite"></div><button id="support-more-messages" class="btn load-more" hidden>Carregar mensagens anteriores</button><div class="support-tools"><button id="support-receive" class="btn" hidden>Simular recebimento</button><span id="support-permission"></span></div><form id="support-compose" class="support-compose"><label class="sr-only" for="support-message">Mensagem</label><textarea id="support-message" placeholder="Escreva uma mensagem…" rows="2" maxlength="4000" required disabled></textarea><button id="support-send" class="btn primary" disabled>Enviar ↗</button></form><p id="support-footnote" class="support-footnote">Conexão com o servidor ainda não configurada.</p></section></div><dialog id="support-qr-dialog"><div class="dialog-head"><h2>Conectar WhatsApp</h2><button id="support-close-qr" class="icon-btn" aria-label="Fechar conexão">×</button></div><div id="support-qr-body"></div><div class="support-qr-actions"><button id="support-start" class="btn primary">Gerar QR Code</button><button id="support-stop" class="btn">Desconectar</button></div></dialog>`;}
  let dispose=()=>{};
  function unmount(){dispose();dispose=()=>{};}
  async function mount(){
    unmount();
    const $=id=>document.getElementById(id),config=window.EcobrikSupportConfig;
    let provider;
    if(config?.url){try{const u=new URL(config.url);if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||typeof config.getToken!=='function')throw Error();provider=new RemoteProvider(config);}catch{$('support-error').hidden=false;$('support-error').textContent='Configuração do servidor inválida. Configure HTTPS e login Google; não há retorno automático à demonstração.';return;}}
    else if(window.EcobrikHosted){$('support-mode').textContent='Conexão pendente';$('support-error').hidden=false;$('support-error').textContent='O serviço de atendimento ainda não foi configurado. As conversas aparecerão aqui depois da conexão.';return;}
    else {provider=new MockProvider();provider.role=({admin:'admin',operador:'atendente',leitura:'leitura'})[window.EcobrikHosted.user.role];}
    let user,connection={status:'disconnected'},chats=[],current=null,filter='all',chatOffset=null,messageOffset=null,threadVersion=0,sending=false,disposed=false;
    let poll,eventTimer,eventRunning=false,pending={connection:false,chats:false,thread:false},messages=new Map(),renderedMessages='',unsubscribe=()=>{};
    const viewport=()=>{const v=window.visualViewport;document.documentElement.style.setProperty('--support-viewport-height',(v?.height||innerHeight)+'px');document.documentElement.style.setProperty('--support-viewport-top',(v?.offsetTop||0)+'px');};
    viewport();window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
    const cleanup=()=>{disposed=true;++threadVersion;clearInterval(poll);clearTimeout(eventTimer);unsubscribe();window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport);window.removeEventListener('pagehide',cleanup);};dispose=cleanup;window.addEventListener('pagehide',cleanup,{once:true});
    const report=e=>{if(disposed)return;$('support-error').hidden=false;$('support-error').textContent=e.message||String(e);};
    const clearError=()=>{if(disposed)return;$('support-error').hidden=true;};
    const initials=name=>name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
    function drawContacts(){if(disposed)return;const q=$('support-search').value.toLocaleLowerCase();const list=chats.filter(c=>c.name.toLocaleLowerCase().includes(q)&&(filter!=='unread'||c.unread>0));$('support-count').textContent=chats.length;$('support-contacts').innerHTML=list.map(c=>`<button class="support-contact ${c.id===current?'active':''}" data-chat-id="${escape(c.id)}" aria-pressed="${c.id===current}"><span class="avatar">${escape(initials(c.name))}</span><span class="support-contact-copy"><strong>${escape(c.name)}</strong><small>${escape(c.last||'Sem mensagens')}</small></span>${c.unread?`<span class="unread-count">${c.unread}</span>`:''}</button>`).join('')||'<p class="support-empty">Nenhuma conversa encontrada.</p>';$('support-more-chats').hidden=chatOffset===null;}
    function drawPermissions(){if(disposed)return;const p=permissions(user?.role);$('support-connection').disabled=!p.connect;$('support-start').disabled=!p.connect;$('support-stop').disabled=!p.connect;$('support-message').disabled=!p.send||!current||connection.status!=='ready';$('support-send').disabled=$('support-message').disabled||sending;$('support-receive').hidden=!provider.mock||!p.send||!current||connection.status!=='ready';$('support-permission').textContent=p.send?'Enter envia · Shift + Enter quebra a linha':'Perfil de leitura: envio desabilitado';$('support-status').textContent=(sessionLabels[connection.status]||connection.status)+(provider.mock?' · simulado':'');}
    function drawMessages(items,{reset=false,follow=false}={}){
      if(disposed)return;
      const history=$('support-history'),nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<72;
      const top=history.getBoundingClientRect().top,anchor=[...history.querySelectorAll('[data-message-id]')].find(el=>el.getBoundingClientRect().bottom>top);
      const anchorId=anchor?.dataset.messageId,anchorTop=anchor?.getBoundingClientRect().top;
      if(reset)messages=new Map();
      for(const m of items)messages.set(m.id,m);
      const ordered=[...messages.values()].sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));
      const signature=JSON.stringify(ordered);
      if(signature!==renderedMessages){
        renderedMessages=signature;
        const fragment=document.createDocumentFragment();let lastDay='';
        for(const m of ordered){
          const date=new Date(m.timestamp*1000),day=date.toLocaleDateString('pt-BR');
          if(day!==lastDay){const label=document.createElement('div');label.className='support-day';label.textContent=day;fragment.append(label);lastDay=day;}
          const article=document.createElement('article');article.className='support-bubble'+(m.mine?' mine':'');article.dataset.messageId=m.id;
          const text=document.createElement('p');text.textContent=m.text;const meta=document.createElement('small');
          meta.textContent=date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+(m.mine?' · '+(labels[m.status]||m.status):'');
          article.append(text,meta);fragment.append(article);
        }
        history.replaceChildren(fragment);
        if(reset||follow||nearBottom)history.scrollTop=history.scrollHeight;
        else if(anchorId){const next=[...history.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===anchorId);if(next)history.scrollTop+=next.getBoundingClientRect().top-anchorTop;}
      }
      $('support-more-messages').hidden=messageOffset===null;
    }
    async function loadChats(reset=true){
      let result,items=[],next=reset?0:chatOffset,target=reset?Math.max(100,chats.length):0;
      do{result=await provider.chats(next);if(disposed)return;items.push(...result.items);if(result.nextOffset===next)break;next=result.nextOffset;}while(reset&&next!==null&&next<target);
      chats=reset?items:[...new Map([...chats,...items].map(c=>[c.id,c])).values()];chatOffset=result.nextOffset;
      if(current&&!chats.some(c=>c.id===current)){current=null;++threadVersion;messages.clear();renderedMessages='';$('support-name').textContent='Selecione uma conversa';$('support-history').replaceChildren();}
      drawContacts();drawPermissions();
    }
    async function select(id){
      clearError();const c=chats.find(c=>c.id===id);if(!c)return;
      current=id;const version=++threadVersion;messages.clear();renderedMessages='';messageOffset=null;
      $('support-more-messages').hidden=true;$('support-name').textContent=c.name;$('support-avatar').textContent=initials(c.name);$('support-tag').textContent=c.tag||'Conversa autorizada';$('support-message').value='';$('support-history').textContent='Carregando histórico…';
      document.querySelector('.support-workspace').classList.add('thread-open');drawContacts();drawPermissions();
      try{const data=await provider.history(id);if(disposed||version!==threadVersion)return;messageOffset=data.nextOffset;drawMessages(data.items,{reset:true});if(provider.mock)c.unread=0;drawContacts();}
      catch(e){if(!disposed&&version===threadVersion){$('support-history').replaceChildren();report(e);}}
    }
    function qr(){if(disposed)return;const body=$('support-qr-body');body.replaceChildren();const description=document.createElement('p');description.textContent=provider.mock?'Demonstração: nenhum dispositivo será conectado. O quadro abaixo não é um QR Code escaneável.':'No WhatsApp do celular, abra Dispositivos conectados → Conectar dispositivo. O QR Code autoriza acesso à sessão; não o compartilhe.';body.append(description);const state=document.createElement('p');state.className='note';state.textContent=sessionLabels[connection.status]||connection.status;body.append(state);if(connection.status==='qr_ready'){if(provider.mock){const placeholder=document.createElement('div');placeholder.className='support-qr-placeholder';placeholder.textContent='QR DEMONSTRAÇÃO';body.append(placeholder);const btn=document.createElement('button');btn.className='btn primary';btn.textContent='Simular leitura do QR Code';btn.onclick=()=>provider.complete();body.append(btn);}else if(connection.qrCode){const img=document.createElement('img');img.className='support-qr-image';img.alt='QR Code de conexão WhatsApp';img.src=connection.qrCode;body.append(img);}}}
    async function refreshConnection(){connection=await provider.connection();if(disposed)return;drawPermissions();if($('support-qr-dialog').open)qr();}
    async function refreshThread(){const id=current,version=threadVersion;if(!id)return;const history=await provider.history(id);if(disposed||id!==current||version!==threadVersion)return;messageOffset=history.nextOffset===null?null:Math.max(messageOffset||0,history.nextOffset);drawMessages(history.items);}
    $('support-search').oninput=drawContacts;document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));drawContacts();});
    $('support-contacts').onclick=e=>{const b=e.target.closest('[data-chat-id]');if(b)select(b.dataset.chatId);};
    $('support-back').onclick=()=>document.querySelector('.support-workspace').classList.remove('thread-open');
    $('support-more-chats').onclick=()=>loadChats(false).catch(report);
    $('support-more-messages').onclick=async()=>{if(messageOffset===null)return;const button=$('support-more-messages'),id=current,version=threadVersion;button.disabled=true;try{const h=await provider.history(id,messageOffset);if(disposed||version!==threadVersion)return;messageOffset=h.nextOffset;drawMessages(h.items);}catch(e){report(e);}finally{if(!disposed)button.disabled=false;}};
    $('support-compose').onsubmit=async e=>{e.preventDefault();if(sending||!permissions(user.role).send||connection.status!=='ready')return;const text=$('support-message').value.trim(),id=current;if(!text||!id)return;sending=true;let accepted=false;drawPermissions();clearError();try{const sent=await provider.send(id,text);accepted=true;if(disposed)return;if(id===current){$('support-message').value='';await refreshThread();if(!messages.has(sent.id))drawMessages([{id:sent.id,chatId:id,text,mine:true,timestamp:sent.timestamp||now(),status:sent.status||'sent'}],{follow:true});else $('support-history').scrollTop=$('support-history').scrollHeight;}await loadChats();}catch(e){report(accepted?Error('Mensagem aceita pelo servidor. A atualização do histórico falhou; não reenvie automaticamente.'):e);}finally{sending=false;drawPermissions();}};
    $('support-message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('support-compose').requestSubmit();}};
    $('support-receive').onclick=()=>{if(provider.mock&&current)provider.receive(current);};
    $('support-connection').onclick=async()=>{if(!permissions(user.role).connect)return;try{await refreshConnection();qr();$('support-qr-dialog').showModal();}catch(e){report(e);}};
    $('support-close-qr').onclick=()=>$('support-qr-dialog').close();
    $('support-start').onclick=async()=>{try{await provider.start();await refreshConnection();}catch(e){report(e);}};
    $('support-stop').onclick=async()=>{try{await provider.stop();await refreshConnection();}catch(e){report(e);}};
    $('support-role').onchange=async e=>{if(!provider.mock)return;provider.role=e.target.value;user=await provider.me();if($('support-qr-dialog').open)$('support-qr-dialog').close();current=null;++threadVersion;$('support-history').replaceChildren();$('support-name').textContent='Selecione uma conversa';await loadChats();drawPermissions();};
    try{user=await provider.me();if(disposed)return;$('support-mode').textContent=provider.mock?'Modo simulado · dados descartados ao recarregar':'OpenWA · '+user.email;$('demo-role-label').hidden=true;$('support-footnote').textContent=provider.mock?'Mensagens e conexão simuladas. Nada é enviado ao WhatsApp.':'Mensagens pelo OpenWA. Enviada não significa entregue; acompanhe o status.';await refreshConnection();await loadChats();}
    catch(e){if(disposed)return;report(e);$('support-mode').textContent=provider.mock?'Erro na demonstração':'Servidor ou login indisponível';return;}
    if(disposed)return;
    function queueEvent(event){
      if(disposed||event.type==='transport.ready')return;
      if(event.type==='session.status'||event.type==='sync')pending.connection=true;
      if(event.type==='sync'||event.type.startsWith('message.')){pending.chats=true;if(event.type==='sync'||event.chatId===current)pending.thread=true;}
      if(!eventRunning&&!eventTimer)eventTimer=setTimeout(flushEvents,120);
    }
    async function flushEvents(){
      eventTimer=null;if(disposed)return;eventRunning=true;const work=pending;pending={connection:false,chats:false,thread:false};
      try{clearError();const results=await Promise.allSettled([work.connection&&refreshConnection(),work.chats&&loadChats(),work.thread&&refreshThread()]);const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;}catch(e){report(e);}
      finally{eventRunning=false;if(!disposed&&Object.values(pending).some(Boolean)&&!eventTimer)eventTimer=setTimeout(flushEvents,120);}
    }
    unsubscribe=provider.subscribe(queueEvent,e=>report(Error('Conexão em tempo real interrompida. Tentando reconectar; '+e.message)));
    poll=setInterval(()=>{if(!disposed&&$('support-qr-dialog').open)refreshConnection().catch(report);},3000);

  }
  window.EcobrikSupport={layout,mount,unmount};
})();
