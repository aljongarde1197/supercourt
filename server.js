
'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const os=require('os');
const net=require('net');
const crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT)||3000;
const PUBLIC_HOSTING=process.env.PUBLIC_HOSTING==='true'||!!process.env.RAILWAY_ENVIRONMENT;
const ROOT=__dirname;
const rooms=new Map();
const ROOM_LIMIT=12,PLAYER_LIMIT=12,STATE_INTERVAL=85,LOBBY_INTERVAL=3000;
function privateIp(raw){
  let ip=String(raw||'').replace(/^::ffff:/,'');
  if(ip==='::1'||ip==='127.0.0.1')return true;
  if(net.isIP(ip)!==4)return false;
  const p=ip.split('.').map(Number);
  return p[0]===10||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===169&&p[1]===254);
}
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<32768)ws.send(JSON.stringify(obj));}
function sanitize(s,max=32){return String(s||'').replace(/[<>\x00-\x1f\x7f]/g,'').trim().slice(0,max);}
function peers(r){return [r.host,r.guest,...r.waiting].filter(Boolean);}
function roomSize(r){return peers(r).filter(ws=>ws.readyState===WebSocket.OPEN).length;}
function roomDetails(r){return {id:r.id,name:r.name,mode:r.mode,occupied:!!r.guest,waiting:r.waiting.length,players:roomSize(r),maxPlayers:PLAYER_LIMIT,endsAt:r.endsAt,remainingMinutes:Math.max(0,Math.ceil((r.endsAt-Date.now())/60000)),playing:r.playing,score:r.score,shots:r.shots,bots:r.mode==='doubles'?2:0,hostName:r.host.name||'Host',guestName:r.guest?.name||'Waiting for player',queue:r.waiting.map((w,i)=>({name:w.name||'Player',position:i+1}))};}
function listRooms(){return [...rooms.values()].filter(r=>r.host.readyState===WebSocket.OPEN&&r.endsAt>Date.now()).map(roomDetails);}
const server=http.createServer((req,res)=>{
  if(!PUBLIC_HOSTING&&!privateIp(req.socket.remoteAddress)){res.writeHead(403);return res.end('LAN-only access');}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({status:'ok',rooms:rooms.size}));}
  if(url.pathname==='/api/rooms'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({rooms:listRooms()}));}
  const routes={'/':'index.html','/index.html':'index.html','/vendor/three.module.js':'node_modules/three/build/three.module.js'};
  const file=routes[url.pathname]||url.pathname.replace(/^\//,'');
  if(!file||file.includes('..')){res.writeHead(404);return res.end('Not found');}
  const target=path.join(ROOT,file);
  if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(target,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Missing file. Run npm install first.');}
    const ext=path.extname(target).toLowerCase();
    const types={'.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.css':'text/css; charset=utf-8'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'public, max-age='+(ext==='.js'||ext==='.png'?86400:0),'X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
});
function lobby(r){const details=roomDetails(r);for(const ws of peers(r))send(ws,{type:'lobby',...details,chat:r.chat.slice(-30)});}
function ready(r){const details=roomDetails(r);send(r.host,{type:'ready',peer:!!r.guest,roomId:r.id,roomName:r.name,waiting:r.waiting.length});if(r.guest)send(r.guest,{type:'ready',peer:true,roomId:r.id,roomName:r.name,waiting:r.waiting.length});for(let i=0;i<r.waiting.length;i++)send(r.waiting[i],{type:'queued',position:i+1,roomId:r.id,roomName:r.name});lobby(r);}
function nextGuest(r){while(r.waiting.length){const ix=crypto.randomInt(r.waiting.length);const ws=r.waiting.splice(ix,1)[0];if(ws.readyState!==WebSocket.OPEN)continue;r.guest=ws;ws.roomRole='guest';send(ws,{type:'promoted',roomId:r.id,roomName:r.name});ready(r);send(ws,{type:'request_profile'});return}r.guest=null;ready(r);}
function expireRoom(r){if(rooms.get(r.id)!==r)return;rooms.delete(r.id);for(const ws of peers(r)){send(ws,{type:'room_expired',message:'Open Play session has ended.'});ws.close(4002,'Session ended');}r.waiting=[];r.guest=null;}
const wss=new WebSocketServer({server,path:'/ws',maxPayload:4096,perMessageDeflate:false,clientTracking:true});
wss.on('connection',(ws,request)=>{
  if(!PUBLIC_HOSTING&&!privateIp(request.socket.remoteAddress)){ws.close(1008,'LAN-only');return;}
  const origin=request.headers.origin;
  if(origin){try{const u=new URL(origin);if(u.host!==request.headers.host){ws.close(1008,'Invalid origin');return}}catch{ws.close(1008,'Invalid origin');return}}
  const params=new URL(request.url,'http://localhost').searchParams;
  const role=params.get('role');if(!['host','join'].includes(role)){ws.close(1008,'Invalid role');return;}
  let r;
  if(role==='host'){
    if(rooms.size>=ROOM_LIMIT){ws.close(1013,'Room limit reached');return;}
    let id;do{id=crypto.randomBytes(3).toString('hex').toUpperCase()}while(rooms.has(id));
    const hours=Math.max(.5,Math.min(8,Number(params.get('hours'))||2));
    r={id,name:sanitize(params.get('name'),32)||'Super Court Open Play',mode:'singles',host:ws,guest:null,waiting:[],chat:[],endsAt:Date.now()+hours*3600000,playing:false,finished:false,score:'0–0',shots:0,lastState:null,lastSpectator:0,lastLobby:0,endingWarned:false};rooms.set(id,r);ws.roomRole='host';ws.name='Host';send(ws,{type:'created',roomId:id,roomName:r.name,endsAt:r.endsAt});
  }else{
    const id=sanitize(params.get('room'),12).toUpperCase();r=rooms.get(id);
    if(!r||r.endsAt<=Date.now()){send(ws,{type:'error',message:'Room not found or session expired.'});ws.close(1008,'Unknown room');return;}
    if(roomSize(r)>=PLAYER_LIMIT){send(ws,{type:'error',message:'Room is full (12 players including host).'});ws.close(1013,'Room full');return;}
    ws.name='Player';if(!r.guest){r.guest=ws;ws.roomRole='guest';}else{r.waiting.push(ws);ws.roomRole='waiting';}
  }
  ws.room=r;ws.rate=[];ws.lastChat=0;ws.isAlive=true;ready(r);
  if(ws.roomRole==='waiting'&&r.lastState)send(ws,{type:'spectate',score:r.score,shots:r.shots,playing:r.playing,ball:r.lastState.ball,host:r.lastState.host,guest:r.lastState.guest});
  let lastInput=0,lastState=0;
  ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',buf=>{
    let data;try{data=JSON.parse(buf.toString())}catch{return}
    if(!data||typeof data.type!=='string'||rooms.get(r.id)!==r)return;
    if(data.type==='profile'){
      ws.name=sanitize(data.name,18)||'Player';lobby(r);
    }
    if(data.type==='chat'){
      const now=Date.now();ws.rate=ws.rate.filter(t=>now-t<20000);
      const message=sanitize(data.message,180);
      if(!message||now-ws.lastChat<2200||ws.rate.length>=5){send(ws,{type:'chat_error',message:'Please wait before sending another message (max 5 per 20 seconds).'});return;}
      ws.lastChat=now;ws.rate.push(now);const item={name:ws.name||'Player',text:message,at:now};r.chat.push(item);if(r.chat.length>30)r.chat.shift();for(const peer of peers(r))send(peer,{type:'chat',item});return;
    }
    if(ws.roomRole==='host'){
      if(data.type==='state'){
        const now=Date.now();if(now-lastState>=STATE_INTERVAL){lastState=now;send(r.guest,data);r.lastState=data;}
        if(typeof data.matchMode==='string')r.mode=data.matchMode==='doubles'?'doubles':'singles';
        r.score=`${Number(data.playerScore)||0}–${Number(data.cpuScore)||0}`;r.shots=Math.max(0,Number(data.shotCount)||0);r.playing=!!(data.playing&&!data.paused);
        if(r.playing)r.finished=false;
        if(now-r.lastSpectator>=600){r.lastSpectator=now;for(const spectator of r.waiting)send(spectator,{type:'spectate',score:r.score,shots:r.shots,playing:r.playing,ball:data.ball,host:data.host,guest:data.guest});}
        if(data.playing&&data.paused&&!data.round&&!r.finished){r.finished=true;r.playing=false;if(r.endsAt<=now){expireRoom(r);return;}if(r.waiting.length){const exiting=r.guest;send(exiting,{type:'rotation',message:'Match complete. Random next player selected.'});if(exiting){r.guest=null;exiting.close(4001,'Open Play rotation');}nextGuest(r);}else lobby(r);}
        else if(now-r.lastLobby>=LOBBY_INTERVAL){r.lastLobby=now;lobby(r);}
      }
      if(data.type==='profile'){data.name=sanitize(data.name,18);send(r.guest,data);}
    }
    if(ws.roomRole==='guest'&&['input','hit','profile'].includes(data.type)&&r.host){
      if(data.type==='input'){const now=Date.now();if(now-lastInput<40)return;lastInput=now;data.keys=Array.isArray(data.keys)?data.keys.filter(k=>['w','a','s','d'].includes(k)).slice(0,4):[];data.jump=!!data.jump;}
      if(data.type==='profile')data.name=sanitize(data.name,18);
      send(r.host,data);
    }
  });
  ws.on('close',()=>{
    if(rooms.get(r.id)!==r)return;
    if(ws.roomRole==='host'&&r.host===ws){expireRoom(r);}
    else if(ws.roomRole==='guest'&&r.guest===ws){r.guest=null;nextGuest(r);}
    else if(ws.roomRole==='waiting'){r.waiting=r.waiting.filter(q=>q!==ws);ready(r);}
  });
});
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){if(r.endsAt<=now&&!r.playing)expireRoom(r);else if(r.endsAt<=now&&r.playing&&!r.endingWarned){r.endingWarned=true;for(const ws of peers(r))send(ws,{type:'room_ending',message:'Session time reached. This is the last game.'});}else if(now-r.lastLobby>=LOBBY_INTERVAL){r.lastLobby=now;lobby(r);}}for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},5000).unref();
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`SUPER COURT Open Play ${PUBLIC_HOSTING?'public':'LAN'} server: http://localhost:${PORT}`);
  for(const list of Object.values(os.networkInterfaces()))for(const ni of list||[])if(ni.family==='IPv4'&&!ni.internal&&privateIp(ni.address))console.log(`Wi-Fi / LAN address: http://${ni.address}:${PORT}`);
  console.log(`Named rooms, randomized queues, session timers and rate-limited chat available (${PUBLIC_HOSTING?'public hosting':'private Wi-Fi'}).`);
});
