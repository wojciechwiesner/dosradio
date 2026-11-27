/**
 * Shader source for the Classic ambient background (WebGL1). Scenes are kept dark so UI text stays AA.
 * Only two scenes are evaluated per pixel (`sa` fading into `sb` by `mx`), so 14 scenes cost the same as 2.
 * Each scene takes a 0..1 variant (`va`, `vb`): palette, layout and camera shift per station.
 */

export const VERTEX_SRC = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

export const FRAGMENT_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r;uniform float t;
uniform float sa;uniform float sb;uniform float va;uniform float vb;uniform float mx;
uniform float kick;uniform float level;uniform float bass;uniform float voice;
uniform float host;uniform float shimmer;
const vec3 LIME=vec3(.83,1.,.23);

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
// Cosine palette (Inigo Quilez): the variant rotates the hue inside a scene's own range.
vec3 pal(float x,vec3 a,vec3 b,vec3 c,vec3 d){return a+b*cos(6.28318*(c*x+d));}
float asp(){return r.x/r.y;}

vec3 nature(vec2 uv,float v){
 vec2 q=uv*vec2(1.6,1.)+vec2(v*7.,0.);float s=t*.035;
 float m=fbm(q*1.4+vec2(s,-s*.6)+fbm(q*2.+s));
 float hz=smoothstep(.15,.95,uv.y);
 vec3 skyLo=mix(vec3(.21,.29,.25),vec3(.30,.24,.20),v);
 vec3 sky=mix(skyLo,vec3(.04,.08,.07),hz);
 float ridge=smoothstep(.02,0.,uv.y-.30-.06*v-.07*fbm(vec2(uv.x*3.+v*5.,1.))-.02*sin(uv.x*9.+v*4.));
 vec3 col=mix(sky,vec3(.02,.04,.035),ridge*.9);
 col=mix(col,vec3(.30,.34,.31),smoothstep(.45,.85,m)*.5*(1.-hz*.5));
 col+=vec3(.95,.82,.55)*exp(-12.*length(uv-vec2(.25+.5*v,.62)))*(.34+.12*level+.08*bass);
 return col;}

vec3 techno(vec2 uv,float v){
 vec2 c=uv-.5;c.x*=asp();
 float d=length(c);
 float z=1./(abs(c.y)+.08);
 float grid=step(.94,fract(c.x*z*(1.+v*.6)))+step(.9,fract(z*.6+t*(1.8+v)));
 float tunnel=grid*smoothstep(1.2,.1,d)*.5;
 float beams=0.;
 for(int i=0;i<5;i++){float fi=float(i);float a=sin(t*.35+fi*1.7+v*3.)*.9;
  beams+=smoothstep(.012,0.,abs(c.x-c.y*a-sin(fi+v*2.)*.25))*smoothstep(.9,0.,d);}
 float haze=fbm(c*3.+vec2(t*.15,0.))*.3;
 vec3 beamCol=mix(LIME,vec3(.35,.8,1.),step(.5,v));
 vec3 col=vec3(.012)+vec3(.04,.04,.045)*haze;
 col+=vec3(.7,.74,.76)*tunnel*(.12+.55*kick);
 col+=beamCol*beams*.4*(.3+level);
 col+=vec3(1.)*kick*kick*.09*smoothstep(.9,0.,d);
 return col;}

vec3 night(vec2 uv,float v){
 float a_=asp();
 vec3 col=mix(vec3(.05,.03,.045),vec3(.015,.02,.04),uv.y);
 for(int L=0;L<2;L++){
  float fl=float(L);
  vec2 p=vec2(uv.x*a_,uv.y)*(3.2+fl*2.6)+vec2(t*.012*(1.+fl)+v*9.,t*.01);
  vec2 id=floor(p),f=fract(p)-.5;
  float a=h(id+fl*17.),b=h(id+7.3+fl),c=h(id+3.1);
  vec2 off=(vec2(a,b)-.5)*.5;
  float rad=.16+.16*c;
  float disc=smoothstep(rad,rad*.6,length(f-off));
  float rim=smoothstep(rad*.75,rad,length(f-off))*disc;
  float pulse=.55+.45*sin(t*.35+a*6.28)+.4*bass*b;
  vec3 tint=mix(mix(vec3(1.,.62,.28),vec3(.45,.6,1.),v),vec3(1.,.38,.5),b);
  col+=tint*(disc*.20+rim*.14)*pulse*(.55+.5*level)*(1.-.5*fl);
 }
 float lx=fract(uv.x*a_*34.);
 float cid=floor(uv.x*a_*34.);
 float spd=.08+.16*h(vec2(cid,2.));
 float drop=smoothstep(.05,0.,fract(uv.y*1.3+t*spd+h(vec2(cid,3.))))*step(.78,h(vec2(cid,1.)));
 col+=vec3(.5,.6,.8)*drop*smoothstep(.06,0.,abs(lx-.5))*.14;
 return col;}

