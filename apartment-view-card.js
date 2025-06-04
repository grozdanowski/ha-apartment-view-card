/*! For license information please see apartment-view-card.js.LICENSE.txt */
(()=>{"use strict";const t=globalThis,e=t.ShadowRoot&&(void 0===t.ShadyCSS||t.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,i=Symbol(),s=new WeakMap;class o{constructor(t,e,s){if(this._$cssResult$=!0,s!==i)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=t,this.t=e}get styleSheet(){let t=this.o;const i=this.t;if(e&&void 0===t){const e=void 0!==i&&1===i.length;e&&(t=s.get(i)),void 0===t&&((this.o=t=new CSSStyleSheet).replaceSync(this.cssText),e&&s.set(i,t))}return t}toString(){return this.cssText}}const n=(t,...e)=>{const s=1===t.length?t[0]:e.reduce(((e,i,s)=>e+(t=>{if(!0===t._$cssResult$)return t.cssText;if("number"==typeof t)return t;throw Error("Value passed to 'css' function must be a 'css' function result: "+t+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+t[s+1]),t[0]);return new o(s,t,i)},r=(i,s)=>{if(e)i.adoptedStyleSheets=s.map((t=>t instanceof CSSStyleSheet?t:t.styleSheet));else for(const e of s){const s=document.createElement("style"),o=t.litNonce;void 0!==o&&s.setAttribute("nonce",o),s.textContent=e.cssText,i.appendChild(s)}},a=e?t=>t:t=>t instanceof CSSStyleSheet?(t=>{let e="";for(const i of t.cssRules)e+=i.cssText;return(t=>new o("string"==typeof t?t:t+"",void 0,i))(e)})(t):t,{is:c,defineProperty:h,getOwnPropertyDescriptor:l,getOwnPropertyNames:d,getOwnPropertySymbols:p,getPrototypeOf:u}=Object,g=globalThis,m=g.trustedTypes,f=m?m.emptyScript:"",_=g.reactiveElementPolyfillSupport,b=(t,e)=>t,v={toAttribute(t,e){switch(e){case Boolean:t=t?f:null;break;case Object:case Array:t=null==t?t:JSON.stringify(t)}return t},fromAttribute(t,e){let i=t;switch(e){case Boolean:i=null!==t;break;case Number:i=null===t?null:Number(t);break;case Object:case Array:try{i=JSON.parse(t)}catch(t){i=null}}return i}},y=(t,e)=>!c(t,e),$={attribute:!0,type:String,converter:v,reflect:!1,useDefault:!1,hasChanged:y};Symbol.metadata??=Symbol("metadata"),g.litPropertyMetadata??=new WeakMap;class w extends HTMLElement{static addInitializer(t){this._$Ei(),(this.l??=[]).push(t)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(t,e=$){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(t)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(t,e),!e.noAccessor){const i=Symbol(),s=this.getPropertyDescriptor(t,i,e);void 0!==s&&h(this.prototype,t,s)}}static getPropertyDescriptor(t,e,i){const{get:s,set:o}=l(this.prototype,t)??{get(){return this[e]},set(t){this[e]=t}};return{get:s,set(e){const n=s?.call(this);o?.call(this,e),this.requestUpdate(t,n,i)},configurable:!0,enumerable:!0}}static getPropertyOptions(t){return this.elementProperties.get(t)??$}static _$Ei(){if(this.hasOwnProperty(b("elementProperties")))return;const t=u(this);t.finalize(),void 0!==t.l&&(this.l=[...t.l]),this.elementProperties=new Map(t.elementProperties)}static finalize(){if(this.hasOwnProperty(b("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(b("properties"))){const t=this.properties,e=[...d(t),...p(t)];for(const i of e)this.createProperty(i,t[i])}const t=this[Symbol.metadata];if(null!==t){const e=litPropertyMetadata.get(t);if(void 0!==e)for(const[t,i]of e)this.elementProperties.set(t,i)}this._$Eh=new Map;for(const[t,e]of this.elementProperties){const i=this._$Eu(t,e);void 0!==i&&this._$Eh.set(i,t)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(t){const e=[];if(Array.isArray(t)){const i=new Set(t.flat(1/0).reverse());for(const t of i)e.unshift(a(t))}else void 0!==t&&e.push(a(t));return e}static _$Eu(t,e){const i=e.attribute;return!1===i?void 0:"string"==typeof i?i:"string"==typeof t?t.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise((t=>this.enableUpdating=t)),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach((t=>t(this)))}addController(t){(this._$EO??=new Set).add(t),void 0!==this.renderRoot&&this.isConnected&&t.hostConnected?.()}removeController(t){this._$EO?.delete(t)}_$E_(){const t=new Map,e=this.constructor.elementProperties;for(const i of e.keys())this.hasOwnProperty(i)&&(t.set(i,this[i]),delete this[i]);t.size>0&&(this._$Ep=t)}createRenderRoot(){const t=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return r(t,this.constructor.elementStyles),t}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach((t=>t.hostConnected?.()))}enableUpdating(t){}disconnectedCallback(){this._$EO?.forEach((t=>t.hostDisconnected?.()))}attributeChangedCallback(t,e,i){this._$AK(t,i)}_$ET(t,e){const i=this.constructor.elementProperties.get(t),s=this.constructor._$Eu(t,i);if(void 0!==s&&!0===i.reflect){const o=(void 0!==i.converter?.toAttribute?i.converter:v).toAttribute(e,i.type);this._$Em=t,null==o?this.removeAttribute(s):this.setAttribute(s,o),this._$Em=null}}_$AK(t,e){const i=this.constructor,s=i._$Eh.get(t);if(void 0!==s&&this._$Em!==s){const t=i.getPropertyOptions(s),o="function"==typeof t.converter?{fromAttribute:t.converter}:void 0!==t.converter?.fromAttribute?t.converter:v;this._$Em=s,this[s]=o.fromAttribute(e,t.type)??this._$Ej?.get(s)??null,this._$Em=null}}requestUpdate(t,e,i){if(void 0!==t){const s=this.constructor,o=this[t];if(i??=s.getPropertyOptions(t),!((i.hasChanged??y)(o,e)||i.useDefault&&i.reflect&&o===this._$Ej?.get(t)&&!this.hasAttribute(s._$Eu(t,i))))return;this.C(t,e,i)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(t,e,{useDefault:i,reflect:s,wrapped:o},n){i&&!(this._$Ej??=new Map).has(t)&&(this._$Ej.set(t,n??e??this[t]),!0!==o||void 0!==n)||(this._$AL.has(t)||(this.hasUpdated||i||(e=void 0),this._$AL.set(t,e)),!0===s&&this._$Em!==t&&(this._$Eq??=new Set).add(t))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(t){Promise.reject(t)}const t=this.scheduleUpdate();return null!=t&&await t,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(const[t,e]of this._$Ep)this[t]=e;this._$Ep=void 0}const t=this.constructor.elementProperties;if(t.size>0)for(const[e,i]of t){const{wrapped:t}=i,s=this[e];!0!==t||this._$AL.has(e)||void 0===s||this.C(e,void 0,i,s)}}let t=!1;const e=this._$AL;try{t=this.shouldUpdate(e),t?(this.willUpdate(e),this._$EO?.forEach((t=>t.hostUpdate?.())),this.update(e)):this._$EM()}catch(e){throw t=!1,this._$EM(),e}t&&this._$AE(e)}willUpdate(t){}_$AE(t){this._$EO?.forEach((t=>t.hostUpdated?.())),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(t)),this.updated(t)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(t){return!0}update(t){this._$Eq&&=this._$Eq.forEach((t=>this._$ET(t,this[t]))),this._$EM()}updated(t){}firstUpdated(t){}}w.elementStyles=[],w.shadowRootOptions={mode:"open"},w[b("elementProperties")]=new Map,w[b("finalized")]=new Map,_?.({ReactiveElement:w}),(g.reactiveElementVersions??=[]).push("2.1.0");const A=globalThis,C=A.trustedTypes,E=C?C.createPolicy("lit-html",{createHTML:t=>t}):void 0,S="$lit$",j=`lit$${Math.random().toFixed(9).slice(2)}$`,x="?"+j,O=`<${x}>`,H=document,P=()=>H.createComment(""),M=t=>null===t||"object"!=typeof t&&"function"!=typeof t,k=Array.isArray,I="[ \t\n\f\r]",L=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,U=/-->/g,V=/>/g,N=RegExp(`>|${I}(?:([^\\s"'>=/]+)(${I}*=${I}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,"g"),R=/'/g,D=/"/g,T=/^(?:script|style|textarea|title)$/i,z=t=>(e,...i)=>({_$litType$:t,strings:e,values:i}),B=z(1),W=(z(2),z(3),Symbol.for("lit-noChange")),Y=Symbol.for("lit-nothing"),q=new WeakMap,X=H.createTreeWalker(H,129);function Z(t,e){if(!k(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return void 0!==E?E.createHTML(e):e}const J=(t,e)=>{const i=t.length-1,s=[];let o,n=2===e?"<svg>":3===e?"<math>":"",r=L;for(let e=0;e<i;e++){const i=t[e];let a,c,h=-1,l=0;for(;l<i.length&&(r.lastIndex=l,c=r.exec(i),null!==c);)l=r.lastIndex,r===L?"!--"===c[1]?r=U:void 0!==c[1]?r=V:void 0!==c[2]?(T.test(c[2])&&(o=RegExp("</"+c[2],"g")),r=N):void 0!==c[3]&&(r=N):r===N?">"===c[0]?(r=o??L,h=-1):void 0===c[1]?h=-2:(h=r.lastIndex-c[2].length,a=c[1],r=void 0===c[3]?N:'"'===c[3]?D:R):r===D||r===R?r=N:r===U||r===V?r=L:(r=N,o=void 0);const d=r===N&&t[e+1].startsWith("/>")?" ":"";n+=r===L?i+O:h>=0?(s.push(a),i.slice(0,h)+S+i.slice(h)+j+d):i+j+(-2===h?e:d)}return[Z(t,n+(t[i]||"<?>")+(2===e?"</svg>":3===e?"</math>":"")),s]};class K{constructor({strings:t,_$litType$:e},i){let s;this.parts=[];let o=0,n=0;const r=t.length-1,a=this.parts,[c,h]=J(t,e);if(this.el=K.createElement(c,i),X.currentNode=this.el.content,2===e||3===e){const t=this.el.content.firstChild;t.replaceWith(...t.childNodes)}for(;null!==(s=X.nextNode())&&a.length<r;){if(1===s.nodeType){if(s.hasAttributes())for(const t of s.getAttributeNames())if(t.endsWith(S)){const e=h[n++],i=s.getAttribute(t).split(j),r=/([.?@])?(.*)/.exec(e);a.push({type:1,index:o,name:r[2],strings:i,ctor:"."===r[1]?et:"?"===r[1]?it:"@"===r[1]?st:tt}),s.removeAttribute(t)}else t.startsWith(j)&&(a.push({type:6,index:o}),s.removeAttribute(t));if(T.test(s.tagName)){const t=s.textContent.split(j),e=t.length-1;if(e>0){s.textContent=C?C.emptyScript:"";for(let i=0;i<e;i++)s.append(t[i],P()),X.nextNode(),a.push({type:2,index:++o});s.append(t[e],P())}}}else if(8===s.nodeType)if(s.data===x)a.push({type:2,index:o});else{let t=-1;for(;-1!==(t=s.data.indexOf(j,t+1));)a.push({type:7,index:o}),t+=j.length-1}o++}}static createElement(t,e){const i=H.createElement("template");return i.innerHTML=t,i}}function F(t,e,i=t,s){if(e===W)return e;let o=void 0!==s?i._$Co?.[s]:i._$Cl;const n=M(e)?void 0:e._$litDirective$;return o?.constructor!==n&&(o?._$AO?.(!1),void 0===n?o=void 0:(o=new n(t),o._$AT(t,i,s)),void 0!==s?(i._$Co??=[])[s]=o:i._$Cl=o),void 0!==o&&(e=F(t,o._$AS(t,e.values),o,s)),e}class G{constructor(t,e){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){const{el:{content:e},parts:i}=this._$AD,s=(t?.creationScope??H).importNode(e,!0);X.currentNode=s;let o=X.nextNode(),n=0,r=0,a=i[0];for(;void 0!==a;){if(n===a.index){let e;2===a.type?e=new Q(o,o.nextSibling,this,t):1===a.type?e=new a.ctor(o,a.name,a.strings,this,t):6===a.type&&(e=new ot(o,this,t)),this._$AV.push(e),a=i[++r]}n!==a?.index&&(o=X.nextNode(),n++)}return X.currentNode=H,s}p(t){let e=0;for(const i of this._$AV)void 0!==i&&(void 0!==i.strings?(i._$AI(t,i,e),e+=i.strings.length-2):i._$AI(t[e])),e++}}class Q{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,e,i,s){this.type=2,this._$AH=Y,this._$AN=void 0,this._$AA=t,this._$AB=e,this._$AM=i,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode;const e=this._$AM;return void 0!==e&&11===t?.nodeType&&(t=e.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,e=this){t=F(this,t,e),M(t)?t===Y||null==t||""===t?(this._$AH!==Y&&this._$AR(),this._$AH=Y):t!==this._$AH&&t!==W&&this._(t):void 0!==t._$litType$?this.$(t):void 0!==t.nodeType?this.T(t):(t=>k(t)||"function"==typeof t?.[Symbol.iterator])(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==Y&&M(this._$AH)?this._$AA.nextSibling.data=t:this.T(H.createTextNode(t)),this._$AH=t}$(t){const{values:e,_$litType$:i}=t,s="number"==typeof i?this._$AC(t):(void 0===i.el&&(i.el=K.createElement(Z(i.h,i.h[0]),this.options)),i);if(this._$AH?._$AD===s)this._$AH.p(e);else{const t=new G(s,this),i=t.u(this.options);t.p(e),this.T(i),this._$AH=t}}_$AC(t){let e=q.get(t.strings);return void 0===e&&q.set(t.strings,e=new K(t)),e}k(t){k(this._$AH)||(this._$AH=[],this._$AR());const e=this._$AH;let i,s=0;for(const o of t)s===e.length?e.push(i=new Q(this.O(P()),this.O(P()),this,this.options)):i=e[s],i._$AI(o),s++;s<e.length&&(this._$AR(i&&i._$AB.nextSibling,s),e.length=s)}_$AR(t=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);t&&t!==this._$AB;){const e=t.nextSibling;t.remove(),t=e}}setConnected(t){void 0===this._$AM&&(this._$Cv=t,this._$AP?.(t))}}class tt{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,e,i,s,o){this.type=1,this._$AH=Y,this._$AN=void 0,this.element=t,this.name=e,this._$AM=s,this.options=o,i.length>2||""!==i[0]||""!==i[1]?(this._$AH=Array(i.length-1).fill(new String),this.strings=i):this._$AH=Y}_$AI(t,e=this,i,s){const o=this.strings;let n=!1;if(void 0===o)t=F(this,t,e,0),n=!M(t)||t!==this._$AH&&t!==W,n&&(this._$AH=t);else{const s=t;let r,a;for(t=o[0],r=0;r<o.length-1;r++)a=F(this,s[i+r],e,r),a===W&&(a=this._$AH[r]),n||=!M(a)||a!==this._$AH[r],a===Y?t=Y:t!==Y&&(t+=(a??"")+o[r+1]),this._$AH[r]=a}n&&!s&&this.j(t)}j(t){t===Y?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}}class et extends tt{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===Y?void 0:t}}class it extends tt{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==Y)}}class st extends tt{constructor(t,e,i,s,o){super(t,e,i,s,o),this.type=5}_$AI(t,e=this){if((t=F(this,t,e,0)??Y)===W)return;const i=this._$AH,s=t===Y&&i!==Y||t.capture!==i.capture||t.once!==i.once||t.passive!==i.passive,o=t!==Y&&(i===Y||s);s&&this.element.removeEventListener(this.name,this,i),o&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){"function"==typeof this._$AH?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}}class ot{constructor(t,e,i){this.element=t,this.type=6,this._$AN=void 0,this._$AM=e,this.options=i}get _$AU(){return this._$AM._$AU}_$AI(t){F(this,t)}}const nt=A.litHtmlPolyfillSupport;nt?.(K,Q),(A.litHtmlVersions??=[]).push("3.3.0");const rt=globalThis;class at extends w{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){const t=super.createRenderRoot();return this.renderOptions.renderBefore??=t.firstChild,t}update(t){const e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(t),this._$Do=((t,e,i)=>{const s=i?.renderBefore??e;let o=s._$litPart$;if(void 0===o){const t=i?.renderBefore??null;s._$litPart$=o=new Q(e.insertBefore(P(),t),t,void 0,i??{})}return o._$AI(t),o})(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return W}}at._$litElement$=!0,at.finalized=!0,rt.litElementHydrateSupport?.({LitElement:at});const ct=rt.litElementPolyfillSupport;ct?.({LitElement:at}),(rt.litElementVersions??=[]).push("4.2.0");const ht=t=>(e,i)=>{void 0!==i?i.addInitializer((()=>{customElements.define(t,e)})):customElements.define(t,e)},lt={attribute:!0,type:String,converter:v,reflect:!1,hasChanged:y},dt=(t=lt,e,i)=>{const{kind:s,metadata:o}=i;let n=globalThis.litPropertyMetadata.get(o);if(void 0===n&&globalThis.litPropertyMetadata.set(o,n=new Map),"setter"===s&&((t=Object.create(t)).wrapped=!0),n.set(i.name,t),"accessor"===s){const{name:s}=i;return{set(i){const o=e.get.call(this);e.set.call(this,i),this.requestUpdate(s,o,t)},init(e){return void 0!==e&&this.C(s,void 0,t,e),e}}}if("setter"===s){const{name:s}=i;return function(i){const o=this[s];e.call(this,i),this.requestUpdate(s,o,t)}}throw Error("Unsupported decorator location: "+s)};function pt(t){return(e,i)=>"object"==typeof i?dt(t,e,i):((t,e,i)=>{const s=e.hasOwnProperty(i);return e.constructor.createProperty(i,t),s?Object.getOwnPropertyDescriptor(e,i):void 0})(t,e,i)}function ut(t){return pt({...t,state:!0,attribute:!1})}var gt,mt,ft;(ft=gt||(gt={})).language="language",ft.system="system",ft.comma_decimal="comma_decimal",ft.decimal_comma="decimal_comma",ft.space_comma="space_comma",ft.none="none",function(t){t.language="language",t.system="system",t.am_pm="12",t.twenty_four="24"}(mt||(mt={})),new Set(["fan","input_boolean","light","switch","group","automation"]);var _t=function(t,e,i,s){s=s||{},i=null==i?{}:i;var o=new Event(e,{bubbles:void 0===s.bubbles||s.bubbles,cancelable:Boolean(s.cancelable),composed:void 0===s.composed||s.composed});return o.detail=i,t.dispatchEvent(o),o};new Set(["call-service","divider","section","weblink","cast","select"]);var bt=function(t,e,i,s){var o,n=arguments.length,r=n<3?e:null===s?s=Object.getOwnPropertyDescriptor(e,i):s;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)r=Reflect.decorate(t,e,i,s);else for(var a=t.length-1;a>=0;a--)(o=t[a])&&(r=(n<3?o(r):n>3?o(e,i,r):o(e,i))||r);return n>3&&r&&Object.defineProperty(e,i,r),r},vt=function(t,e){if("object"==typeof Reflect&&"function"==typeof Reflect.metadata)return Reflect.metadata(t,e)};let yt=class extends at{constructor(){super(...arguments),this._expandedObjects=new Set}setConfig(t){if(!t)throw new Error("Invalid configuration");this.config={type:"apartment-view-card",objects:(t.objects||[]).map((t=>({offsetX:t.offsetX||50,offsetY:t.offsetY||50,size:t.size||"medium",customName:t.customName||"New Object",entityName:t.entityName||"",disableService:t.disableService||!1,customIcon:t.customIcon||""}))),allLightsImage:t.allLightsImage||"",dayImage:t.dayImage||"",nightImage:t.nightImage||"",duskdawnImage:t.duskdawnImage||""},this.requestUpdate()}render(){return this.hass?B`
      <div class="card-config">
        <div class="warning" style="text-align: center; padding: 16px;">
          The visual editor is currently under development. Please use the "Show
          Code Editor" option to configure the card.
          <br /><br />
          <ha-button @click=${()=>this._showCodeEditor()}
            >Show Code Editor</ha-button
          >
        </div>
      </div>
    `:B``}_showCodeEditor(){const t=new CustomEvent("show-code-editor");this.dispatchEvent(t)}_handleConfigChanged(t){const e=Object.assign(Object.assign({},this.config),t.detail.value);_t(this,"config-changed",{config:e})}_handleObjectConfigChanged(t,e){const i=Object.assign(Object.assign({},e),t.detail.value),s=this.config.objects.map((t=>t===e?i:t)),o=Object.assign(Object.assign({},this.config),{objects:s});_t(this,"config-changed",{config:o})}_handleImageClick(t){if(!this._selectedObject)return;const e=t.target.getBoundingClientRect(),i=(t.clientX-e.left)/e.width*100,s=(t.clientY-e.top)/e.height*100,o=this.config.objects.map((t=>t===this._selectedObject?Object.assign(Object.assign({},t),{offsetX:i,offsetY:s}):t)),n=Object.assign(Object.assign({},this.config),{objects:o});_t(this,"config-changed",{config:n})}_handleObjectClick(t,e){t.stopPropagation(),this._selectObject(e)}_selectObject(t){this._selectedObject=t}_toggleObject(t){this._expandedObjects.has(t)?this._expandedObjects.delete(t):this._expandedObjects.add(t),this.requestUpdate()}_deleteObject(t,e){t.stopPropagation();const i=this.config.objects.filter((t=>t!==e)),s=Object.assign(Object.assign({},this.config),{objects:i});_t(this,"config-changed",{config:s})}_addObject(){const t={offsetX:50,offsetY:50,size:"medium",customName:"New Object",entityName:"",disableService:!1,customIcon:""},e=[...this.config.objects||[],t],i=Object.assign(Object.assign({},this.config),{objects:e});_t(this,"config-changed",{config:i}),this._selectedObject=t,this._expandedObjects.add(e.length-1)}};yt.styles=n`
    ha-form {
      width: 100%;
    }
    .preview {
      width: 100%;
      max-width: 500px;
      margin: 16px auto;
      position: relative;
    }
    .preview img {
      width: 100%;
      height: auto;
    }
    .object-marker {
      position: absolute;
      width: 20px;
      height: 20px;
      background: var(--primary-color);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      cursor: pointer;
    }
    .object-marker.selected {
      background: var(--accent-color);
      box-shadow: 0 0 0 2px var(--primary-color);
    }
    .object-list {
      margin-top: 16px;
    }
    .object-item {
      display: flex;
      flex-direction: column;
      padding: 8px;
      border-bottom: 1px solid var(--divider-color);
    }
    .object-header {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .object-header:hover {
      background: var(--divider-color);
    }
    .object-header.selected {
      background: var(--primary-color);
      color: var(--text-primary-color);
    }
    .object-content {
      padding: 8px;
      display: none;
    }
    .object-content.expanded {
      display: block;
    }
    .object-actions {
      margin-left: auto;
      display: flex;
      gap: 8px;
    }
    ha-icon-button {
      color: var(--primary-text-color);
    }
    .object-header.selected ha-icon-button {
      color: var(--text-primary-color);
    }
    .warning {
      color: var(--error-color);
      padding: 8px;
      text-align: center;
    }
  `,bt([pt({attribute:!1}),vt("design:type",Object)],yt.prototype,"hass",void 0),bt([pt({type:Object}),vt("design:type",Object)],yt.prototype,"config",void 0),bt([ut(),vt("design:type",Object)],yt.prototype,"_selectedObject",void 0),bt([ut(),vt("design:type",String)],yt.prototype,"_previewImage",void 0),bt([ut(),vt("design:type",Set)],yt.prototype,"_expandedObjects",void 0),yt=bt([ht("apartment-view-card-editor")],yt),customElements.get("apartment-view-card-editor")||customElements.define("apartment-view-card-editor",yt),window.customCards||(window.customCards=[]),window.customCards.find((t=>"apartment-view-card"===t.type))||window.customCards.push({type:"apartment-view-card",name:"Apartment View Card",description:"A card that shows your apartment layout with interactive lights",preview:!0,documentationURL:"https://github.com/grozdanowski/ha-apartment-view-card"});var $t="M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z",wt=function(t,e,i,s){var o,n=arguments.length,r=n<3?e:null===s?s=Object.getOwnPropertyDescriptor(e,i):s;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)r=Reflect.decorate(t,e,i,s);else for(var a=t.length-1;a>=0;a--)(o=t[a])&&(r=(n<3?o(r):n>3?o(e,i,r):o(e,i))||r);return n>3&&r&&Object.defineProperty(e,i,r),r},At=function(t,e){if("object"==typeof Reflect&&"function"==typeof Reflect.metadata)return Reflect.metadata(t,e)};let Ct=class extends at{constructor(){super(...arguments),this._windowWidth=0,this._scale=1,this._position={x:0,y:0},this._isDragging=!1,this._lastPosition={x:0,y:0},this._handleResize=()=>{this._windowWidth=window.innerWidth},this._handleWheel=t=>{t.preventDefault();const e=t.deltaY>0?.9:1.1,i=Math.min(Math.max(this._scale*e,.5),3),s=this.getBoundingClientRect(),o=t.clientX-s.left,n=t.clientY-s.top,r=o-(o-this._position.x)*(i/this._scale),a=n-(n-this._position.y)*(i/this._scale);this._scale=i,this._position={x:r,y:a},this.requestUpdate()},this._handlePointerDown=t=>{0===t.button&&(this._isDragging=!0,this._lastPosition={x:t.clientX,y:t.clientY},this.style.cursor="grabbing")},this._handlePointerMove=t=>{if(!this._isDragging)return;const e=t.clientX-this._lastPosition.x,i=t.clientY-this._lastPosition.y;this._position={x:this._position.x+e,y:this._position.y+i},this._lastPosition={x:t.clientX,y:t.clientY},this.requestUpdate()},this._handlePointerUp=()=>{this._isDragging=!1,this.style.cursor="grab"}}static getConfigElement(){return document.createElement("apartment-view-card-editor")}static getStubConfig(){return{type:"apartment-view-card",objects:[],allLightsImage:"/local/apartment/all-lights.png",dayImage:"/local/apartment/day.png",nightImage:"/local/apartment/night.png",duskdawnImage:"/local/apartment/duskdawn.png",columns:2,rows:2}}connectedCallback(){super.connectedCallback(),this._windowWidth=window.innerWidth,window.addEventListener("resize",this._handleResize),this.addEventListener("wheel",this._handleWheel),this.addEventListener("pointerdown",this._handlePointerDown),this.addEventListener("pointermove",this._handlePointerMove),this.addEventListener("pointerup",this._handlePointerUp),this.addEventListener("pointercancel",this._handlePointerUp)}disconnectedCallback(){super.disconnectedCallback(),window.removeEventListener("resize",this._handleResize),this.removeEventListener("wheel",this._handleWheel),this.removeEventListener("pointerdown",this._handlePointerDown),this.removeEventListener("pointermove",this._handlePointerMove),this.removeEventListener("pointerup",this._handlePointerUp),this.removeEventListener("pointercancel",this._handlePointerUp)}_getEntityState(t){return this.hass.states[t]}_calculateIntensity(t){var e,i;return"onoff"===(null===(e=null==t?void 0:t.attributes)||void 0===e?void 0:e.color_mode)?"on"===t.state?1:0:(null===(i=null==t?void 0:t.attributes)||void 0===i?void 0:i.brightness)?t.attributes.brightness/255:0}_calculateColor(t){var e;if(!(null===(e=null==t?void 0:t.attributes)||void 0===e?void 0:e.rgb_color))return null;if(!Array.isArray(t.attributes.rgb_color))return"#fffae6";const[i,s,o]=t.attributes.rgb_color;return void 0===i||void 0===s||void 0===o?"#fffae6":`rgb(${i}, ${s}, ${o})`}_getDayState(){const t=this._getEntityState("sun.sun");if(!t)return this.config.dayImage||"";const e=new Date,i=new Date(t.attributes.next_rising),s=new Date(t.attributes.next_setting),o=new Date(i.setDate(e.getDate())),n=new Date(s.setDate(e.getDate()));return new Date(o.getTime()-36e5)<e&&e<new Date(o.getTime()+36e5)||new Date(n.getTime()-36e5)<e&&e<new Date(n.getTime()+36e5)?this.config.duskdawnImage||this.config.dayImage||"":e<o||e>n?this.config.nightImage||this.config.dayImage||"":this.config.dayImage||""}_getSizeInPixels(t){const e=this.getBoundingClientRect().width;switch(t){case"tiny":return.1*e;case"small":return.14*e;case"large":default:return.2*e;case"huge":return.25*e}}_getScale(){const t=this.getBoundingClientRect().width;return t>600?1:t>420?.8:.5}_handleEntityClick(t){t.disableService||this.hass.callService("homeassistant","toggle",{entity_id:t.entityName})}setConfig(t){if(!t.objects||!Array.isArray(t.objects))throw new Error("Please define objects array");this.config={type:"apartment-view-card",objects:t.objects.map((t=>({offsetX:t.offsetX||50,offsetY:t.offsetY||50,size:t.size||"medium",customName:t.customName||"New Object",entityName:t.entityName||"",disableService:t.disableService||!1,customIcon:t.customIcon||""}))),allLightsImage:t.allLightsImage||"",dayImage:t.dayImage||"",nightImage:t.nightImage||"",duskdawnImage:t.duskdawnImage||""}}render(){return this.config.allLightsImage?B`
      <div class="wrapper">
        <div class="apartment-view">
          <div
            class="images-container"
            style="transform: translate(${this._position.x}px, ${this._position.y}px) scale(${this._scale})"
          >
            <img
              class="base-image"
              src="${this._getDayState()}"
              alt="Apartment view"
            />
            ${this.config.objects.map((t=>B`
                <div
                  class="light-object-container"
                  style="mask-image: radial-gradient(circle ${this._getSizeInPixels(t.size)}px at ${t.offsetX}% ${t.offsetY}%, black 0%, transparent 100%);"
                >
                  <img
                    class="light-object-image"
                    src="${this.config.allLightsImage}"
                    alt="${t.customName}"
                    style="opacity: ${this._calculateIntensity(this._getEntityState(t.entityName))}"
                  />
                  <div
                    class="color-overlay"
                    style="background-color: ${this._calculateColor(this._getEntityState(t.entityName))}"
                  ></div>
                </div>
              `))}
            ${this.config.objects.map((t=>B`
                <div
                  class="light-object-button-container"
                  style="left: ${t.offsetX}%; top: ${t.offsetY}%; transform: scale(${this._getScale()})"
                >
                  <ha-icon-button
                    .path="${this._getIconPath(t.customIcon)}"
                    @click="${()=>this._handleEntityClick(t)}"
                    .disabled="${t.disableService}"
                    .title="${t.customName}"
                    ?active="${this._isEntityActive(t.entityName)}"
                  ></ha-icon-button>
                </div>
              `))}
          </div>
        </div>
      </div>
    `:B`
        <ha-card>
          <div class="card-content">
            <div class="warning">
              Please configure the card by adding required images.
            </div>
          </div>
        </ha-card>
      `}_getIconPath(t){if(!t)return $t;switch(t){case"mdi:ceiling-light":return"M8,9H11V4H13V9H16L20,17H4L8,9M14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18H14Z";case"mdi:floor-lamp":return"M15,2L17,9H7L9,2M11,10H13V20H16V22H8V20H11V10Z";case"mdi:wall-sconce":return"M11,4L7,13H19L15,4H11M4,14V22H6V19H14V14H12V17H6V14H4Z";case"mdi:power-socket":return"M15,15H17V11H15M7,15H9V11H7M11,13H13V9H11M8.83,7H15.2L19,10.8V17H5V10.8M8,5L3,10V19H21V10L16,5H8Z";case"mdi:television":return"M21,17H3V5H21M21,3H3A2,2 0 0,0 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5A2,2 0 0,0 21,3Z";case"mdi:speaker":return"M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M12,20A5,5 0 0,1 7,15A5,5 0 0,1 12,10A5,5 0 0,1 17,15A5,5 0 0,1 12,20M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8C10.89,8 10,7.1 10,6C10,4.89 10.89,4 12,4M17,2H7C5.89,2 5,2.89 5,4V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V4C19,2.89 18.1,2 17,2Z";case"mdi:chandelier":return"M15 13.1C15 14.76 13.66 16.1 12 16.1S9 14.76 9 13.1 10.34 10.1 12 10.1 15 11.44 15 13.1M9 2V3C9 4.11 9.9 5 11 5V9.1C11.32 9.04 11.66 9 12 9S12.68 9.04 13 9.1V5C14.11 5 15 4.11 15 3V2H9M4 11.1C2.34 11.1 1 12.44 1 14.1S2.34 17.1 4 17.1 7 15.76 7 14.1 5.66 11.1 4 11.1M20 11.1C18.34 11.1 17 12.44 17 14.1S18.34 17.1 20 17.1 23 15.76 23 14.1 21.66 11.1 20 11.1M20 18.1C19.32 18.1 18.67 17.96 18.08 17.71C17.6 17.95 17.07 18.1 16.5 18.1C15.39 18.1 14.41 17.57 13.77 16.77C13.22 17 12.63 17.1 12 17.1S10.78 17 10.23 16.77C9.59 17.57 8.61 18.1 7.5 18.1C6.93 18.1 6.4 17.95 5.92 17.71C5.33 17.96 4.68 18.1 4 18.1C3.73 18.1 3.46 18.06 3.2 18C4.21 19.29 5.76 20.1 7.5 20.1C8.83 20.1 10.05 19.63 11 18.84V21.1C11 21.65 11.45 22.1 12 22.1C12.55 22.1 13 21.65 13 21.1V18.84C13.95 19.63 15.17 20.1 16.5 20.1C18.24 20.1 19.79 19.29 20.8 18C20.54 18.06 20.27 18.1 20 18.1Z";case"mdi:desk-lamp":return"M10.85,2L9.18,4.5L10.32,5.25L7.14,10C7.1,10 7.05,10 7,10A2,2 0 0,0 5,12C5,12.94 5.66,13.75 6.58,13.95L10.62,20H7V22H17V20H13L8.53,13.28C8.83,12.92 9,12.47 9,12C9,11.7 8.93,11.4 8.8,11.13L12,6.37C11.78,8.05 12.75,9.89 14.45,11L18.89,4.37C17.2,3.24 15.12,3.04 13.65,3.87L10.85,2M18.33,7L16.67,9.5C17.35,9.95 18.29,9.77 18.75,9.08C19.21,8.39 19,7.46 18.33,7Z";case"mdi:air-conditioner":return"M6.59,0.66C8.93,-1.15 11.47,1.06 12.04,4.5C12.47,4.5 12.89,4.62 13.27,4.84C13.79,4.24 14.25,3.42 14.07,2.5C13.65,0.35 16.06,-1.39 18.35,1.58C20.16,3.92 17.95,6.46 14.5,7.03C14.5,7.46 14.39,7.89 14.16,8.27C14.76,8.78 15.58,9.24 16.5,9.06C18.63,8.64 20.38,11.04 17.41,13.34C15.07,15.15 12.53,12.94 11.96,9.5C11.53,9.5 11.11,9.37 10.74,9.15C10.22,9.75 9.75,10.58 9.93,11.5C10.35,13.64 7.94,15.39 5.65,12.42C3.83,10.07 6.05,7.53 9.5,6.97C9.5,6.54 9.63,6.12 9.85,5.74C9.25,5.23 8.43,4.76 7.5,4.94C5.37,5.36 3.62,2.96 6.59,0.66M5,16H7A2,2 0 0,1 9,18V24H7V22H5V24H3V18A2,2 0 0,1 5,16M5,18V20H7V18H5M12.93,16H15L12.07,24H10L12.93,16M18,16H21V18H18V22H21V24H18A2,2 0 0,1 16,22V18A2,2 0 0,1 18,16Z";default:return $t}}_isEntityActive(t){const e=this._getEntityState(t);if(!e)return!1;const i=t.split(".")[0];return"light"===i?"on"===e.state:("media_player"===i||"climate"===i)&&"off"!==e.state&&"idle"!==e.state}};Ct.styles=n`
    :host {
      display: block;
    }
    .wrapper {
      width: 100%;
      height: 100%;
      overflow: hidden;
      touch-action: none;
    }
    .apartment-view {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .images-container {
      position: relative;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
      will-change: transform;
    }
    .base-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .light-object-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .light-object-overlay-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .light-object-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .color-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      mix-blend-mode: multiply;
    }
    .light-object-button-container {
      position: absolute;
      width: 0;
      height: 0;
      transform-origin: center;
    }
    ha-icon-button {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      --mdc-icon-button-size: 40px;
      --mdc-icon-size: 24px;
      color: var(--primary-text-color);
      background-color: var(--card-background-color);
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      transition: all 0.3s ease;
    }
    ha-icon-button[active] {
      color: var(--text-primary-color);
      background-color: var(--primary-color);
    }
    ha-icon-button:not([disabled]):hover {
      background-color: var(--primary-color);
      color: var(--text-primary-color);
    }
    ha-icon-button[disabled] {
      color: var(--disabled-text-color);
      background-color: var(--disabled-background-color);
    }
  `,wt([pt({attribute:!1}),At("design:type",Object)],Ct.prototype,"hass",void 0),wt([pt({type:Object}),At("design:type",Object)],Ct.prototype,"config",void 0),wt([ut(),At("design:type",Number)],Ct.prototype,"_windowWidth",void 0),wt([ut(),At("design:type",Number)],Ct.prototype,"_scale",void 0),wt([ut(),At("design:type",Object)],Ct.prototype,"_position",void 0),wt([ut(),At("design:type",Boolean)],Ct.prototype,"_isDragging",void 0),wt([ut(),At("design:type",Object)],Ct.prototype,"_lastPosition",void 0),Ct=wt([ht("apartment-view-card")],Ct),customElements.get("apartment-view-card")||customElements.define("apartment-view-card",Ct),window.customCards||(window.customCards=[]),window.customCards.find((t=>"apartment-view-card"===t.type))||window.customCards.push({type:"apartment-view-card",name:"Apartment View Card",description:"A card that shows your apartment layout with interactive lights",preview:!0,documentationURL:"https://github.com/grozdanowski/ha-apartment-view-card"}),customElements.get("apartment-view-card-editor")||customElements.define("apartment-view-card-editor",yt)})();