/** Shader source for the Classic ambient background (WebGL1). Scenes are kept dark so UI text stays AA. */

export const VERTEX_SRC = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

export const FRAGMENT_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r;uniform float t;uniform vec4 sc;
uniform float kick;uniform float level;uniform float bass;uniform float voice;
uniform float host;uniform float shimmer;
const vec3 LIME=vec3(.83,1.,.23);

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}

vec3 nature(vec2 uv){
 vec2 q=uv*vec2(1.6,1.);float s=t*.035;
 float m=fbm(q*1.4+vec2(s,-s*.6)+fbm(q*2.+s));
 float hz=smoothstep(.15,.95,uv.y);
 vec3 sky=mix(vec3(.21,.29,.25),vec3(.04,.08,.07),hz);
 float ridge=smoothstep(.02,0.,uv.y-.34-.07*fbm(vec2(uv.x*3.,1.))-.02*sin(uv.x*9.));
 vec3 col=mix(sky,vec3(.02,.04,.035),ridge*.9);
 col=mix(col,vec3(.30,.34,.31),smoothstep(.45,.85,m)*.5*(1.-hz*.5));
 col+=vec3(.95,.82,.55)*exp(-12.*length(uv-vec2(.72,.62)))*(.34+.12*level+.08*bass);
 return col;}

vec3 techno(vec2 uv){
 vec2 c=uv-.5;c.x*=r.x/r.y;
 float d=length(c);
 float z=1./(abs(c.y)+.08);
 float grid=step(.94,fract(c.x*z*1.2))+step(.9,fract(z*.6+t*2.2));
 float tunnel=grid*smoothstep(1.2,.1,d)*.5;
 float beams=0.;
 for(int i=0;i<5;i++){float fi=float(i);float a=sin(t*.35+fi*1.7)*.9;
  beams+=smoothstep(.012,0.,abs(c.x-c.y*a-sin(fi)*.25))*smoothstep(.9,0.,d);}
 float haze=fbm(c*3.+vec2(t*.15,0.))*.3;
 vec3 col=vec3(.012)+vec3(.04,.04,.045)*haze;
 col+=vec3(.7,.74,.76)*tunnel*(.12+.55*kick);
 col+=LIME*beams*.4*(.3+level);
 col+=vec3(1.)*kick*kick*.09*smoothstep(.9,0.,d);
 return col;}

vec3 night(vec2 uv){
 float asp=r.x/r.y;
 vec3 col=mix(vec3(.05,.03,.045),vec3(.015,.02,.04),uv.y);
 for(int L=0;L<2;L++){
  float fl=float(L);
  vec2 p=vec2(uv.x*asp,uv.y)*(3.2+fl*2.6)+vec2(t*.012*(1.+fl),t*.01);
  vec2 id=floor(p),f=fract(p)-.5;
  float a=h(id+fl*17.),b=h(id+7.3+fl),c=h(id+3.1);
  vec2 off=(vec2(a,b)-.5)*.5;
  float rad=.16+.16*c;
  float disc=smoothstep(rad,rad*.6,length(f-off));
  float rim=smoothstep(rad*.75,rad,length(f-off))*disc;
  float pulse=.55+.45*sin(t*.35+a*6.28)+.4*bass*b;
  vec3 tint=mix(vec3(1.,.62,.28),vec3(1.,.38,.5),b);
  col+=tint*(disc*.20+rim*.14)*pulse*(.55+.5*level)*(1.-.5*fl);
 }
 float lx=fract(uv.x*asp*34.);
 float col_id=floor(uv.x*asp*34.);
 float spd=.08+.16*h(vec2(col_id,2.));
 float drop=smoothstep(.05,0.,fract(uv.y*1.3+t*spd+h(vec2(col_id,3.)))) * step(.78,h(vec2(col_id,1.)));
 col+=vec3(.5,.6,.8)*drop*smoothstep(.06,0.,abs(lx-.5))*.14;
 return col;}

vec3 focus(vec2 uv){
 float asp=r.x/r.y;
 vec3 col=mix(vec3(.02,.04,.04),vec3(.01,.015,.02),uv.y);
 float amp=.045+.03*level+.02*bass;
 for(int i=0;i<6;i++){
  float fi=float(i);
  float y=.2+.13*fi+amp*sin(uv.x*asp*(1.6+.5*fi)+t*(.07+.015*fi)+fi)+.02*fbm(vec2(uv.x*2.+fi*3.,t*.03));
  float dist=abs(uv.y-y);
  float line=smoothstep(.0022,0.,dist)+smoothstep(.035,0.,dist)*.12;
  col+=mix(vec3(.17,.89,.55),vec3(.3,.6,.9),fi/5.)*line*(.2+.16*level);
 }
 return col;}

float smin(float a,float b,float k){float x=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,x)-k*x*(1.-x);}

// Soft head-and-shoulders silhouette as a signed distance; contour lines and light dust follow it.
vec3 presence(vec2 uv,vec3 tint){
 float asp=r.x/r.y;
 vec2 c=(uv-.5)*vec2(asp,1.);
 vec2 hc=vec2(clamp(asp*.13,0.,.24),-.02);
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
 if(sc.x>.001){col+=nature(uv)*sc.x;tint+=vec3(.75,.9,.8)*sc.x;}
 if(sc.y>.001){col+=techno(uv)*sc.y;tint+=vec3(.8,.9,.85)*sc.y;}
 if(sc.z>.001){col+=night(uv)*sc.z;tint+=vec3(1.,.75,.6)*sc.z;}
 if(sc.w>.001){col+=focus(uv)*sc.w;tint+=vec3(.55,.95,.8)*sc.w;}
 if(host>.001)col+=presence(uv,tint)*host;
 if(shimmer>.001)col+=LIME*shimmer*.05*smoothstep(.2,0.,abs(uv.x-(1.-shimmer)))*(.6+.4*sin(uv.y*40.+t*6.));
 float g=h(gl_FragCoord.xy+fract(t)*91.)*.04;col+=g-.02;
 col*=1.-.55*pow(length(uv-.5)*1.25,2.);
 gl_FragColor=vec4(min(col,vec3(.42)),1.);}
`;