vec3 focus(vec2 uv,float v){
 float a_=asp();
 vec3 col=mix(vec3(.02,.04,.04),vec3(.01,.015,.02),uv.y);
 float amp=.045+.03*level+.02*bass;
 for(int i=0;i<6;i++){
  float fi=float(i);
  float y=.2+.13*fi+amp*sin(uv.x*a_*(1.6+.5*fi+v)+t*(.07+.015*fi)+fi+v*6.)+.02*fbm(vec2(uv.x*2.+fi*3.,t*.03));
  float dist=abs(uv.y-y);
  float line=smoothstep(.0022,0.,dist)+smoothstep(.035,0.,dist)*.12;
  vec3 c0=pal(fi/5.+v,vec3(.35,.6,.55),vec3(.2,.25,.2),vec3(1.),vec3(.0,.15,.3));
  col+=c0*line*(.2+.16*level);
 }
 return col;}

// Aurora: vertical curtains of light over a dark horizon (ambient, melodic, film).
vec3 aurora(vec2 uv,float v){
 float a_=asp();
 vec3 col=mix(vec3(.01,.02,.04),vec3(.0,.005,.015),uv.y);
 for(int i=0;i<3;i++){
  float fi=float(i);
  float x=uv.x*a_*(1.2+fi*.4)+v*5.+fi*1.7;
  float band=fbm(vec2(x*1.3,t*.04+fi));
  float y0=.48+.18*band+.04*sin(x*2.+t*.2);
  float curtain=smoothstep(.0,.25,uv.y-y0+.25)*smoothstep(.45,.0,uv.y-y0);
  float rays=.6+.4*sin(x*30.+band*8.);
  vec3 c0=pal(fi*.18+v*.6,vec3(.3,.5,.45),vec3(.3,.35,.3),vec3(1.),vec3(.25,.05,.6));
  col+=c0*curtain*rays*(.11+.08*level+.05*bass);
 }
 float stars=step(.997,h(floor(uv*vec2(a_,1.)*260.)))*smoothstep(.45,.9,uv.y);
 col+=vec3(.8)*stars*.5;
 col+=vec3(.02,.04,.05)*(1.-smoothstep(.0,.2,uv.y));
 return col;}

// Ocean: slow swell lines and a moon path (dub, spa).
vec3 ocean(vec2 uv,float v){
 float a_=asp();
 vec3 deep=mix(vec3(.0,.03,.05),vec3(.02,.04,.035),v);
 vec3 col=mix(deep,vec3(.01,.015,.03),uv.y);
 float horizon=.56+.04*v;
 if(uv.y<horizon){
  float dz=1./(horizon-uv.y+.03);
  float w=fbm(vec2(uv.x*a_*2.*dz*.25+v*4.,dz*.9-t*.18));
  float crest=smoothstep(.62,.8,w)*(.5+.5*bass);
  col+=vec3(.16,.32,.36)*crest*(.55+.25*level)+vec3(.02,.05,.06)*w;
  float path=exp(-pow((uv.x-.35-.3*v)*a_*3.,2.))*smoothstep(.0,horizon,uv.y);
  col+=vec3(.55,.6,.65)*path*w*.42;
 } else {
  col+=vec3(.6,.65,.7)*exp(-38.*length((uv-vec2(.35+.3*v,horizon+.2))*vec2(a_,1.)))*1.1+vec3(.04,.06,.08)*exp(-6.*abs(uv.y-horizon));
 }
 col+=vec3(.0,.05,.06)*kick*.4*smoothstep(horizon,.0,uv.y);
 return col;}

