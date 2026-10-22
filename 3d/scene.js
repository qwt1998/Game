// 3D view for the trial page 3d.html. The game itself (rules, input, screens) is the same code as index.html:
// 3d/make.py copies it into 3d.html and hands this file the game state to draw every frame.
// World units are map tiles: x runs east like the 2D map, z runs south (the 2D map's y), y points up.
import * as THREE from '../vendor/three-lite.js';

const GT=80;                         // ground texture pixels per tile (the camera is close, so the road needs detail)
// Follow camera like a MOBA: looks down at 50° from the south, about VIEW tiles across the middle of the screen
// (a little more on big screens), and runs a little ahead of the rider in the direction they're riding.
const TILT=50*Math.PI/180,FOV=38,VIEW=7.5,LEAD=1.3;
const YAW={right:0,down:-Math.PI/2,left:Math.PI,up:Math.PI/2};
const STEP={right:[1,0],down:[0,1],left:[-1,0],up:[0,-1]};
const OFFICERS=[[10.3,8.32],[7.7,15.68]];   // where the two traffic officers stand, same spots as the 2D map

// Collects coloured shapes and merges them into a single mesh, so the whole city is one draw call.
class Builder{
  constructor(){this.parts=[];}
  add(geo,x,y,z,color,ry){
    if(ry)geo.rotateY(ry);
    geo.translate(x,y,z);
    const g=geo.index?geo.toNonIndexed():geo,n=g.attributes.position.count,col=new Float32Array(n*3),c=new THREE.Color(color);
    for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}
    this.parts.push({p:g.attributes.position.array,n:g.attributes.normal.array,c:col});
    return this;
  }
  box(x,z,w,d,h,y0,color,ry){return this.add(new THREE.BoxGeometry(w,h,d),x,(y0||0)+h/2,z,color,ry);}
  cyl(x,z,r,h,y0,color,seg){return this.add(new THREE.CylinderGeometry(r,r,h,seg||10),x,(y0||0)+h/2,z,color);}
  cone(x,z,r,h,y0,color,seg){return this.add(new THREE.ConeGeometry(r,h,seg||10),x,(y0||0)+h/2,z,color);}
  ball(x,z,r,y,color){return this.add(new THREE.IcosahedronGeometry(r,1),x,y,z,color);}
  // a hip roof: square pyramid stretched over the house
  roof(x,z,w,d,h,y0,color){
    const geo=new THREE.ConeGeometry(Math.SQRT1_2,1,4);geo.rotateY(Math.PI/4);geo.scale(w,h,d);
    return this.add(geo,x,(y0||0)+h/2,z,color);
  }
  geometry(){
    let len=0;this.parts.forEach(function(q){len+=q.p.length;});
    const pos=new Float32Array(len),nor=new Float32Array(len),col=new Float32Array(len);let o=0;
    this.parts.forEach(function(q){pos.set(q.p,o);nor.set(q.n,o);col.set(q.c,o);o+=q.p.length;});
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(mat){return new THREE.Mesh(this.geometry(),mat);}
}

