import{Color as C,Matrix4 as U,Mesh as z,Plane as V,ShaderMaterial as k,UniformsUtils as B,Vector3 as f,Vector4 as S,WebGLRenderTarget as H,HalfFloatType as I}from"three";class w extends z{constructor(_,o={}){super(_),this.isReflector=!0,this.type="Reflector",this.forceUpdate=!1,this._reflectionCameras=new WeakMap;const s=this,P=o.color!==void 0?new C(o.color):new C(8355711),F=o.textureWidth||512,O=o.textureHeight||512,R=o.clipBias||0,m=o.shader||w.ReflectorShader,T=o.multisample!==void 0?o.multisample:4,c=new V,l=new f,d=new f,y=new f,p=new U,v=new f(0,0,-1),r=new S,x=new f,g=new f,n=new S,h=new U,b=new H(F,O,{samples:T,type:I}),M=new k({name:m.name!==void 0?m.name:"unspecified",uniforms:B.clone(m.uniforms),fragmentShader:m.fragmentShader,vertexShader:m.vertexShader});M.uniforms.tDiffuse.value=b.texture,M.uniforms.color.value=P,M.uniforms.textureMatrix.value=h,this.material=M,this.onBeforeRender=function(e,u,i){const a=this.getReflectionCamera(i);if(d.setFromMatrixPosition(s.matrixWorld),y.setFromMatrixPosition(i.matrixWorld),p.extractRotation(s.matrixWorld),l.set(0,0,1),l.applyMatrix4(p),x.subVectors(d,y),x.dot(l)>0===!0&&this.forceUpdate===!1)return;x.reflect(l).negate(),x.add(d),p.extractRotation(i.matrixWorld),v.set(0,0,-1),v.applyMatrix4(p),v.add(y),g.subVectors(d,v),g.reflect(l).negate(),g.add(d),a.position.copy(x),a.up.set(0,1,0),a.up.applyMatrix4(p),a.up.reflect(l),a.lookAt(g),a.far=i.far,a.updateMatrixWorld(),a.projectionMatrix.copy(i.projectionMatrix),h.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),h.multiply(a.projectionMatrix),h.multiply(a.matrixWorldInverse),h.multiply(s.matrixWorld),c.setFromNormalAndCoplanarPoint(l,d),c.applyMatrix4(a.matrixWorldInverse),r.set(c.normal.x,c.normal.y,c.normal.z,c.constant);const t=a.projectionMatrix;a.isOrthographicCamera?(n.x=(Math.sign(r.x)+t.elements[8])/t.elements[0],n.y=(Math.sign(r.y)+t.elements[9])/t.elements[5],n.z=-i.far,n.w=1):(n.x=(Math.sign(r.x)+t.elements[8])/t.elements[0],n.y=(Math.sign(r.y)+t.elements[9])/t.elements[5],n.z=-1,n.w=(1+t.elements[10])/t.elements[14]),r.multiplyScalar(2/r.dot(n)),t.elements[2]=r.x,t.elements[6]=r.y,a.isOrthographicCamera?(t.elements[10]=r.z-R,t.elements[14]=r.w-1):(t.elements[10]=r.z+1-R,t.elements[14]=r.w),s.visible=!1;const j=e.getRenderTarget(),A=e.xr.enabled,D=e.shadowMap.autoUpdate;e.xr.enabled=!1,e.shadowMap.autoUpdate=!1,e.setRenderTarget(b),e.state.buffers.depth.setMask(!0),e.autoClear===!1&&e.clear(),e.render(u,a),e.xr.enabled=A,e.shadowMap.autoUpdate=D,e.setRenderTarget(j);const W=i.viewport;W!==void 0&&e.state.viewport(W),s.visible=!0,this.forceUpdate=!1},this.getRenderTarget=function(){return b},this.dispose=function(){b.dispose(),s.material.dispose()},this.getReflectionCamera=function(e){let u=this._reflectionCameras.get(e);return u===void 0&&(u=e.clone(),this._reflectionCameras.set(e,u)),u}}}w.ReflectorShader={name:"ReflectorShader",uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null}},vertexShader:`
		uniform mat4 textureMatrix;
		varying vec4 vUv;

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>

		}`,fragmentShader:`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;

		#include <logdepthbuf_pars_fragment>

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			#include <logdepthbuf_fragment>

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};export{w as Reflector};