// Synthwave: sun with scanline cuts and a scrolling perspective grid (retro synth).
vec3 synthwave(vec2 uv,float v){
 float a_=asp();
 vec2 c=vec2((uv.x-.5)*a_,uv.y);
 vec3 col=mix(vec3(.08,.02,.08),vec3(.01,.01,.04),uv.y);
 float hy=.42;
 vec2 sc=c-vec2(.0,hy+.17);
 float sd=length(sc);
 float sun=smoothstep(.19,.185,sd)*step(.0,sc.y+.19);
 float cuts=step(.5,fract(sc.y*22.-t*.4))*smoothstep(.06,-.12,sc.y);
 vec3 sunCol=mix(pal(v,vec3(.8,.4,.3),vec3(.2,.2,.2),vec3(1.),vec3(.0,.1,.2)),vec3(.95,.3,.55),smoothstep(.15,-.15,sc.y));
 col+=sunCol*sun*(1.-cuts)*.42;
 col+=vec3(.9,.3,.6)*exp(-6.*sd)*.12*(1.+bass);
 if(uv.y<hy){
  float z=1./(hy-uv.y+.02);
  float gx=abs(fract(c.x*z*.5)-.5);
  float gz=abs(fract(z*.35-t*(.6+.6*v))-.5);
  float g=smoothstep(.04*z*.08+.01,.0,min(gx,gz)/z*6.);
  col+=mix(vec3(.9,.2,.7),vec3(.2,.7,.9),v)*g*.35*(.4+.6*kick)*smoothstep(.0,hy,uv.y+.1);
 }
 return col;}

// Neon: rain-wet city signs reflected on the street (cyber noir, trip hop).
vec3 neon(vec2 uv,float v){
 float a_=asp();
 vec3 col=vec3(.012,.012,.02);
 float y=uv.y;float refl=0.;
 if(y<.35){y=.7-y;refl=1.;}
 for(int i=0;i<5;i++){
  float fi=float(i);
  vec2 ctr=vec2(fract(.15+fi*.21+v*.37)*a_,.48+.3*h(vec2(fi,v)));
  vec2 p=vec2(uv.x*a_,y)-ctr;
  float bar=smoothstep(.009,.0,abs(abs(p.y)-.04-.02*h(vec2(fi,2.))))*step(abs(p.x),.12+.08*h(vec2(fi,4.)));
  float flick=step(.08,fract(sin(floor(t*7.+fi*13.)*17.1)*43.))*.6+.4;
  vec3 c0=pal(fi*.23+v,vec3(.6,.4,.6),vec3(.4,.4,.4),vec3(1.),vec3(.0,.33,.67));
  float glow=exp(-18.*length(p*vec2(.6,1.)));
  col+=c0*(bar*.85+glow*.3)*flick*(.7+.5*level);
 }
 if(refl>.5){col*=.6+.3*fbm(vec2(uv.x*a_*40.,uv.y*6.+t*.6));col+=vec3(.01,.012,.02);}
 float rain=step(.985,h(floor(vec2(uv.x*a_*90.,uv.y*20.+t*14.))));
 col+=vec3(.35,.4,.5)*rain*.18;
 return col;}

// Smoke: warm club haze curling under a single spotlight (jazz, funk).
vec3 smoke(vec2 uv,float v){
 float a_=asp();
 vec2 p=vec2(uv.x*a_,uv.y);
 float s=t*.05;
 float q=fbm(p*1.8+vec2(s,s*.4));
 float m=fbm(p*2.6+vec2(q*1.6+v*5.,-s)+fbm(p*3.+s));
 vec3 warm=mix(vec3(.42,.24,.12),vec3(.32,.16,.26),v);
 vec3 col=vec3(.025,.016,.012)+warm*smoothstep(.3,.9,m)*.7*(.75+.4*level);
 float spot=exp(-3.*pow((uv.x-.3-.4*v)*a_,2.))*smoothstep(1.1,.2,uv.y);
 col+=vec3(.55,.4,.22)*spot*m*.45*(1.+.6*bass);
 return col;}

// Dunes: layered warm ridges under a heat haze and a low sun (afro, etno, world).
vec3 dunes(vec2 uv,float v){
 vec3 col=mix(mix(vec3(.25,.12,.05),vec3(.2,.08,.1),v),vec3(.03,.02,.03),uv.y);
 col+=vec3(.9,.55,.25)*exp(-9.*length(uv-vec2(.2+.6*v,.5)))*(.3+.12*bass);
 for(int i=0;i<4;i++){
  float fi=float(i);
  float base=.38-fi*.09;
  float y=base+.05*sin(uv.x*(3.+fi)+v*6.+fi)+.03*fbm(vec2(uv.x*4.+fi*2.,fi))+.006*sin(uv.x*40.-t*.5);
  float m=smoothstep(.004,.0,uv.y-y);
  vec3 c0=mix(vec3(.16,.08,.04),vec3(.04,.025,.02),fi/3.);
  float lit=smoothstep(.03,.0,abs(uv.y-y))*(.08+.06*kick);
  col=mix(col,c0,m);col+=vec3(.6,.35,.15)*lit;
 }
 return col;}