window.Paodan3D=function(api){
  const W=api.W,H=api.H,C=api.C,ctx=api.ctx,FONT=api.FONT,NUM=api.NUM,clamp=api.clamp,rr=api.rr,circle=api.circle;
  const glCanvas=document.getElementById('gl');
  let renderer=null;
  try{renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:true,powerPreference:'high-performance'});}catch(e){renderer=null;}
  if(!renderer)return flat('这台设备打不开 3D 画面，先用平面画面玩');

  renderer.setClearColor(0x0F1318,1);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0x0F1318,40,80);
  const camera=new THREE.PerspectiveCamera(FOV,1,.5,200);
  const hemi=new THREE.HemisphereLight(0xEAF4FF,0x6F7F62,1.6);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xFFF2D8,2.3);
  sun.position.set(W/2-7,24,H/2+9);sun.target.position.set(W/2,0,H/2);
  sun.castShadow=true;
  const small=Math.min(screen.width,screen.height)<700;
  sun.shadow.mapSize.set(small?1024:2048,small?1024:2048);
  // the sun's shadow box only covers what the camera sees, and moves with it, so shadows stay sharp up close
  Object.assign(sun.shadow.camera,{left:-11,right:11,top:11,bottom:-11,near:1,far:70});
  sun.shadow.bias=-.0006;sun.shadow.normalBias=.03;
  scene.add(sun,sun.target);

  // ---------- Ground: roads, markings, pavements and lawns painted once into a texture ----------
  const groundTex=new THREE.CanvasTexture(paintGround());
  groundTex.colorSpace=THREE.SRGBColorSpace;groundTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(W,H),new THREE.MeshLambertMaterial({map:groundTex}));
  ground.rotation.x=-Math.PI/2;ground.position.set(W/2,0,H/2);ground.receiveShadow=true;scene.add(ground);
  const field=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshLambertMaterial({color:0x9DBB88}));
  field.rotation.x=-Math.PI/2;field.position.set(W/2,-.02,H/2);scene.add(field);

  // ---------- Static city: every building, tree and barrier merged into one mesh ----------
  const vertexMat=new THREE.MeshLambertMaterial({vertexColors:true});
  const city=new Builder();
  buildCity(city);
  const cityMesh=city.mesh(vertexMat);cityMesh.castShadow=true;cityMesh.receiveShadow=true;scene.add(cityMesh);

  // stop lines on the road and a traffic light beside each one, both red or green with the lights
  const goMat=new THREE.MeshBasicMaterial({color:C.green}),stopMat=new THREE.MeshBasicMaterial({color:C.red});
  const lampGeoTL=new THREE.IcosahedronGeometry(.075,1),poles=new Builder();
  const stopLines=[];
  api.LANES.forEach(function(lane){
    lane.stops.forEach(function(a){
      const i=lane.axis==='h'?(lane.line<10?0:1):(a<10?0:1),th=.12;
      const m=new THREE.Mesh(new THREE.BoxGeometry(lane.axis==='h'?th:.76,.03,lane.axis==='h'?.76:th),stopMat);
      const s=lane.dir>0?a-th/2-.05:a+2+th/2+.05;
      // the pole stands on the pavement on the driver's side of the lane
      let px,pz;
      if(lane.axis==='h'){m.position.set(s,.015,lane.line+.5);px=s;pz=lane.dir>0?lane.line+1.12:lane.line-.12;}
      else{m.position.set(lane.line+.5,.015,s);pz=s;px=lane.dir>0?lane.line-.12:lane.line+1.12;}
      poles.cyl(px,pz,.035,1,0,'#3A444E',8).box(px,pz,.13,.13,.3,.86,'#1F2A3A');
      const lamp=new THREE.Mesh(lampGeoTL,stopMat);lamp.position.set(px,1.2,pz);
      scene.add(m,lamp);stopLines.push({m:m,lamp:lamp,i:i,axis:lane.axis,at:[px,pz]});
    });
  });
  // street lamps on the pavement at every block corner (skipping corners where a traffic light or officer stands)
  const taken=stopLines.map(function(s){return s.at}).concat(OFFICERS);
  api.BLOCKS.forEach(function(bl){
    [[bl[0]+.13,bl[1]+.13],[bl[0]+bl[2]-.13,bl[1]+.13],[bl[0]+.13,bl[1]+bl[3]-.13],[bl[0]+bl[2]-.13,bl[1]+bl[3]-.13]].forEach(function(q){
      if(taken.some(function(s){return Math.hypot(s[0]-q[0],s[1]-q[1])<.5}))return;
      poles.cyl(q[0],q[1],.022,.8,0,'#4A5561',6).box(q[0],q[1],.11,.11,.04,.8,'#4A5561').ball(q[0],q[1],.05,.76,'#FFF2B0');
    });
  });
  const poleMesh=poles.mesh(vertexMat);poleMesh.castShadow=true;scene.add(poleMesh);

  // ---------- Moving things ----------
  const carParts=carFixed(),carShell=carBodyGeo(),lampGeo=carLampGeo(-.5);
  const brakeOn=new THREE.MeshBasicMaterial({color:0xFF3B3B}),brakeOff=new THREE.MeshLambertMaterial({color:0x6A2424});
  const cars=[];
  function carMesh(i,color){
    let g=cars[i];
    if(!g){
      g=new THREE.Group();
      const fixed=new THREE.Mesh(carParts,vertexMat),shell=new THREE.Mesh(carShell,new THREE.MeshLambertMaterial({vertexColors:true})),brake=new THREE.Mesh(lampGeo,brakeOff);
      fixed.castShadow=shell.castShadow=true;fixed.renderOrder=shell.renderOrder=brake.renderOrder=2;
      const see=ghostMat(color);
      g.add(ghost(carParts,see),ghost(carShell,see),fixed,shell,brake);g.userData={shell:shell,brake:brake,see:see,color:null};
      scene.add(g);cars[i]=g;
    }
    if(g.userData.color!==color){g.userData.color=color;g.userData.shell.material.color.set(color);g.userData.see.color.set(color);}
    g.visible=true;
    return g;
  }
  // Behind a tall building a car or rider would vanish, so a flat copy of it is drawn first, only where something
  // stands in front of it (depth test reversed); the real model then covers it wherever it is in plain sight.
  function ghostMat(col){return new THREE.MeshBasicMaterial({color:col,depthFunc:THREE.GreaterDepth,depthWrite:false});}
  function ghost(geo,mat){const m=new THREE.Mesh(geo,mat);m.renderOrder=1;return m;}
  const rider=scooter(C.rider,'#2B3A4B','#FFFFFF',false,C.rider);rider.rotation.order='YXZ';rider.scale.setScalar(1.35);scene.add(rider);
  const sirenR=new THREE.MeshBasicMaterial({color:0xFF3B47}),sirenB=new THREE.MeshBasicMaterial({color:0x3B7BFF}),sirenOff=new THREE.MeshLambertMaterial({color:0x7FA2E8});
  const police=scooter('#F5F7FA','#1E2B44','#FFFFFF',true,C.police);scene.add(police);

  // ---------- Flat marks on the road (rings, glows), reused every frame ----------
  const ringThin=flatGeo(new THREE.RingGeometry(.86,1,40)),ringThick=flatGeo(new THREE.RingGeometry(.7,1,40)),disc=flatGeo(new THREE.CircleGeometry(1,40));
  const arcs=[];
  function arc(frac){const k=Math.round(clamp(frac,0,1)*48);if(!arcs[k])arcs[k]=flatGeo(new THREE.RingGeometry(.7,1,40,1,Math.PI/2,-Math.max(k,.01)/48*Math.PI*2));return arcs[k];}
  const marks=[];let used=0;
  function mark(geo,x,z,r,color,opacity){
    let m=marks[used];
    if(!m){
      m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
      m.renderOrder=2;scene.add(m);marks.push(m);
    }
    used++;m.geometry=geo;m.material.color.set(color);m.material.opacity=opacity;m.position.set(x,.03,z);m.scale.set(r,1,r);m.visible=true;
    return m;
  }

  // ---------- Crash debris: a handful of bits that fly out and bounce ----------
  const debrisGeo=new THREE.BoxGeometry(.09,.09,.09),debris=[];
  function burst(x,z){
    for(let i=0;i<14;i++){
      let d=debris.find(function(q){return q.life<=0});
      if(!d){d={m:new THREE.Mesh(debrisGeo,new THREE.MeshLambertMaterial()),v:new THREE.Vector3(),life:0};d.m.renderOrder=2;scene.add(d.m);debris.push(d);}
      d.m.material.color.set(['#F5F7F9','#FFC23D','#A9B4C0','#E8585C'][i%4]);
      d.m.position.set(x,.35,z);d.v.set((Math.random()-.5)*3.2,1.8+Math.random()*1.8,(Math.random()-.5)*3.2);d.life=.9;d.m.visible=true;
    }
  }
  function stepDebris(dt){
    debris.forEach(function(d){
      if(d.life<=0)return;
      d.life-=dt;d.v.y-=9.8*dt;d.m.position.addScaledVector(d.v,dt);
      if(d.m.position.y<.05){d.m.position.y=.05;d.v.y*=-.35;d.v.x*=.6;d.v.z*=.6;}
      d.m.rotation.x+=dt*9;d.m.rotation.z+=dt*7;
      if(d.life<=0)d.m.visible=false;
    });
  }

  // ---------- Camera ----------
  let Wpx=W*18,Hpx=H*18,view=VIEW,camDist=14,snap=true;
  const camAt=new THREE.Vector3(W/2,0,H/2),v=new THREE.Vector3(),v2=new THREE.Vector3();
  function resize(){
    Wpx=W*api.T;Hpx=H*api.T;
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    renderer.setSize(Wpx,Hpx,false);
    glCanvas.style.width=Wpx+'px';glCanvas.style.height=Hpx+'px';
    camera.aspect=Wpx/Hpx;camera.updateProjectionMatrix();
    view=clamp(Wpx/55,VIEW,10);
    camDist=view/2/Math.tan(Math.atan(Math.tan(FOV*Math.PI/360)*camera.aspect));
    mini=null;
  }
  // Glides after the rider (a bit ahead of them), but never so far that the view leaves the town.
  function follow(pp,dir,dt){
    const st=STEP[dir];let tx=pp[0],tz=pp[1];
    if(st){tx+=st[0]*LEAD;tz+=st[1]*LEAD;}
    tx=clamp(tx,view*.36,W-view*.36);tz=clamp(tz,2,H-1);
    if(snap){camAt.set(tx,0,tz);snap=false;}
    else{const a=1-Math.exp(-dt*5);camAt.x+=(tx-camAt.x)*a;camAt.z+=(tz-camAt.z)*a;}
    camera.position.set(camAt.x,camDist*Math.sin(TILT),camAt.z+camDist*Math.cos(TILT));
    camera.lookAt(camAt);
    sun.position.set(camAt.x-7,24,camAt.z+9);sun.target.position.copy(camAt);sun.target.updateMatrixWorld();
  }
  // screen position (CSS px) of a world point, and how many px one tile measures there
  function P(x,z,y){v.set(x,y||0,z).project(camera);return [(v.x+1)/2*Wpx,(1-v.y)/2*Hpx,v.z>1];}
  function seen(s,m){return !s[2]&&s[0]>-m&&s[0]<Wpx+m&&s[1]>-m&&s[1]<Hpx+m;}
  function K(x,z,y){const a=P(x-.5,z,y),b=P(x+.5,z,y);return Math.hypot(b[0]-a[0],b[1]-a[1]);}

  // ---------- Every frame ----------
  let last=0,lean=0,lastHalt=null;
  function turn(obj,facing,dt){
    const want=YAW[facing]||0;let cur=obj.rotation.y,d=want-cur;
    d=Math.atan2(Math.sin(d),Math.cos(d));
    const step=d*Math.min(1,dt*14);
    obj.rotation.y=cur+step;
    return step;
  }
  function draw(now){
    const S=api.S,dt=Math.min(.05,Math.max(0,(now-(last||now))/1000));last=now;
    S.cars.forEach(function(c,i){
      const g=carMesh(i,c.c),cc=api.carCenter(c),lane=c.lane;
      g.position.set(cc[0],0,cc[1]);
      g.rotation.y=lane.axis==='h'?(lane.dir>0?0:Math.PI):(lane.dir>0?-Math.PI/2:Math.PI/2);
      g.userData.brake.material=c.cur<.2?brakeOn:brakeOff;
    });
    for(let i=S.cars.length;i<cars.length;i++)cars[i].visible=false;
    const pp=api.playerPos(),P0=S.player;
    rider.position.set(pp[0],0,pp[1]);
    // lean into turns: the faster the scooter swings round, the more it tips
    const swing=turn(rider,P0.facing,dt),want=dt>0&&!api.reduceMotion?clamp(-swing/dt*.06,-.42,.42):0;
    lean+=(want-lean)*Math.min(1,dt*10);rider.rotation.x=lean;
    rider.visible=!(S.invuln>0&&!S.halt&&!api.reduceMotion&&Math.floor(now/110)%2===0);
    if(S.halt&&S.halt.kind==='crash'&&S.halt!==lastHalt&&!api.reduceMotion)burst(pp[0],pp[1]);
    lastHalt=S.halt;
    stepDebris(dt);
    const Q=S.police,qx=Q.fx+(Q.tx-Q.fx)*Q.t+.5,qz=Q.fy+(Q.ty-Q.fy)*Q.t+.5,chase=Q.mode==='chase',blink=Math.floor(now/140)%2===0;
    police.position.set(qx,0,qz);turn(police,Q.facing,dt);
    police.userData.siren.material=chase?(blink?sirenR:sirenB):sirenOff;
    stopLines.forEach(function(s){s.m.material=s.lamp.material=api.lightPhase(s.i)===s.axis?goMat:stopMat;});

    used=0;
    const k=api.reduceMotion?.5:(now/700)%1,wrong=api.isWrongWay();
    if(wrong)api.INTERS.forEach(function(I){mark(disc,I.cx,I.cy,3.6,C.bad,api.reduceMotion?.12:.1+.08*Math.sin(now/120));});
    if(S.battery<30)api.stations.forEach(function(p){ping(p,C.station,k);});
    if(S.damage>0)api.repairs.forEach(function(p){ping(p,C.repair,k);});
    S.pins.forEach(function(p){
      const x=p.shop.door[0]+.5,z=p.shop.door[1]+.5,frac=clamp((p.expires-S.t)/(p.expires-p.born),0,1);
      mark(ringThick,x,z,.32,'#FFFFFF',.55);mark(arc(frac),x,z,.32,C.pin,1);mark(disc,x,z,.13,C.pin,1);
    });
    S.active.forEach(function(o){const d=destAt(o);mark(ringThin,d[0],d[1],.2+.4*k,S.t>o.deadline?C.bad:C.o[o.slot],1-k);});
    const nav=api.navRoute();if(nav)navDots(nav,now);
    if(chase)mark(disc,qx,qz,.7,blink?'#F03C46':'#3C6EF0',.35);
    const ring=wrong?C.bad:C.rider;
    mark(disc,pp[0],pp[1],.6,ring,.4);mark(ringThin,pp[0],pp[1],.6,'#FFFFFF',.9);
    if(api.reduceMotion)mark(ringThin,pp[0],pp[1],.9,ring,.85);
    else for(let i=0;i<2;i++){const q=(now/1500+i*.5)%1;mark(ringThin,pp[0],pp[1],.62+q,i?'#FFFFFF':ring,(1-q)*.85);}
    for(let i=used;i<marks.length;i++)marks[i].visible=false;

    const rain=api.isRain();
    hemi.intensity=rain?1.05:1.6;sun.intensity=rain?.8:2.3;
    scene.fog.near=camDist*(rain?1:1.3);scene.fog.far=camDist*(rain?2:2.8);
    follow(pp,P0.dir,dt);
    if(S.shake>0&&!api.reduceMotion){camera.position.x+=(Math.random()-.5)*.25;camera.position.y+=(Math.random()-.5)*.25;}
    camera.updateMatrixWorld();
    renderer.render(scene,camera);
    overlay(now);
  }
  // the navigation line on the road: a row of dots that flows towards the door
  function navDots(nav,now){
    const pts=nav.pts,gap=.45;let carry=api.reduceMotion?0:gap-(now/1000*1.4)%gap,n=0;
    for(let i=1;i<pts.length&&n<60;i++){
      const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);let t=carry;
      for(;t<len&&n<60;t+=gap,n++)mark(disc,a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len,.11,nav.color,.95);
      carry=t-len;
    }
  }
  function ping(p,col,k){
    const x=p.door[0]+.5,z=p.door[1]+.5;
    mark(ringThick,x,z,.3+.45*k,col,1-k);mark(disc,x,z,.28,col,1);mark(ringThin,x,z,.28,'#FFFFFF',1);
  }
  // several orders to the same door stand side by side, like in the 2D game
  function destAt(o){
    const list=api.S.active.filter(function(a){return a.dest===o.dest}),i=list.indexOf(o);
    const off=(i-(list.length-1)/2)*.66,ns=o.dest.side==='N'||o.dest.side==='S';
    return [o.dest.door[0]+.5+(ns?off:0),o.dest.door[1]+.5+(ns?0:off)];
  }

  // ---------- Flat 2D layer on top: names, price bubbles, markers, floating text, rain ----------
  function overlay(now){
    const S=api.S,dpr=api.dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,Wpx,Hpx);
    api.places.forEach(function(p){
      if(!p.lab)return;
      const s=P(p.lab[0],p.lab[1],p.lab[2]);
      if(seen(s,60))pill(p.name,s[0],s[1],clamp(Math.round(K(p.lab[0],p.lab[1],p.lab[2])*.42),9,15));
    });
    if(S.battery<30)api.stations.forEach(function(p){glyph(p,'bolt',C.station);});
    if(S.damage>0)api.repairs.forEach(function(p){glyph(p,'修',C.repair);});
    pinBubbles(now);destPins(now);
    S.puffs.forEach(function(p){const s=P(p.x,p.y,.35),t=K(p.x,p.y,.35);ctx.fillStyle='rgba(90,96,104,'+(p.life*.5)+')';circle(ctx,s[0],s[1],t*(.12+(1-p.life)*.18));ctx.fill();});
    whistle();rainLayer(now);spotlight();marker(now);floats();arrows();minimap(now);
  }

  // ---------- Minimap in the bottom-right corner: the whole town, where you are and where to go ----------
  let mini=null;
  function miniRect(){const w=Math.round(clamp(Wpx*.25,62,140)),h=Math.round(w*H/W);return {x:Wpx-w-8,y:Hpx-h-8,w:w,h:h,s:w/W};}
  function buildMini(m){
    const dpr=api.dpr,cv=document.createElement('canvas');cv.width=Math.round(m.w*dpr);cv.height=Math.round(m.h*dpr);
    const g=cv.getContext('2d');g.setTransform(dpr*m.s,0,0,dpr*m.s,0,0);
    g.fillStyle='#3E5A3F';g.fillRect(0,0,W,H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const c=api.grid[y][x];if(c==='#')continue;
      g.fillStyle=c==='x'?C.con1:api.isMainCh(c)?'#C9D2DA':'#8D9AA7';g.fillRect(x,y,1.02,1.02);
    }
    return cv;
  }
  function minimap(now){
    const S=api.S,m=miniRect();
    if(!mini||mini.w!==m.w)mini={w:m.w,cv:buildMini(m)};
    const X=function(x){return m.x+x*m.s},Y=function(z){return m.y+z*m.s};
    ctx.save();
    ctx.fillStyle='rgba(15,19,24,.82)';rr(ctx,m.x-3,m.y-3,m.w+6,m.h+6,9);ctx.fill();
    rr(ctx,m.x,m.y,m.w,m.h,6);ctx.clip();
    ctx.drawImage(mini.cv,m.x,m.y,m.w,m.h);
    // the patch of town the camera is showing
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=1.2;ctx.beginPath();
    footprint().forEach(function(q,i){if(i)ctx.lineTo(X(q[0]),Y(q[1]));else ctx.moveTo(X(q[0]),Y(q[1]));});
    ctx.closePath();ctx.stroke();
    const nav=api.navRoute();
    if(nav){
      ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
      nav.pts.forEach(function(q,i){if(i)ctx.lineTo(X(q[0]),Y(q[1]));else ctx.moveTo(X(q[0]),Y(q[1]));});
      ctx.strokeStyle='rgba(15,19,24,.6)';ctx.lineWidth=3.4;ctx.stroke();ctx.strokeStyle=nav.color;ctx.lineWidth=1.8;ctx.stroke();
    }
    if(S.battery<30)api.stations.forEach(function(p){dot(X(p.door[0]+.5),Y(p.door[1]+.5),3,C.station,true);});
    if(S.damage>0)api.repairs.forEach(function(p){dot(X(p.door[0]+.5),Y(p.door[1]+.5),3,C.repair,true);});
    S.pins.forEach(function(p){dot(X(p.shop.door[0]+.5),Y(p.shop.door[1]+.5),2.6,C.pin,false);});
    S.active.forEach(function(o){const d=destAt(o);dot(X(d[0]),Y(d[1]),3.4,S.t>o.deadline?C.bad:C.o[o.slot],true);});
    const Q=S.police;
    dot(X(Q.fx+(Q.tx-Q.fx)*Q.t+.5),Y(Q.fy+(Q.ty-Q.fy)*Q.t+.5),2.6,Q.mode==='chase'&&Math.floor(now/200)%2?C.bad:C.police,false);
    // the rider is an arrow pointing the way they face
    const pp=api.playerPos(),st=STEP[S.player.facing]||[0,1];
    ctx.translate(X(pp[0]),Y(pp[1]));ctx.rotate(Math.atan2(st[1],st[0]));
    ctx.fillStyle=C.rider;ctx.strokeStyle='#1B2430';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(5.5,0);ctx.lineTo(-3.5,4);ctx.lineTo(-1.5,0);ctx.lineTo(-3.5,-4);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,.3)';ctx.lineWidth=1;rr(ctx,m.x,m.y,m.w,m.h,6);ctx.stroke();
  }
  function dot(x,y,r,col,ring){circle(ctx,x,y,r);ctx.fillStyle=col;ctx.fill();if(ring){ctx.strokeStyle='#FFFFFF';ctx.lineWidth=1;ctx.stroke();}}
  // where the four corners of the screen land on the ground
  function footprint(){
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(function(c){
      v.set(c[0],c[1],.5).unproject(camera).sub(camera.position);
      const t=v.y<-1e-4?Math.min(60,-camera.position.y/v.y):60;
      return [camera.position.x+v.x*t,camera.position.z+v.z*t];
    });
  }
  // Arrows on the edge of the view pointing at whatever you need that is off screen:
  // the numbered orders in the box, shops with orders waiting (while the box has room), and help when needed.
  function arrows(){
    const S=api.S,m=miniRect(),pad=22,list=[];
    S.active.forEach(function(o){const d=destAt(o);list.push([d[0],d[1],S.t>o.deadline?C.bad:C.o[o.slot],String(o.slot+1),'#FFFFFF',NUM]);});
    if(S.active.length<3)S.pins.forEach(function(p){list.push([p.shop.door[0]+.5,p.shop.door[1]+.5,C.pin,'¥',C.pinInk,NUM]);});
    if(S.battery<30){const st=nearest(api.stations);if(st)list.push([st.door[0]+.5,st.door[1]+.5,C.station,'电','#FFFFFF',FONT]);}
    if(S.damage>0){const rp=nearest(api.repairs);if(rp)list.push([rp.door[0]+.5,rp.door[1]+.5,C.repair,'修','#FFFFFF',FONT]);}
    list.forEach(function(a){
      const s=P(a[0],a[1],0);
      if(!s[2]&&s[0]>=0&&s[0]<=Wpx&&s[1]>=0&&s[1]<=Hpx)return;
      let dx=s[0]-Wpx/2,dy=s[1]-Hpx/2;if(s[2]){dx=-dx;dy=-dy;}
      const k=Math.min((Wpx/2-pad)/Math.max(Math.abs(dx),1e-3),(Hpx/2-pad)/Math.max(Math.abs(dy),1e-3));
      let x=Wpx/2+dx*k,y=Hpx/2+dy*k;
      if(x>m.x-pad&&y>m.y-pad){if(x-(m.x-pad)<y-(m.y-pad))x=m.x-pad;else y=m.y-pad;}
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(dy,dx));
      ctx.fillStyle=a[2];ctx.beginPath();ctx.moveTo(19,0);ctx.lineTo(9,-6.5);ctx.lineTo(9,6.5);ctx.closePath();ctx.fill();
      ctx.restore();
      circle(ctx,x,y,11);ctx.fillStyle=a[2];ctx.fill();ctx.strokeStyle='#FFFFFF';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=a[4];ctx.font='700 12px '+a[5];ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(a[3],x,y+.5);
    });
  }
  function nearest(list){
    const pp=api.playerPos();let best=null,bd=1e9;
    list.forEach(function(p){const d=Math.hypot(p.door[0]+.5-pp[0],p.door[1]+.5-pp[1]);if(d<bd){bd=d;best=p;}});
    return best;
  }
  function pill(text,cx,cy,fs){
    ctx.font='700 '+fs+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText(text).width,ph=fs+6,pw=tw+12;
    ctx.fillStyle='rgba(20,30,20,.22)';rr(ctx,cx-pw/2,cy-ph/2+1.5,pw,ph,ph/2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.95)';rr(ctx,cx-pw/2,cy-ph/2,pw,ph,ph/2);ctx.fill();
    ctx.fillStyle=C.label;ctx.fillText(text,cx,cy+.5);
  }
  function glyph(p,g,col){
    const x=p.door[0]+.5,z=p.door[1]+.5,s=P(x,z,.03),t=Math.min(K(x,z,.03),40);
    if(!seen(s,30))return;
    if(g==='bolt')api.bolt(ctx,s[0],s[1],t*.36,'#FFFFFF');
    else{ctx.fillStyle='#FFFFFF';ctx.font='700 '+Math.max(9,Math.round(t*.3))+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(g,s[0],s[1]+.5);}
  }
  function pinBubbles(now){
    const S=api.S;
    S.pins.forEach(function(p){
      const x=p.shop.door[0]+.5,z=p.shop.door[1]+.5,s=P(x,z,0),t=K(x,z,0);
      const left=p.expires-S.t,blink=left<4&&!api.reduceMotion&&Math.floor(now/180)%2===0;
      if(!seen(s,80))return;
      const bob=api.reduceMotion?0:Math.sin(now/300+x)*t*.05,fs=clamp(Math.round(t*.48),11,16);
      ctx.font='600 '+fs+'px '+NUM;
      const label=api.fmtMoney(p.fee),bh=fs+8,bw=Math.max(Math.min(t*1.5,58),ctx.measureText(label).width+16),tk=Math.min(t,34);
      let by=s[1]-t*.42-bh+bob;const above=by>2;if(!above)by=s[1]+t*.42+bob;
      const bx=clamp(s[0]-bw/2,3,Wpx-bw-3);
      ctx.globalAlpha=blink?.45:1;
      ctx.fillStyle='rgba(0,0,0,.25)';rr(ctx,bx+1,by+3,bw,bh,bh/2);ctx.fill();
      ctx.fillStyle=C.pin;ctx.beginPath();
      if(above){ctx.moveTo(s[0]-tk*.15,by+bh-1);ctx.lineTo(s[0]+tk*.15,by+bh-1);ctx.lineTo(s[0],by+bh+tk*.17);}
      else{ctx.moveTo(s[0]-tk*.15,by+1);ctx.lineTo(s[0]+tk*.15,by+1);ctx.lineTo(s[0],by-tk*.17);}
      ctx.closePath();ctx.fill();
      rr(ctx,bx,by,bw,bh,bh/2);ctx.fill();
      ctx.strokeStyle='#FFFFFF';ctx.lineWidth=2;rr(ctx,bx,by,bw,bh,bh/2);ctx.stroke();
      ctx.fillStyle=C.pinInk;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,bx+bw/2,by+bh/2+1);
      ctx.globalAlpha=1;
    });
  }
  function destPins(now){
    const S=api.S,bobK=api.reduceMotion?0:Math.sin(now/260);
    S.active.forEach(function(o){
      const d=destAt(o),s=P(d[0],d[1],0);if(!seen(s,60))return;
      const t=Math.min(K(d[0],d[1],0),40),bob=bobK*t*.05;
      const col=S.t>o.deadline?C.bad:C.o[o.slot],r=clamp(t*.3,9,12),hy=Math.max(r+3,s[1]-t*.7+bob);
      ctx.fillStyle=col;ctx.beginPath();ctx.arc(s[0],hy,r,Math.PI*.8,Math.PI*.2,false);ctx.lineTo(s[0],s[1]-t*.06+bob*.3);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#FFFFFF';ctx.lineWidth=Math.max(1.5,t*.06);ctx.stroke();
      ctx.fillStyle='#FFFFFF';ctx.font='600 '+Math.max(10,Math.round(r*1.3))+'px '+NUM;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(o.slot+1),s[0],hy+1);
    });
  }
  function whistle(){
    const S=api.S;if(!(S.whistle>0)||S.whistleAt==null)return;
    const sp=OFFICERS[S.whistleAt],s=P(sp[0],sp[1],1.25),fs=clamp(Math.round(K(sp[0],sp[1],1)*.5),11,18);
    ctx.font='900 '+fs+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.lineWidth=4;ctx.strokeStyle='rgba(15,19,24,.9)';ctx.strokeText('哔！',s[0],s[1]);
    ctx.fillStyle='#FFE08A';ctx.fillText('哔！',s[0],s[1]);
  }
  function rainLayer(now){
    if(!api.isRain())return;
    ctx.fillStyle='rgba(40,62,92,.18)';ctx.fillRect(0,0,Wpx,Hpx);
    ctx.strokeStyle='rgba(235,244,255,.55)';ctx.lineWidth=1;ctx.beginPath();
    const w=Wpx+40,h=Hpx+40,sp=api.reduceMotion?.15:1;
    for(let i=0;i<110;i++){const rx=((i*137.5+now*.12*sp)%w)-20,ry=((i*71.3+now*.6*sp)%h)-20;ctx.moveTo(rx,ry);ctx.lineTo(rx-3,ry+11);}
    ctx.stroke();
  }
  function spotlight(){
    const S=api.S;if(!(S.spot>0))return;
    const pp=api.playerPos(),s=P(pp[0],pp[1],.3),t=Math.min(K(pp[0],pp[1],.3),34),r=t*1.9;
    ctx.save();ctx.globalAlpha=Math.min(1,S.spot/.7);
    ctx.fillStyle='rgba(8,12,18,.62)';ctx.beginPath();ctx.rect(0,0,Wpx,Hpx);ctx.moveTo(s[0]+r,s[1]);ctx.arc(s[0],s[1],r,0,Math.PI*2,true);ctx.fill('evenodd');
    ctx.strokeStyle=C.rider;ctx.lineWidth=t*.08;ctx.setLineDash([t*.25,t*.18]);circle(ctx,s[0],s[1],r);ctx.stroke();ctx.setLineDash([]);
    const fs=clamp(Math.round(t*.62),13,20);
    ctx.font='900 '+fs+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText('你在这里').width;
    ctx.fillStyle='#FFFFFF';ctx.fillText('你在这里',clamp(s[0],tw/2+6,Wpx-tw/2-6),Math.min(Hpx-fs,s[1]+r+fs));
    ctx.restore();
  }
  // The "我" pin above the rider; during a stop it becomes the countdown (same look as the 2D game).
  function marker(now){
    const S=api.S,pp=api.playerPos(),s=P(pp[0],pp[1],1.35),t=Math.min(K(pp[0],pp[1],1),34),wrong=api.isWrongWay(),x=s[0];
    if(S.halt){
      const h=S.halt,frac=1-h.left/h.total,hy=s[1]-t*.35;
      const col=h.kind==='crash'?C.bad:h.kind==='police'?C.police:h.kind==='swap'?C.station:'#9AA6B2';
      ctx.fillStyle='rgba(15,19,24,.88)';circle(ctx,x,hy,t*.36);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=t*.08;circle(ctx,x,hy,t*.28);ctx.stroke();
      ctx.strokeStyle=col;ctx.beginPath();ctx.arc(x,hy,t*.28,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);ctx.stroke();
      ctx.fillStyle='#FFFFFF';ctx.font='600 '+Math.max(10,Math.round(t*.34))+'px '+NUM;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(String(Math.max(1,Math.ceil(h.left))),x,hy+1);
      const fs=clamp(Math.round(t*.44),11,16),lbl=h.label+' · 剩 '+Math.max(1,Math.ceil(h.left))+' 分钟';
      ctx.font='900 '+fs+'px '+FONT;
      const tw=ctx.measureText(lbl).width,lx=clamp(x,tw/2+6,Wpx-tw/2-6),ly=Math.max(fs,hy-t*.62);
      ctx.lineJoin='round';ctx.lineWidth=Math.max(4,fs*.34);ctx.strokeStyle='rgba(15,19,24,.92)';ctx.strokeText(lbl,lx,ly);
      ctx.fillStyle=col==='#9AA6B2'?'#E6EBF0':col;ctx.fillText(lbl,lx,ly);
    }else{
      const bob=api.reduceMotion?0:Math.sin(now/230)*t*.07,text=wrong?'逆行':'我',fs=clamp(Math.round(t*.6),13,20);
      ctx.font='900 '+fs+'px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';
      const bh=fs+10,bw=Math.max(bh,ctx.measureText(text).width+18);
      const cx=clamp(x,bw/2+3,Wpx-bw/2-3),cy=Math.max(bh/2+3,s[1]-bh/2-t*.3+bob);
      const fill=wrong?C.bad:'#1B2430',edge=wrong?'#FFFFFF':C.rider;
      ctx.fillStyle='rgba(0,0,0,.3)';rr(ctx,cx-bw/2+1,cy-bh/2+3,bw,bh,bh/2);ctx.fill();
      ctx.fillStyle=edge;ctx.beginPath();ctx.moveTo(x-t*.17,cy+bh/2-3);ctx.lineTo(x+t*.17,cy+bh/2-3);ctx.lineTo(x,cy+bh/2+t*.24);ctx.closePath();ctx.fill();
      ctx.fillStyle=fill;rr(ctx,cx-bw/2,cy-bh/2,bw,bh,bh/2);ctx.fill();
      ctx.strokeStyle=edge;ctx.lineWidth=Math.max(2,t*.1);rr(ctx,cx-bw/2,cy-bh/2,bw,bh,bh/2);ctx.stroke();
      ctx.fillStyle=wrong?'#FFFFFF':C.rider;ctx.fillText(text,cx,cy+1);
    }
  }
  function floats(){
    const S=api.S;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    S.floats.forEach(function(f){
      const k=1-f.life/f.dur,s=P(f.x,f.y+.7,1.5+k*.9),fs=clamp(Math.round(K(f.x,f.y,1)*.52),12,18);
      ctx.globalAlpha=Math.min(1,f.life/.4);
      ctx.font='900 '+fs+'px '+FONT;
      const tw=ctx.measureText(f.text).width,fx=clamp(s[0],tw/2+6,Wpx-tw/2-6),fy=Math.max(fs,s[1]);
      ctx.lineWidth=Math.max(4,fs*.34);ctx.strokeStyle='rgba(15,19,24,.92)';ctx.strokeText(f.text,fx,fy);
      ctx.fillStyle=f.color;ctx.fillText(f.text,fx,fy);
    });
    ctx.globalAlpha=1;
  }

  // ---------- Building the ground texture ----------
  function paintGround(){
    const T=GT,cv=document.createElement('canvas');cv.width=W*T;cv.height=H*T;
    const g=cv.getContext('2d'),grid=api.grid,tile=api.tile,passable=api.passable;
    g.fillStyle=C.land;g.fillRect(0,0,W*T,H*T);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const c=grid[y][x];if(c==='#')continue;
      g.fillStyle=api.isMainCh(c)?C.main:C.street;g.fillRect(x*T,y*T,T+.5,T+.5);
    }
    // street centre dashes
    g.strokeStyle=C.dashStreet;g.lineWidth=Math.max(1,T*.05);g.lineCap='round';
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(grid[y][x]!=='.')continue;
      const h=passable(x-1,y)||passable(x+1,y),vv0=passable(x,y-1)||passable(x,y+1);
      const hh=(tile(x-1,y)!=='#')||(tile(x+1,y)!=='#'),vv=(tile(x,y-1)!=='#')||(tile(x,y+1)!=='#');
      g.beginPath();
      if((h||hh)&&!(vv0||vv)){g.moveTo(x*T+T*.28,y*T+T/2);g.lineTo(x*T+T*.72,y*T+T/2);}
      else if((vv0||vv)&&!(h||hh)){g.moveTo(x*T+T/2,y*T+T*.28);g.lineTo(x*T+T/2,y*T+T*.72);}
      g.stroke();
    }
    // main road markings
    const lw=Math.max(1,T*.05),gp=Math.max(1,T*.04);
    g.fillStyle=C.yellow;
    [6,16].forEach(function(r){
      for(let x=0;x<W;x++){if(tile(x,r)==='+'||api.crossingH(x,r))continue;g.fillRect(x*T,(r+1)*T-gp-lw,T+.5,lw);g.fillRect(x*T,(r+1)*T+gp,T+.5,lw);}
    });
    for(let y=0;y<H;y++){if(tile(8,y)==='+'||api.crossingV(y))continue;g.fillRect(9*T-gp-lw,y*T,lw,T+.5);g.fillRect(9*T+gp,y*T,lw,T+.5);}
    g.fillStyle='rgba(255,255,255,.4)';
    [6,16].forEach(function(r){
      for(let x=0;x<W;x++){if(tile(x,r)==='+'||api.crossingH(x,r))continue;g.fillRect(x*T,r*T+T*.06,T+.5,2);g.fillRect(x*T,(r+2)*T-T*.06-2,T+.5,2);}
    });
    for(let y=0;y<H;y++){if(tile(8,y)==='+'||api.crossingV(y))continue;g.fillRect(8*T+T*.06,y*T,2,T+.5);g.fillRect(10*T-T*.06-2,y*T,2,T+.5);}
    // zebra crossings
    g.fillStyle='rgba(255,255,255,.72)';
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const c=grid[y][x];if(!(c==='w'||c==='e'||c==='n'||c==='s')||!api.isCrossing(x,y))continue;
      for(let k=0;k<4;k++){
        if(c==='w'||c==='e')g.fillRect(x*T+T*.16,y*T+(k+.25)*T/4,T*.68,T/8);
        else g.fillRect(x*T+(k+.25)*T/4,y*T+T*.16,T/8,T*.68);
      }
    }
    // lane arrows
    g.fillStyle='rgba(255,255,255,.55)';
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const ld=api.LANE_DIR[grid[y][x]];if(!ld||api.isCrossing(x,y))continue;
      if((ld==='left'||ld==='right')?(x%5!==2):(y%5!==2))continue;
      api.chevron(g,x*T+T/2,y*T+T/2,ld,T*.55);
    }
    // roadwork tiles are plain street here; the barriers are 3D
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(grid[y][x]==='x'){g.fillStyle=C.street;g.fillRect(x*T,y*T,T+.5,T+.5);}}
    // pavements and lawns
    api.BLOCKS.forEach(function(b){
      const X=b[0]*T,Y=b[1]*T,BW=b[2]*T,BH=b[3]*T;
      g.fillStyle=C.walkEdge;rr(g,X+T*.04,Y+T*.06,BW-T*.08,BH-T*.08,T*.3);g.fill();
      g.fillStyle=C.walk;rr(g,X+T*.04,Y+T*.04,BW-T*.08,BH-T*.1,T*.3);g.fill();
      g.fillStyle=C.lawn;rr(g,X+T*.2,Y+T*.2,BW-T*.4,BH-T*.4,T*.22);g.fill();
    });
    api.places.forEach(function(p){
      const r=p.rect,X=r[0]*T,Y=r[1]*T,RW=r[2]*T,RH=r[3]*T;
      if(p.door){
        g.fillStyle=C.walk;
        const dx=p.door[0]*T,dy=p.door[1]*T;
        if(p.side==='S')g.fillRect(dx+T*.32,Y+RH-T*.32,T*.36,T*.32);
        if(p.side==='N')g.fillRect(dx+T*.32,Y,T*.36,T*.32);
        if(p.side==='W')g.fillRect(X,dy+T*.32,T*.32,T*.36);
        if(p.side==='E')g.fillRect(X+RW-T*.32,dy+T*.32,T*.32,T*.36);
      }
      const a={x:X+T*.28,y:Y+T*.28,w:RW-T*.56,h:RH-T*.56};
      if(p.type==='park'){
        g.fillStyle='#B3D996';rr(g,a.x-T*.05,a.y-T*.05,a.w+T*.1,a.h+T*.1,T*.2);g.fill();
        g.strokeStyle=C.walk;g.lineWidth=T*.22;g.lineCap='round';g.beginPath();
        g.moveTo(a.x,a.y+a.h*.82);g.quadraticCurveTo(a.x+a.w*.5,a.y+a.h*.45,a.x+a.w,a.y+a.h*.2);g.stroke();
        const px=a.x+a.w*.4,py=a.y+a.h*.38;
        g.fillStyle='#5AAFD0';g.beginPath();g.ellipse(px,py,a.w*.3,a.h*.2,-.2,0,Math.PI*2);g.fill();
        g.fillStyle='#86CBE6';g.beginPath();g.ellipse(px-T*.05,py-T*.05,a.w*.25,a.h*.15,-.2,0,Math.PI*2);g.fill();
      }else if(p.type==='school'){
        const bh=T*.72,tx=a.x,ty=a.y+bh+T*.15,tw=a.w,th=a.h-bh-T*.15,rad=Math.min(tw,th)/2;
        g.fillStyle='#D9735A';rr(g,tx,ty,tw,th,rad);g.fill();
        g.strokeStyle='rgba(255,255,255,.75)';g.lineWidth=2;rr(g,tx+T*.12,ty+T*.12,tw-T*.24,th-T*.24,rad-T*.12);g.stroke();
        g.fillStyle='#77C267';rr(g,tx+T*.24,ty+T*.24,tw-T*.48,th-T*.48,rad-T*.24);g.fill();
      }else if(p.type==='station'){
        g.fillStyle='#DDE6E2';rr(g,a.x,a.y,a.w,a.h,T*.1);g.fill();
      }
    });
    return cv;
  }

  // ---------- Building the city ----------
  function buildCity(b){
    let shopIdx=0;
    api.places.forEach(function(p){
      const r=p.rect,a={x:r[0]+.28,y:r[1]+.28,w:r[2]-.56,h:r[3]-.56},cx=a.x+a.w/2,cz=a.y+a.h/2;
      if(p.type==='home'&&p.style==='towers')p.lab=towers(b,a,p);
      else if(p.type==='home')p.lab=houses(b,a,p);
      else if(p.type==='office')p.lab=office(b,a,p);
      else if(p.type==='shop')p.lab=shop(b,a,p,C.awn[shopIdx++%C.awn.length]);
      else if(p.type==='station')p.lab=station(b,a,p);
      else if(p.type==='repair')p.lab=repair(b,a);
      else if(p.type==='hospital')p.lab=hospital(b,a);
      else if(p.type==='school')p.lab=school(b,a);
      else if(p.type==='mall')p.lab=mall(b,a);
      else if(p.type==='park')p.lab=park(b,a);
      else p.lab=[cx,cz,.2];
    });
    // roadwork barriers and cones
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(api.grid[y][x]!=='x')continue;
      const vert=api.tile(x,y-1)!=='#'||api.tile(x,y+1)!=='#',bw=vert?.84:.32,bd=vert?.32:.84;
      b.box(x+.5,y+.5,bw,bd,.2,0,C.con2).box(x+.5,y+.5,bw+.01,bd+.01,.07,.13,C.con1);
      (vert?[[.2,.15],[.8,.85]]:[[.15,.2],[.85,.8]]).forEach(function(c){
        b.cone(x+c[0],y+c[1],.08,.24,0,C.con1,8).cyl(x+c[0],y+c[1],.062,.04,.09,C.con2,8);
      });
    }
    outskirts(b);
    // traffic officers at the two big crossroads
    OFFICERS.forEach(function(s){
      b.cyl(s[0],s[1],.09,.26,0,'#2B3A55',8).cyl(s[0],s[1],.13,.24,.24,'#D4F03A',8).ball(s[0],s[1],.1,.58,'#F2D2B6').cyl(s[0],s[1],.11,.05,.65,'#FFFFFF',10);
    });
  }
  // Trees and low houses around the map, so the edge of the view looks like more town instead of empty grass.
  function outskirts(b){
    let seed=7;const rnd=function(){seed=(seed*16807)%2147483647;return seed/2147483647;};
    for(let z=-14;z<H+6;z+=1.3)for(let x=-9;x<W+9;x+=1.3){
      const px=x+rnd()*.6,pz=z+rnd()*.6;
      if(px>-1.1&&px<W+1.1&&pz>-1.1&&pz<H+1.1)continue;
      if(rnd()<.62){const r=.25+rnd()*.25;b.cyl(px,pz,.06,.3,0,'#7A5A3E',5).ball(px,pz,r,.3+r*.8,rnd()<.5?C.tree:'#4E9150');}
      else{
        const w=.6+rnd()*.5,d=.6+rnd()*.5,h=.3+rnd()*.5;
        b.box(px,pz,w,d,h,0,'#E9E3D6').roof(px,pz,w+.06,d+.06,.22,h,C.roofs[Math.floor(rnd()*C.roofs.length)]);
      }
    }
  }
  function houses(b,a,p){
    const nx=Math.max(1,Math.round(a.w/1.2)),ny=Math.max(1,Math.round(a.h/1.15)),gap=.22;
    const hw=(a.w-gap*(nx-1))/nx,hd=(a.h-gap*(ny-1))/ny;let k=0;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const col=C.roofs[(p.id*3+k*2)%C.roofs.length];k++;
      const x=a.x+i*(hw+gap)+hw/2,z=a.y+j*(hd+gap)+hd/2;
      const fz=z+hd/2+.006;
      b.box(x,z,hw,hd,.55,0,'#F6F0E4').box(x,fz,hw*.2,.012,.3,0,'#9C7B5E');
      if(hw>.45)b.box(x-hw*.3,fz,hw*.2,.012,.15,.27,'#8FB6D8').box(x+hw*.3,fz,hw*.2,.012,.15,.27,'#8FB6D8');
      b.roof(x,z,hw+.08,hd+.08,.34,.55,col);
    }
    return [a.x+a.w/2,a.y+a.h/2,1.05];
  }
  function towers(b,a,p){
    const horiz=a.w>=a.h,gap=.35;
    for(let i=0;i<2;i++){
      let x,z,w,d;
      if(horiz){w=(a.w-gap)/2;d=a.h;x=a.x+i*(w+gap)+w/2;z=a.y+d/2;}
      else{w=a.w;d=(a.h-gap)/2;x=a.x+w/2;z=a.y+i*(d+gap)+d/2;}
      const h=i?2.1:1.8;
      b.box(x,z,w,d,h,0,C.towers[(p.id+i)%3]);
      for(let y=.18;y<h-.1;y+=.3)b.box(x,z,w+.04,d+.04,.03,y,'#FFFFFF');
      panes(b,x,z,w,d,h,.24,.3,.15,'#8EA6C4');
      b.box(x+w*.2,z-d*.15,w*.3,d*.3,.14,h,'#C9D2DB').cyl(x-w*.22,z+d*.1,.09,.16,h,'#AEB8C2',8);
    }
    return [a.x+a.w/2,a.y+a.h/2,2.35];
  }
  function office(b,a,p){
    const col=C.office[p.id%3],two=a.h>a.w*1.35;
    const blocks=two?[[a.x,a.y,a.w,(a.h-.3)/2,2],[a.x,a.y+(a.h-.3)/2+.3,a.w,(a.h-.3)/2,1.7]]:[[a.x+a.w*.06,a.y,a.w*.88,a.h,2]];
    blocks.forEach(function(t){
      const x=t[0]+t[2]/2,z=t[1]+t[3]/2,w=t[2],d=t[3],h=t[4];
      b.box(x,z,w,d,h,0,col);
      for(let y=.2;y<h-.12;y+=.26)b.box(x,z,w+.02,d+.02,.11,y,'#E4F0FF');
      // vertical fins on the three faces the camera can see
      const nx=Math.max(2,Math.round(w/.3)),nz=Math.max(2,Math.round(d/.3));
      for(let i=1;i<nx;i++)b.box(x-w/2+i*w/nx,z+d/2+.012,.03,.024,h-.1,.05,'#4F6B91');
      for(let i=1;i<nz;i++){const zz=z-d/2+i*d/nz;b.box(x-w/2-.012,zz,.024,.03,h-.1,.05,'#4F6B91').box(x+w/2+.012,zz,.024,.03,h-.1,.05,'#4F6B91');}
      b.box(x,z,w+.06,d+.06,.06,h,'#C9D2DB').box(x+w*.25,z,w*.25,d*.3,.16,h,'#9AA6B2');
    });
    return [a.x+a.w/2,a.y+a.h/2,2.3];
  }
  function shop(b,a,p,awn){
    let f,U;
    if(p.side==='N'||p.side==='S'){
      const sh=Math.min(a.h*.6,1.05);
      if(p.side==='N'){f={x:a.x,y:a.y,w:a.w,h:sh};U=[a.x,a.y+sh+.08,a.w,a.h-sh-.08];}
      else{f={x:a.x,y:a.y+a.h-sh,w:a.w,h:sh};U=[a.x,a.y,a.w,a.h-sh-.08];}
    }else{
      const sw=Math.min(a.w*.48,1.05);
      if(p.side==='W'){f={x:a.x,y:a.y,w:sw,h:a.h};U=[a.x+sw+.08,a.y,a.w-sw-.08,a.h];}
      else{f={x:a.x+a.w-sw,y:a.y,w:sw,h:a.h};U=[a.x,a.y,a.w-sw-.08,a.h];}
    }
    const fx=f.x+f.w/2,fz=f.y+f.h/2;
    b.box(fx,fz,f.w,f.h,.65,0,C.shopTop).box(fx,fz,f.w+.04,f.h+.04,.05,.65,'#E2D2BC');
    if(p.side==='N'||p.side==='S'){const z=p.side==='N'?f.y-.006:f.y+f.h+.006;b.box(fx,z,f.w*.82,.012,.34,.04,'#BFE3F5').box(fx,z+(p.side==='N'?-.004:.004),f.w*.16,.012,.32,.02,'#6B4F3A');}
    else{const x=p.side==='W'?f.x-.006:f.x+f.w+.006;b.box(x,fz,.012,f.h*.82,.34,.04,'#BFE3F5').box(x+(p.side==='W'?-.004:.004),fz,.012,f.h*.16,.32,.02,'#6B4F3A');}
    // striped awning over the door side
    const n=8;
    for(let i=0;i<n;i++){
      const c=i%2?'#FFFFFF':awn;
      if(p.side==='N'||p.side==='S'){const z=p.side==='N'?f.y-.1:f.y+f.h+.1;b.box(f.x+(i+.5)*f.w/n,z,f.w/n+.005,.24,.05,.44,c);}
      else{const x=p.side==='W'?f.x-.1:f.x+f.w+.1;b.box(x,f.y+(i+.5)*f.h/n,.24,f.h/n+.005,.05,.44,c);}
    }
    // umbrellas in the seating area
    const longer=Math.max(U[2],U[3]),shorter=Math.min(U[2],U[3]),cnt=clamp(Math.floor(longer/.8),1,3),rad=Math.min(.28,shorter*.42);
    if(rad>.12)for(let i=0;i<cnt;i++){
      const t=(i+.5)/cnt,ux=U[2]>=U[3]?U[0]+U[2]*t:U[0]+U[2]/2,uz=U[2]>=U[3]?U[1]+U[3]/2:U[1]+U[3]*t;
      b.cyl(ux,uz,.025,.34,0,'#D8DCE0',6).cone(ux,uz,rad*1.1,.14,.3,awn,8);
    }
    return [fx,fz,1];
  }
  function station(b,a,p){
    const strip=.42,north=p.side==='N',cabZ=north?a.y+strip/2:a.y+a.h-strip/2;
    for(let i=0;i<3;i++){
      const x=a.x+a.w*(.22+i*.28);
      b.box(x,cabZ,.22,.16,.46,0,'#2A3540').box(x,cabZ+(north?-.085:.085),.07,.01,.07,.32,'#5FF0B0');
    }
    const z0=north?a.y+strip+.1:a.y,z1=north?a.y+a.h:a.y+a.h-strip-.1,cz=(z0+z1)/2,d=z1-z0;
    [[a.x+.08,z0+.08],[a.x+a.w-.08,z0+.08],[a.x+.08,z1-.08],[a.x+a.w-.08,z1-.08]].forEach(function(q){b.cyl(q[0],q[1],.035,.62,0,'#E6EBF0',6);});
    b.box(a.x+a.w/2,cz,a.w+.1,d+.1,.09,.62,C.stationTop).box(a.x+a.w/2,cz,a.w*.5,d*.5,.03,.71,'#FFFFFF');
    return [a.x+a.w/2+.18,cz,1];
  }
  function repair(b,a){
    const bx=a.x+.45,bw=a.w-.45,bd=a.h-.55,x=bx+bw/2,z=a.y+bd/2;
    b.box(x,z,bw,bd,.85,0,'#B9C2CB').box(x,z+bd/2+.012,bw*.6,.03,.55,0,'#4A5561').box(x,z,bw+.04,bd+.04,.05,.85,'#9AA4AE');
    for(let y=.06;y<.5;y+=.1)b.box(x,z+bd/2+.03,bw*.6,.01,.015,y,'#66727E');
    for(let i=0;i<3;i++){const tz=a.y+.45+i*.42;for(let s=0;s<3;s++)b.cyl(a.x+.2,tz,.16,.07,s*.075,'#22282E',12);}
    b.box(a.x+a.w*.55,a.y+a.h-.3,1,.36,.03,0,'#E9574A');
    return [x,z,1.15];
  }
  function hospital(b,a){
    const bw=a.w-.2,bd=a.h-.15,x=a.x+.1+bw/2,z=a.y+bd/2;
    b.box(x,z,bw,bd,1.35,0,'#F6F8FA');
    for(let y=.2;y<1.25;y+=.26)b.box(x,z,bw+.02,bd+.02,.08,y,'#A9C4DE');
    b.box(x,z,.56,.18,.05,1.35,'#E8434A').box(x,z,.18,.56,.05,1.35,'#E8434A');
    b.box(x,z+bd/2+.12,bw*.4,.24,.06,.36,'#DDE3EA');
    return [x,z+bd*.25,1.6];
  }
  function school(b,a){
    const bd=.72,x=a.x+a.w/2,z=a.y+bd/2;
    b.box(x,z,a.w,bd,.65,0,'#F7E1B5').box(x,z,a.w+.04,bd+.04,.06,.65,'#D8BC86');
    for(let i=0;i<5;i++)b.box(a.x+.12+(i+.5)*(a.w-.24)/5,z+bd/2+.006,(a.w-.24)/5-.08,.01,.14,.34,'#A9C4DE');
    b.cyl(a.x+a.w-.15,a.y+bd+.1,.02,.95,0,'#D8DCE0',6).box(a.x+a.w-.03,a.y+bd+.1,.22,.02,.14,.79,'#E8434A');
    return [x,a.y+bd+(a.h-bd)/2,.15];
  }
  function mall(b,a){
    const bd=a.h-.05,x=a.x+a.w/2,z=a.y+bd/2;
    b.box(x,z,a.w,bd,1.05,0,'#D6EAF5').box(x,z,a.w+.02,bd+.02,.4,.36,'#F3FAFF').box(x,z+bd/2+.03,1,.06,.18,.08,'#E9574A');
    b.box(x,z,a.w+.06,bd+.06,.05,1.05,'#B8CCDA');
    return [x,z,1.3];
  }
  function park(b,a){
    [[.1,.1],[.85,.08],[.88,.5],[.12,.58],[.3,.92],[.62,.75],[.75,.95]].forEach(function(t,i){
      const x=a.x+a.w*t[0],z=a.y+a.h*t[1],r=.2+(i%3)*.05;
      b.cyl(x,z,.05,.3,0,'#7A5A3E',6).ball(x,z,r,.3+r*.8,C.tree);
    });
    b.box(a.x+a.w-.7+.31,a.y+a.h-.42+.19,.62,.38,.34,0,C.police).box(a.x+a.w-.7+.31,a.y+a.h-.42+.19,.68,.44,.05,.34,'#FFFFFF');
    return [a.x+a.w*.5,a.y+a.h*.66,.1];
  }

  // rows of windows on the faces the camera can see (south, east and west)
  function panes(b,x,z,w,d,h,y0,gap,ph,col){
    const nx=Math.max(1,Math.round(w/.3)),nz=Math.max(1,Math.round(d/.3));
    for(let y=y0;y+ph<=h-.08;y+=gap){
      for(let i=0;i<nx;i++)b.box(x-w/2+(i+.5)*w/nx,z+d/2+.006,w/nx*.6,.012,ph,y,col);
      for(let i=0;i<nz;i++){const zz=z-d/2+(i+.5)*d/nz;b.box(x-w/2-.006,zz,.012,d/nz*.6,ph,y,col).box(x+w/2+.006,zz,.012,d/nz*.6,ph,y,col);}
    }
  }

  // ---------- Models ----------
  function carFixed(){
    const b=new Builder();
    b.box(-.06,0,.54,.48,.2,.34,'#2A3644');
    [[.32,.27],[.32,-.27],[-.32,.27],[-.32,-.27]].forEach(function(w){b.add(wheelGeo(.1,.08),w[0],.1,w[1],'#1A1F25');});
    [.16,-.16].forEach(function(z){b.box(.5,z,.03,.1,.06,.21,'#FFF3C4');});
    return b.geometry();
  }
  function carBodyGeo(){
    const b=new Builder();
    b.box(0,0,1,.54,.26,.08,'#FFFFFF').box(-.06,0,.5,.5,.04,.54,'#FFFFFF');
    return b.geometry();
  }
  function carLampGeo(x){
    const b=new Builder();
    [.16,-.16].forEach(function(z){b.box(x,z,.03,.1,.06,.21,'#FFFFFF');});
    return b.geometry();
  }
  // A delivery scooter facing +x, rider aboard; the police version carries a siren light on its box.
  function scooter(boxCol,bodyCol,helmetCol,isPolice,seeCol){
    const b=new Builder(),g=new THREE.Group();
    b.add(wheelGeo(.11,.07),.27,.11,0,'#15181C').add(wheelGeo(.11,.07),-.25,.11,0,'#15181C');
    b.box(0,0,.62,.2,.1,.14,'#2F3640').box(.25,0,.06,.06,.38,.16,'#2F3640').box(.27,0,.04,.38,.04,.54,'#2F3640');
    b.box(-.05,0,.26,.18,.06,.26,'#2F3640');
    b.box(-.3,0,.34,.36,.32,.3,boxCol).box(-.3,0,.02,.2,.05,.43,'#FFFFFF');
    b.box(.02,0,.2,.26,.3,.32,bodyCol).box(.15,.09,.2,.06,.06,.48,bodyCol).box(.15,-.09,.2,.06,.06,.48,bodyCol);
    b.ball(.06,0,.13,.76,helmetCol).box(.17,0,.05,.16,.08,.72,'#24303C');
    const m=b.mesh(vertexMat);m.castShadow=true;m.renderOrder=2;g.add(ghost(m.geometry,ghostMat(seeCol)),m);
    if(isPolice){
      const siren=new THREE.Mesh(new THREE.BoxGeometry(.1,.08,.26),sirenOff);siren.position.set(-.3,.68,0);g.add(siren);g.userData.siren=siren;
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.35,.05,.37),new THREE.MeshLambertMaterial({color:C.police}));stripe.position.set(-.3,.42,0);g.add(stripe);
      siren.renderOrder=stripe.renderOrder=2;
    }
    g.scale.setScalar(1.15);
    return g;
  }
  function wheelGeo(r,w){const geo=new THREE.CylinderGeometry(r,r,w,12);geo.rotateX(Math.PI/2);return geo;}
  function flatGeo(geo){geo.rotateX(-Math.PI/2);return geo;}

  function flat(msg){
    document.body.classList.add('no3d');
    const m=document.querySelector('#mode3d span');if(m)m.textContent=msg+'。';
    return {draw:api.draw2d,resize:function(){}};
  }
  return {draw:draw,resize:resize};
};