// Laser: hard beams sweeping from the stage through haze, strobe on the kick (raw, hard techno).
vec3 laser(vec2 uv,float v){
 float a_=asp();
 vec2 o=vec2(.5*a_,-.05);
 vec2 p=vec2(uv.x*a_,uv.y)-o;
 float ang=atan(p.x,p.y);
 float haze=.35+.65*fbm(vec2(uv.x*a_*3.,uv.y*2.-t*.1));
 vec3 col=vec3(.006,.006,.01)+vec3(.02)*haze;
 for(int i=0;i<7;i++){
  float fi=float(i);
  float a=sin(t*(.4+.07*fi)+fi*1.3+v*4.)*1.1;
  float beam=exp(-abs(ang-a)*(70.+20.*fi))*smoothstep(1.5,.05,length(p));
  vec3 c0=mix(vec3(1.,.15,.2),vec3(.2,1.,.4),step(.5,fract(v+fi*.25)));
  col+=c0*beam*haze*(.42+.6*kick);
 }
 col+=vec3(1.)*pow(kick,4.)*.10;
 return col;}

// Warp: stars streaking out of a centre point (trance, dnb, progressive).
vec3 warp(vec2 uv,float v){
 vec2 c=(uv-.5)*vec2(asp(),1.);
 float d=length(c)+1e-3;float a=atan(c.y,c.x);
 vec3 col=vec3(.004,.006,.015);
 for(int i=0;i<3;i++){
  float fi=float(i);
  float lanes=60.+fi*40.;
  float id=floor(a/6.28318*lanes+fi*.37);
  float seed=h(vec2(id,fi+v*7.));
  float z=fract(seed+t*(.12+.18*seed)*(1.+.8*bass)+fi*.3);
  float rr=z*z*1.4;
  float len=.02+.18*z*z*(1.+kick);
  float streak=smoothstep(len,.0,abs(d-rr))*smoothstep(.0,.02,d-rr+len)*step(.55,seed);
  float lane=smoothstep(.45,.0,abs(fract(a/6.28318*lanes+fi*.37)-.5));
  vec3 c0=pal(seed+v,vec3(.6,.6,.7),vec3(.3,.3,.3),vec3(1.),vec3(.6,.7,.8));
  col+=c0*streak*lane*1.1*(.35+z);
 }
 col+=pal(v,vec3(.3,.3,.4),vec3(.2),vec3(1.),vec3(.6,.7,.8))*exp(-6.*d)*(.2+.25*level);
 return col;}

// Liquid: slow metaballs of coloured light, like oil in water (deep house, liquid dnb).
vec3 liquid(vec2 uv,float v){
 vec2 p=(uv-.5)*vec2(asp(),1.);
 float f=0.;
 for(int i=0;i<5;i++){
  float fi=float(i);
  vec2 c=.38*vec2(sin(t*(.05+.02*fi)+fi*2.1+v*6.),cos(t*(.04+.017*fi)+fi*1.3));
  f+=(.018+.008*bass)/(dot(p-c,p-c)+.004);
 }
 float edge=smoothstep(.9,1.2,f)*(1.-smoothstep(1.6,3.2,f));
 float body=smoothstep(1.,4.,f)*.9;
 vec3 c0=pal(v+f*.04,vec3(.25,.3,.4),vec3(.25,.2,.3),vec3(1.),vec3(.1,.4,.7));
 vec3 c1=pal(v+.5+f*.02,vec3(.3,.3,.4),vec3(.2,.2,.3),vec3(1.),vec3(.1,.4,.7));
 return vec3(.008,.01,.02)+(c0*edge*.45+c1*body*.32)*(.7+.4*level);}

// Candle: warm floating flames and soft bokeh (classical, piano, lobby).
vec3 candle(vec2 uv,float v){
 float a_=asp();
 vec3 col=mix(vec3(.04,.025,.015),vec3(.01,.008,.008),uv.y);
 for(int i=0;i<9;i++){
  float fi=float(i);
  vec2 c=vec2(fract(.08+fi*.113+v*.3)*a_,.18+.6*h(vec2(fi,v*3.)));
  vec2 d=vec2(uv.x*a_,uv.y)-c;
  float fl=.7+.3*sin(t*(2.+fi*.3)+fi)*fbm(vec2(t*.8,fi));
  float flame=exp(-length(d*vec2(3.,1.4))*24.)*fl;
  float halo=exp(-length(d)*(5.+2.*h(vec2(fi,1.))))*fl;
  vec3 c0=mix(vec3(1.,.62,.3),vec3(1.,.5,.42),h(vec2(fi,5.)));
  col+=c0*(flame*.9+halo*.16)*(.8+.35*level);
 }
 return col;}

vec3 scene(float id,vec2 uv,float v){
 if(id<.5)return nature(uv,v);
 if(id<1.5)return techno(uv,v);
 if(id<2.5)return night(uv,v);
 if(id<3.5)return focus(uv,v);
 if(id<4.5)return aurora(uv,v);
 if(id<5.5)return ocean(uv,v);
 if(id<6.5)return synthwave(uv,v);
 if(id<7.5)return neon(uv,v);
 if(id<8.5)return smoke(uv,v);
 if(id<9.5)return dunes(uv,v);
 if(id<10.5)return laser(uv,v);
 if(id<11.5)return warp(uv,v);
 if(id<12.5)return liquid(uv,v);
 return candle(uv,v);}

vec3 sceneTint(float id){
 if(id<.5)return vec3(.75,.9,.8);
 if(id<1.5)return vec3(.8,.9,.85);
 if(id<2.5)return vec3(1.,.75,.6);
 if(id<3.5)return vec3(.55,.95,.8);
 if(id<4.5)return vec3(.5,1.,.8);
 if(id<5.5)return vec3(.55,.8,1.);
 if(id<6.5)return vec3(1.,.55,.8);
 if(id<7.5)return vec3(.8,.6,1.);
 if(id<8.5)return vec3(1.,.75,.5);
 if(id<9.5)return vec3(1.,.7,.45);
 if(id<10.5)return vec3(1.,.6,.6);
 if(id<11.5)return vec3(.7,.8,1.);
 if(id<12.5)return vec3(.6,.75,1.);
 return vec3(1.,.75,.5);}

float smin(float a,float b,float k){float x=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,x)-k*x*(1.-x);}

// Soft head-and-shoulders silhouette as a signed distance; contour lines and light dust follow it.
vec3 presence(vec2 uv,vec3 tint){
 float a_=asp();
 vec2 c=(uv-.5)*vec2(a_,1.);
 // Landscape: right of centre behind the content. Portrait (phone): upper area behind the station title.
 vec2 hc=a_<1.?vec2(a_*.18,.22):vec2(clamp(a_*.13,0.,.24),-.02);
 vec2 p=c-hc;
 float ang=atan(p.y,p.x);
 float head=length(p-vec2(0.,.17))-.115;
 vec2 sp=(p-vec2(0.,-.17))/vec2(.31,.2);
 float shoulders=(length(sp)-1.)*.2;
 float neck=max(abs(p.x)-.05,abs(p.y-.02)-.07);
 float d=smin(smin(head,shoulders,.07),neck,.05);
 float wob=voice*.016*sin(ang*7.+t*7.)+.006*sin(p.y*38.-t*3.)+(fbm(p*7.+t*.25)-.5)*.02*(.3+voice);
 d+=wob;
 float env=smoothstep(.34,.0,d);
 float lines=smoothstep(.42,.5,abs(fract(d*24.-t*.1-voice*.6)-.5));
 float rim=exp(-abs(d)*55.);
 float inner=smoothstep(.0,-.2,d)*(.12+.5*voice);
 vec2 cell=floor(p*70.);
 float dust=step(.955,h(cell+floor(t*1.5)))*smoothstep(.07,.0,abs(d))*(.5+voice);
 vec3 tone=mix(tint,LIME,.22);
 return tone*(lines*env*.42+rim*.6*(.6+voice)+inner*.8+dust*.9);}

void main(){
 vec2 uv=gl_FragCoord.xy/r;
 vec3 col=vec3(0.);
 vec3 tint=vec3(0.);
 if(mx<.999){col+=scene(sa,uv,va)*(1.-mx);tint+=sceneTint(sa)*(1.-mx);}
 if(mx>.001){col+=scene(sb,uv,vb)*mx;tint+=sceneTint(sb)*mx;}
 if(shimmer>.001)col+=LIME*shimmer*.05*smoothstep(.2,0.,abs(uv.x-(1.-shimmer)))*(.6+.4*sin(uv.y*40.+t*6.));
 float g=h(gl_FragCoord.xy+fract(t)*91.)*.04;col+=g-.02;
 col*=1.-.55*pow(length(uv-.5)*1.25,2.);
 col=min(col,vec3(.42));
 // The host sits above the scene brightness cap so the "reflection" reads through the glass panels.
 if(host>.001)col=min(col+presence(uv,tint)*host*1.6,vec3(.78));
 gl_FragColor=vec4(col,1.);}
`;
